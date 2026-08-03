"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS, missionCreateSchema, rpToRealMs } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  groupLeaderIds,
  groupMemberIds,
} from "@/server/notifications";
import { getRpTimeConfig } from "@/server/rp-config";

export interface CreateMissionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export type UpdateMissionResult = CreateMissionResult;

/** Prochain numéro de code de mission (TO-<rang>-XXXX). */
async function nextMissionCode(rank: string): Promise<string> {
  const count = await prisma.mission.count();
  return `TO-${rank}-${String(count + 1).padStart(4, "0")}`;
}

export async function createMissionAction(raw: unknown): Promise<CreateMissionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_CREATE)) {
    return { ok: false, error: "Permission refusée." };
  }

  const parsed = missionCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;

  // Délai : date réelle explicite OU durée RP convertie via le service central
  let expiresAt: Date | null = null;
  if (data.expiresAt) {
    expiresAt = new Date(data.expiresAt);
    if (expiresAt <= new Date()) {
      return { ok: false, error: "La date d'expiration doit être dans le futur." };
    }
  } else if (data.rpDuration) {
    const ms = rpToRealMs(data.rpDuration, await getRpTimeConfig());
    if (ms > 0) expiresAt = new Date(Date.now() + ms);
  }

  const [targetLevel, minLevel] = await Promise.all([
    data.targetLevelSlug
      ? prisma.playerLevel.findUnique({ where: { slug: data.targetLevelSlug } })
      : null,
    data.minRecommendedLevelSlug
      ? prisma.playerLevel.findUnique({ where: { slug: data.minRecommendedLevelSlug } })
      : null,
  ]);

  const code = await nextMissionCode(data.rank);
  const mission = await prisma.mission.create({
    data: {
      code,
      status: data.publish ? "AVAILABLE" : "DRAFT",
      rank: data.rank,
      category: data.category,
      publicTitle: data.publicTitle,
      internalTitle: data.internalTitle ?? null,
      publicSummary: data.publicSummary ?? null,
      confidentialDescription: data.confidentialDescription ?? null,
      primaryObjective: data.primaryObjective ?? null,
      secondaryObjectives: data.secondaryObjectives,
      targetIdentity: data.targetIdentity ?? null,
      location: data.location ?? null,
      clientName: data.clientName ?? null,
      constraints: data.constraints ?? null,
      prohibitions: data.prohibitions ?? null,
      evidence: data.evidence ?? null,
      moderatorNotes: data.moderatorNotes ?? null,
      rewardRyoMin: data.rewardRyoMin,
      rewardRyoMax: data.rewardRyoMax,
      basePoints: data.basePoints,
      targetLevelId: targetLevel?.id ?? null,
      minRecommendedLevelId: minLevel?.id ?? null,
      groupSizeMin: data.groupSizeMin,
      groupSizeMax: data.groupSizeMax,
      eligibilityMode: data.eligibilityMode,
      expiresAt,
      publishedAt: data.publish ? new Date() : null,
      creatorId: current.session.userId,
      responsibleModeratorId: current.session.userId,
      visibility: { create: data.visibility },
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.created",
    resourceType: "mission",
    resourceId: mission.id,
    newValues: { code, rank: data.rank, publish: data.publish },
    ...meta,
  });

  if (data.publish && data.notifyLeaders) {
    const leaders = await groupLeaderIds();
    await enqueueNotifications({
      userIds: leaders,
      event: "MISSION_AVAILABLE",
      payload: {
        code,
        rank: data.rank,
        category: data.category,
        title: data.publicTitle,
        rewardMin: data.rewardRyoMin,
        rewardMax: data.rewardRyoMax,
      },
      missionId: mission.id,
      batchKey: "missions:new",
    });
  }

  redirect(`/missions/${mission.id}`);
}

/**
 * Modifie un contrat existant. Le code public et le créateur restent
 * immuables ; tous les champs éditables repassent par le même schéma Zod que
 * la création. Un brouillon peut être publié depuis l'éditeur, mais une
 * mission déjà publiée ne redevient jamais brouillon implicitement.
 */
export async function updateMissionAction(input: {
  missionId: string;
  values: unknown;
}): Promise<UpdateMissionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_UPDATE)) {
    return { ok: false, error: "Permission refusée." };
  }

  const parsed = missionCreateSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const existing = await prisma.mission.findUnique({
    where: { id: input.missionId },
    include: {
      visibility: true,
      assignments: { where: { active: true }, select: { groupId: true } },
    },
  });
  if (!existing || existing.status === "ARCHIVED") {
    return { ok: false, error: "Mission introuvable ou supprimée." };
  }

  let expiresAt: Date | null = null;
  if (data.expiresAt) {
    expiresAt = new Date(data.expiresAt);
    const unchanged = existing.expiresAt?.getTime() === expiresAt.getTime();
    if (!unchanged && expiresAt <= new Date()) {
      return { ok: false, error: "La nouvelle date d'expiration doit être dans le futur." };
    }
  } else if (data.rpDuration) {
    const ms = rpToRealMs(data.rpDuration, await getRpTimeConfig());
    if (ms > 0) expiresAt = new Date(Date.now() + ms);
  }

  const [targetLevel, minLevel] = await Promise.all([
    data.targetLevelSlug
      ? prisma.playerLevel.findUnique({ where: { slug: data.targetLevelSlug } })
      : null,
    data.minRecommendedLevelSlug
      ? prisma.playerLevel.findUnique({ where: { slug: data.minRecommendedLevelSlug } })
      : null,
  ]);

  const publishDraft = existing.status === "DRAFT" && data.publish;
  const nextStatus = publishDraft ? "AVAILABLE" : existing.status;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.mission.updateMany({
        // Le statut doit être inchangé : une suppression ou une transition
        // concurrente ne peut pas être écrasée silencieusement.
        where: { id: existing.id, status: existing.status },
        data: {
          status: nextStatus,
          rank: data.rank,
          category: data.category,
          publicTitle: data.publicTitle,
          internalTitle: data.internalTitle ?? null,
          publicSummary: data.publicSummary ?? null,
          confidentialDescription: data.confidentialDescription ?? null,
          primaryObjective: data.primaryObjective ?? null,
          secondaryObjectives: data.secondaryObjectives,
          targetIdentity: data.targetIdentity ?? null,
          location: data.location ?? null,
          clientName: data.clientName ?? null,
          constraints: data.constraints ?? null,
          prohibitions: data.prohibitions ?? null,
          evidence: data.evidence ?? null,
          moderatorNotes: data.moderatorNotes ?? null,
          rewardRyoMin: data.rewardRyoMin,
          rewardRyoMax: data.rewardRyoMax,
          basePoints: data.basePoints,
          targetLevelId: targetLevel?.id ?? null,
          minRecommendedLevelId: minLevel?.id ?? null,
          groupSizeMin: data.groupSizeMin,
          groupSizeMax: data.groupSizeMax,
          eligibilityMode: data.eligibilityMode,
          expiresAt,
          publishedAt: publishDraft ? new Date() : existing.publishedAt,
          responsibleModeratorId: current.session.userId,
        },
      });
      if (updated.count === 0) throw new Error("CONCURRENT_UPDATE");

      await tx.missionVisibility.upsert({
        where: { missionId: existing.id },
        create: { missionId: existing.id, ...data.visibility },
        update: data.visibility,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return {
        ok: false,
        error: "La mission vient d'être modifiée — rechargez la page avant d'enregistrer.",
      };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.updated",
    resourceType: "mission",
    resourceId: existing.id,
    oldValues: { status: existing.status, rank: existing.rank },
    newValues: { status: nextStatus, rank: data.rank, published: publishDraft },
    ...meta,
  });

  const payload = {
    code: existing.code,
    rank: data.rank,
    category: data.category,
    title: data.publicTitle,
  };
  if (publishDraft && data.notifyLeaders) {
    await enqueueNotifications({
      userIds: await groupLeaderIds(),
      event: "MISSION_AVAILABLE",
      payload,
      missionId: existing.id,
      batchKey: "missions:new",
    });
  } else if (
    data.notifyLeaders &&
    existing.status !== "DRAFT" &&
    existing.assignments.length > 0
  ) {
    const recipients = new Set<string>();
    for (const assignment of existing.assignments) {
      for (const userId of await groupMemberIds(assignment.groupId)) recipients.add(userId);
    }
    recipients.delete(current.session.userId);
    await enqueueNotifications({
      userIds: [...recipients],
      event: "MISSION_UPDATED",
      payload,
      missionId: existing.id,
      batchKey: `update:${existing.id}`,
    });
  }

  revalidatePath("/missions");
  revalidatePath(`/missions/${existing.id}`);
  redirect(`/missions/${existing.id}`);
}
