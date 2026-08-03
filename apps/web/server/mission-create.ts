"use server";

import { redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS, missionCreateSchema, rpToRealMs } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, factionLeaderIds } from "@/server/notifications";
import { getRpTimeConfig } from "@/server/rp-config";

export interface CreateMissionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

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
    const leaders = await factionLeaderIds();
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
