"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  PROFILE_FIELD_LABELS,
  REPORT_IMAGES_MAX,
  REPORT_IMAGE_MAX_BYTES,
  missionReportFinalizeSchema,
  missionReportPayloadSchema,
  untreatedDossiers,
  type ProfileFieldKey,
  type ReportIntelEntry,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, userIdsWithPermission } from "@/server/notifications";
import { sniffImageMime, isFileLike } from "@/server/image-validation";
import { getAccessContext } from "@/server/missions";
import { getProfileViewer, decideAccess, toAccessTarget, accessTargetSelect } from "@/server/profiles/access";
import { createOwnedProfile } from "@/server/profiles/create";
import { applyContributionValue, contributionConflicts, describeContributionValue } from "@/server/profiles/contributions";
import { findSimilarProfiles } from "@/server/profiles/queries";

export interface ReportActionResult {
  ok: boolean;
  error?: string;
  /** Finalisation : ce qui a été fait, pour le dire à l'équipe */
  summary?: {
    contributions: number;
    appliedDirectly: number;
    discoveredProfiles: { id: string; code: string; firstName: string }[];
    outcomesRecorded: number;
  };
  /** Doublons potentiels pour les ninjas découverts (non bloquant : confirmer) */
  duplicates?: { localId: string; matches: { id: string; code: string; name: string }[] }[];
}

/**
 * Le rapporteur : un membre d'un groupe ATTRIBUÉ (actif) à la mission, ou
 * un participant nommément engagé, ou la modération. Renvoie le groupe au nom
 * duquel il rapporte — un membre de deux groupes engagés doit choisir.
 */
async function resolveReporter(missionId: string, preferredGroupId?: string) {
  const current = await requireUser();
  const ctx = await getAccessContext(current);
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: {
      id: true,
      code: true,
      status: true,
      publicTitle: true,
      rank: true,
      category: true,
      assignedGroupId: true,
      assignments: { where: { active: true }, select: { groupId: true } },
      participants: { where: { userId: current.session.userId }, select: { groupId: true } },
      targets: { select: { id: true, profileId: true } },
    },
  });
  if (!mission) return { current, ctx, mission: null, groupId: null, error: "Mission introuvable." };

  const assigned = new Set(mission.assignments.map((a) => a.groupId));
  if (mission.assignedGroupId) assigned.add(mission.assignedGroupId);
  const myAssigned = [...assigned].filter((g) => ctx.groupIds.has(g));
  const participantGroup = mission.participants[0]?.groupId ?? null;

  let groupId: string | null = null;
  if (preferredGroupId) {
    if (!myAssigned.includes(preferredGroupId) && !ctx.isModerator) {
      return { current, ctx, mission, groupId: null, error: "Vous ne rapportez pas pour ce groupe." };
    }
    groupId = preferredGroupId;
  } else if (participantGroup && myAssigned.includes(participantGroup)) {
    groupId = participantGroup;
  } else if (myAssigned.length === 1) {
    groupId = myAssigned[0]!;
  } else if (myAssigned.length > 1) {
    return { current, ctx, mission, groupId: null, error: "Précisez pour quel groupe vous rapportez." };
  } else if (ctx.isModerator) {
    // La modération peut rapporter au nom du groupe attribué unique
    groupId = assigned.size === 1 ? [...assigned][0]! : null;
    if (!groupId) return { current, ctx, mission, groupId: null, error: "Précisez pour quel groupe vous rapportez." };
  } else {
    return { current, ctx, mission, groupId: null, error: "Vous n'êtes pas engagé sur cette mission." };
  }
  return { current, ctx, mission, groupId, error: null };
}

/** Brouillon sauvegardé au fil de la saisie — le même objet que la finalisation. */
export async function saveMissionReportDraftAction(input: {
  missionId: string;
  groupId?: string;
  payload: unknown;
}): Promise<ReportActionResult> {
  const parsed = missionReportPayloadSchema.safeParse(input.payload);
  if (!parsed.success) return { ok: false, error: "Brouillon invalide." };
  const r = await resolveReporter(input.missionId, input.groupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  if (!["ASSIGNED", "IN_PROGRESS"].includes(r.mission.status)) {
    return { ok: false, error: "La mission n'est plus en cours." };
  }
  await prisma.missionReportDraft.upsert({
    where: { missionId_groupId: { missionId: r.mission.id, groupId: r.groupId } },
    update: { payload: parsed.data as never, authorId: r.current.session.userId },
    create: {
      missionId: r.mission.id,
      groupId: r.groupId,
      authorId: r.current.session.userId,
      payload: parsed.data as never,
    },
  });
  return { ok: true };
}

export async function discardMissionReportDraftAction(input: {
  missionId: string;
  groupId?: string;
}): Promise<ReportActionResult> {
  const r = await resolveReporter(input.missionId, input.groupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  await prisma.missionReportDraft.deleteMany({ where: { missionId: r.mission.id, groupId: r.groupId } });
  revalidatePath(`/missions/${r.mission.id}`);
  return { ok: true };
}

/**
 * « Terminer la mission et enregistrer les renseignements » — TOUT ou RIEN :
 * rapport final + preuves, sort des cibles, contributions par dossier,
 * nouveaux dossiers pour les ninjas découverts, brouillon effacé. Si une
 * étape échoue, rien n'est écrit et l'équipe garde son brouillon.
 *
 * Multi-groupes : les contributions sont attribuées au groupe qui rapporte ;
 * aucun autre groupe n'en gagne l'accès — cela reste la décision de la
 * modération à la clôture (MISSION_GRANTED).
 */
export async function finalizeMissionReportAction(formData: FormData): Promise<ReportActionResult> {
  const missionId = String(formData.get("missionId") ?? "");
  const preferredGroupId = String(formData.get("groupId") ?? "") || undefined;
  const confirmDuplicates = formData.get("confirmDuplicates") === "true";
  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { ok: false, error: "Rapport illisible." };
  }
  const parsed = missionReportFinalizeSchema.safeParse({ ...(payloadRaw as object), missionId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Rapport incomplet." };
  }
  const payload = parsed.data;

  const r = await resolveReporter(missionId, preferredGroupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  const { current, mission, groupId } = r;
  if (!["ASSIGNED", "IN_PROGRESS"].includes(mission.status)) {
    return { ok: false, error: "La mission n'est plus en cours : le rapport final ne peut plus être déposé." };
  }

  // Chaque dossier cible doit avoir été traité (« rien de neuf » compte)
  const targetProfileIds = mission.targets.map((t) => t.profileId).filter((id): id is string => Boolean(id));
  const untreated = untreatedDossiers(payload, targetProfileIds);
  if (untreated.length > 0) {
    return {
      ok: false,
      error: `${untreated.length} dossier(s) cible(s) n'ont pas été traités : indiquez ce que vous avez appris, ou « Aucune nouvelle information ».`,
    };
  }
  // Les sorts ne visent que des cibles de CETTE mission
  const targetIds = new Set(mission.targets.map((t) => t.id));
  if (payload.outcomes.some((o) => !targetIds.has(o.targetId))) {
    return { ok: false, error: "Une cible du rapport n'appartient pas à cette mission." };
  }
  if (payload.dossiers.some((d) => !targetProfileIds.includes(d.profileId))) {
    return { ok: false, error: "Un dossier du rapport n'est pas une cible de cette mission." };
  }

  // Preuves visuelles (validées par signature, jamais par le type déclaré)
  const files = formData.getAll("images").filter((f) => isFileLike(f) && f.size > 0) as File[];
  if (files.length > REPORT_IMAGES_MAX) return { ok: false, error: `${REPORT_IMAGES_MAX} images maximum.` };
  const images: { imageData: Buffer<ArrayBuffer>; imageMime: string; sizeBytes: number }[] = [];
  for (const file of files) {
    if (file.size > REPORT_IMAGE_MAX_BYTES) return { ok: false, error: "Une image dépasse 2 Mo." };
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) return { ok: false, error: "Une image est refusée : PNG, JPG/JPEG ou WEBP uniquement." };
    images.push({ imageData: bytes, imageMime: mime, sizeBytes: bytes.length });
  }

  // Ninjas découverts : doublons signalés une fois, puis confirmés
  if (payload.discovered.length > 0 && !confirmDuplicates) {
    const duplicates: NonNullable<ReportActionResult["duplicates"]> = [];
    for (const d of payload.discovered) {
      const similar = await findSimilarProfiles(d.firstName);
      if (similar.length > 0) {
        duplicates.push({
          localId: d.localId,
          matches: similar.map((p) => ({
            id: p.id,
            code: p.code,
            name: [p.characterFirstName, p.characterLastName].filter(Boolean).join(" "),
          })),
        });
      }
    }
    if (duplicates.length > 0) return { ok: false, duplicates };
  }

  const viewer = await getProfileViewer(current);
  const actorId = current.session.userId;
  const summary: NonNullable<ReportActionResult["summary"]> = {
    contributions: 0,
    appliedDirectly: 0,
    discoveredProfiles: [],
    outcomesRecorded: 0,
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Statut relu DANS la transaction : une clôture concurrente ne doit pas
      // laisser un rapport final orphelin.
      const live = await tx.mission.findUnique({ where: { id: mission.id }, select: { status: true } });
      if (!live || !["ASSIGNED", "IN_PROGRESS"].includes(live.status)) throw new Error("MISSION_CLOSED");

      // 1) Rapport final + preuves
      await tx.missionReport.create({
        data: {
          missionId: mission.id,
          authorId: actorId,
          content: payload.summary,
          isFinal: true,
          images: { create: images },
        },
      });

      // 2) Sort des cibles
      const now = new Date();
      for (const o of payload.outcomes) {
        await tx.missionTarget.update({
          where: { id: o.targetId },
          data: { outcome: o.outcome, note: o.note || null, recordedAt: now, recordedById: actorId },
        });
        summary.outcomesRecorded += 1;
      }

      // 3) Renseignements par dossier
      const contribute = async (profileId: string, entry: ReportIntelEntry, profileCanEdit: boolean) => {
        const fieldKey = entry.fieldKey as ProfileFieldKey;
        const none = entry.knowledgeState === "NONE_CONFIRMED";
        const value = none ? null : entry.value;
        const proposedLabel = none ? "Aucun (vérifié)" : await describeContributionValue(tx, fieldKey, value);
        const conflicts = profileCanEdit ? false : await contributionConflicts(tx, profileId, fieldKey, proposedLabel);
        await tx.profileIntelContribution.create({
          data: {
            profileId,
            fieldKey,
            proposedValue: (value ?? { noneConfirmed: true }) as never,
            proposedLabel,
            knowledgeState: entry.knowledgeState,
            confidence: entry.confidence ?? null,
            note: entry.note || null,
            sourceType: "MISSION",
            groupId,
            contributorId: actorId,
            sourceMissionId: mission.id,
            status: profileCanEdit ? "APPLIED" : "PENDING_REVIEW",
            conflictsWithExisting: conflicts,
            ...(profileCanEdit ? { reviewedById: actorId, reviewedAt: now } : {}),
          },
        });
        summary.contributions += 1;
        if (profileCanEdit) {
          summary.appliedDirectly += 1;
          await applyContributionValue(tx, profileId, fieldKey, value, none ? "NONE_CONFIRMED" : "REPLACE", {
            actorId,
            sourceMissionId: mission.id,
            confidence: entry.confidence ?? null,
            justification: entry.note || `Rapport de mission ${mission.code} (${PROFILE_FIELD_LABELS[fieldKey]})`,
          });
        }
      };

      for (const d of payload.dossiers) {
        if (d.entries.length === 0) continue;
        const profile = await tx.characterProfile.findUnique({
          where: { id: d.profileId },
          select: accessTargetSelect,
        });
        if (!profile || profile.archivedAt) continue;
        // Le groupe créateur (ou la modération) écrit directement dans SON dossier
        const canEdit = decideAccess(viewer, toAccessTarget(profile)).canEdit;
        for (const entry of d.entries) await contribute(d.profileId, entry, canEdit);
      }

      // 4) Ninjas découverts : nouveau dossier (propriété du groupe), cible
      //    de la mission, et ses renseignements écrits d'emblée — c'est SON
      //    dossier, il n'y a personne à qui demander.
      for (const d of payload.discovered) {
        const created = await createOwnedProfile(tx, {
          firstName: d.firstName,
          lastName: d.lastName ?? null,
          title: d.title ?? null,
          ownerGroupId: groupId,
          actorId,
          sourceMissionId: mission.id,
        });
        await tx.characterProfileRevision.create({
          data: {
            profileId: created.id,
            fieldKey: "profile",
            newValue: { created: true, discoveredInMission: mission.code, groupId },
            changedById: actorId,
            sourceMissionId: mission.id,
          },
        });
        await tx.missionTarget.create({
          data: {
            missionId: mission.id,
            profileId: created.id,
            outcome: d.outcome,
            recordedAt: now,
            recordedById: actorId,
          },
        });
        summary.outcomesRecorded += 1;
        for (const entry of d.entries) await contribute(created.id, entry, true);
        summary.discoveredProfiles.push({ id: created.id, code: created.code, firstName: created.characterFirstName });
      }

      // 5) Le brouillon a servi
      await tx.missionReportDraft.deleteMany({ where: { missionId: mission.id, groupId } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSION_CLOSED") {
      return { ok: false, error: "La mission vient d'être close : le rapport n'a pas été enregistré." };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId,
    action: "mission.final_report_submitted",
    resourceType: "mission",
    resourceId: mission.id,
    newValues: {
      groupId,
      imagesCount: images.length,
      contributions: summary.contributions,
      discovered: summary.discoveredProfiles.map((p) => p.code),
      outcomes: summary.outcomesRecorded,
    },
    ...meta,
  });

  const moderators = await userIdsWithPermission(PERMISSIONS.CLAIM_REVIEW);
  await enqueueNotifications({
    userIds: moderators.filter((id) => id !== actorId),
    event: "FINAL_REPORT_SUBMITTED",
    payload: { code: mission.code, rank: mission.rank, category: mission.category, title: mission.publicTitle },
    missionId: mission.id,
  });
  if (summary.contributions - summary.appliedDirectly > 0) {
    const reviewers = await userIdsWithPermission(PERMISSIONS.PROFILE_MANAGE);
    await enqueueNotifications({
      userIds: reviewers.filter((id) => id !== actorId),
      event: "PROFILE_CONTRIBUTION_RECEIVED",
      payload: { code: mission.code, title: mission.publicTitle, field: `${summary.contributions - summary.appliedDirectly} renseignement(s)` },
      batchKey: `profile-contrib:mission:${mission.id}`,
    });
  }

  revalidatePath(`/missions/${mission.id}`);
  revalidatePath("/profils");
  revalidatePath("/profils/contributions");
  return { ok: true, summary };
}
