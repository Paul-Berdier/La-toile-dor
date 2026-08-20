"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  PROFILE_FIELD_LABELS,
  REPORT_IMAGES_MAX,
  REPORT_IMAGE_MAX_BYTES,
  missionReportFinalizeSchema,
  missionReportPayloadSchema,
  parseContributionValue,
  sanitizeMissionReportPayload,
  untreatedDossiers,
  type ProfileFieldKey,
  type ReportIntelEntry,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, userIdsWithPermission } from "@/server/notifications";
import { sniffImageMime, isFileLike } from "@/server/image-validation";
import { getAccessContext } from "@/server/missions";
import {
  getProfileViewer,
  decideAccessForGroup,
  toAccessTarget,
  accessTargetSelect,
} from "@/server/profiles/access";
import { createOwnedProfile } from "@/server/profiles/create";
import {
  applyContributionValue,
  assertContributionOptions,
  contributionConflicts,
  describeContributionValue,
} from "@/server/profiles/contributions";
import { findSimilarProfiles } from "@/server/profiles/queries";
import { toStoredMissionReportPayload } from "@/server/missions/report-payload";

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
  /** Empreinte du payload exact ayant produit l'avertissement. */
  duplicateConfirmationToken?: string;
}

type ReportTx = Prisma.TransactionClient;

/**
 * Message français lisible pour une erreur de validation du rapport. Le
 * client valide déjà avant d'envoyer : ceci est le filet de sécurité — il ne
 * doit pas parler anglais (« Required ») ni pointer un chemin JSON brut.
 */
function formatReportIssue(issue?: { message?: string; path?: (string | number)[] }): string {
  if (!issue) return "Rapport incomplet.";
  const TRANSLATIONS: Record<string, string> = {
    Required: "Valeur manquante",
    "Invalid cuid": "Référence invalide",
    "Invalid input": "Valeur invalide",
    "Expected string, received null": "Valeur manquante",
  };
  const message = TRANSLATIONS[issue.message ?? ""] ?? issue.message ?? "Valeur invalide.";
  const path = issue.path ?? [];
  let where = "";
  if (path[0] === "dossiers" && typeof path[1] === "number") where = `Dossier n°${path[1] + 1}`;
  else if (path[0] === "discovered" && typeof path[1] === "number") where = `Ninja découvert n°${path[1] + 1}`;
  else if (path[0] === "outcomes") where = "Sort d'une cible";
  else if (path[0] === "summary") where = "Résumé";
  const fieldIndex = path.indexOf("entries");
  if (fieldIndex >= 0) where += `${where ? ", " : ""}renseignement n°${Number(path[fieldIndex + 1] ?? 0) + 1}`;
  return where ? `${where} : ${message}` : message;
}

/** Toutes les écritures draft/final prennent le même verrou de mission. */
async function lockMission(tx: ReportTx, missionId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Mission" WHERE "id" = ${missionId} FOR UPDATE
  `;
}

async function assertLiveReporter(
  tx: ReportTx,
  input: {
    missionId: string;
    groupId: string;
    actorId: string;
    isModerator: boolean;
    requireInProgress?: boolean;
  },
) {
  await lockMission(tx, input.missionId);
  const mission = await tx.mission.findUnique({
    where: { id: input.missionId },
    select: {
      status: true,
      assignedGroupId: true,
      assignments: { where: { active: true }, select: { groupId: true } },
      // role TARGET : le rapport porte sur les cibles, pas sur les commanditaires
      targets: { where: { role: "TARGET" }, select: { id: true, profileId: true } },
    },
  });
  if (!mission || !["ASSIGNED", "IN_PROGRESS"].includes(mission.status)) {
    throw new Error("MISSION_CLOSED");
  }
  if (input.requireInProgress && mission.status !== "IN_PROGRESS") {
    throw new Error("REPORT_NOT_READY");
  }
  const assigned = new Set(mission.assignments.map((a) => a.groupId));
  // Colonne de compatibilité : elle ne complète les assignments que pour une
  // mission historique qui n'en possède aucun.
  if (assigned.size === 0 && mission.assignedGroupId) assigned.add(mission.assignedGroupId);
  if (!assigned.has(input.groupId)) throw new Error("REPORTER_CHANGED");

  if (!input.isModerator) {
    const membership = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId: input.groupId, userId: input.actorId } },
      select: { isLeader: true, group: { select: { isActive: true } } },
    });
    if (!membership?.isLeader || !membership.group.isActive) throw new Error("REPORTER_CHANGED");
  }
  return mission;
}

/** Compatibilité historique : les anciens finals n'avaient pas de groupe. */
async function hasFinalReportForGroup(
  tx: ReportTx,
  missionId: string,
  groupId: string,
  actorId: string,
): Promise<boolean> {
  const exact = await tx.missionReport.findFirst({
    where: { missionId, reportingGroupId: groupId, isFinal: true },
    select: { id: true },
  });
  if (exact) return true;
  const legacy = await tx.missionReport.findMany({
    where: { missionId, reportingGroupId: null, isFinal: true },
    select: { authorId: true },
  });
  if (legacy.some((report) => report.authorId === actorId)) return true;
  if (legacy.length === 0) return false;
  return (await tx.groupMember.count({
    where: { groupId, userId: { in: legacy.map((report) => report.authorId) } },
  })) > 0;
}

function duplicateToken(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Le rapporteur : le CHEF d'un groupe attribué (actif), ou la modération.
 * Renvoie le groupe au nom duquel il rapporte — plusieurs groupes possibles
 * impliquent un choix explicite dans l'interface.
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
      targets: { where: { role: "TARGET" }, select: { id: true, profileId: true } },
    },
  });
  if (!mission) return { current, ctx, mission: null, groupId: null, error: "Mission introuvable." };

  const assigned = new Set(mission.assignments.map((a) => a.groupId));
  if (assigned.size === 0 && mission.assignedGroupId) assigned.add(mission.assignedGroupId);
  // Seuls les CHEFS des groupes attribués rapportent (le rapport nomme les
  // cibles, dont l'identité est réservée à ce niveau) — et la modération.
  const ledIds = new Set(ctx.ledGroups.map((g) => g.id));
  const myAssigned = [...assigned].filter((g) => ledIds.has(g));
  const participantGroup = mission.participants[0]?.groupId ?? null;

  let groupId: string | null = null;
  if (preferredGroupId) {
    if (!assigned.has(preferredGroupId)) {
      return { current, ctx, mission, groupId: null, error: "Ce groupe n'est pas attribué à cette mission." };
    }
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
    return {
      current, ctx, mission, groupId: null,
      error: "Le rapport de fin de mission est déposé par le chef d'un groupe attribué (ou la modération).",
    };
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
  if (!parsed.success) {
    return { ok: false, error: `Brouillon invalide — ${formatReportIssue(parsed.error.errors[0])}` };
  }
  const r = await resolveReporter(input.missionId, input.groupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  if (!["ASSIGNED", "IN_PROGRESS"].includes(r.mission.status)) {
    return { ok: false, error: "La mission n'est plus en cours." };
  }
  const payload = sanitizeMissionReportPayload(parsed.data);
  try {
    await prisma.$transaction(async (tx) => {
      await assertLiveReporter(tx, {
        missionId: r.mission!.id,
        groupId: r.groupId!,
        actorId: r.current.session.userId,
        isModerator: r.ctx.isModerator,
      });
      if (await hasFinalReportForGroup(tx, r.mission!.id, r.groupId!, r.current.session.userId)) {
        throw new Error("ALREADY_FINAL");
      }
      await tx.missionReportDraft.upsert({
        where: { missionId_groupId: { missionId: r.mission!.id, groupId: r.groupId! } },
        update: { payload: payload as never, authorId: r.current.session.userId },
        create: {
          missionId: r.mission!.id,
          groupId: r.groupId!,
          authorId: r.current.session.userId,
          payload: payload as never,
        },
      });
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_FINAL") {
      return { ok: false, error: "Votre groupe a déjà déposé son rapport final." };
    }
    if (error instanceof Error && error.message === "MISSION_CLOSED") {
      return { ok: false, error: "La mission n'est plus en cours." };
    }
    if (error instanceof Error && error.message === "REPORTER_CHANGED") {
      return { ok: false, error: "L'attribution ou votre rôle de chef vient de changer." };
    }
    if ((error as { code?: string }).code === "P2034") {
      return { ok: false, error: "Une autre sauvegarde a eu lieu ; réessayez." };
    }
    throw error;
  }
  return { ok: true };
}

export async function discardMissionReportDraftAction(input: {
  missionId: string;
  groupId?: string;
}): Promise<ReportActionResult> {
  const r = await resolveReporter(input.missionId, input.groupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  try {
    await prisma.$transaction(async (tx) => {
      await assertLiveReporter(tx, {
        missionId: r.mission!.id,
        groupId: r.groupId!,
        actorId: r.current.session.userId,
        isModerator: r.ctx.isModerator,
      });
      await tx.missionReportDraft.deleteMany({ where: { missionId: r.mission!.id, groupId: r.groupId! } });
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
  } catch (error) {
    if (error instanceof Error && ["MISSION_CLOSED", "REPORTER_CHANGED"].includes(error.message)) {
      return { ok: false, error: "Le brouillon ne peut plus être modifié : la mission ou votre attribution a changé." };
    }
    if ((error as { code?: string }).code === "P2034") {
      return { ok: false, error: "Une sauvegarde simultanée a eu lieu ; réessayez." };
    }
    throw error;
  }
  revalidatePath(`/missions/${r.mission.id}`);
  return { ok: true };
}

/**
 * « Déposer le rapport final et enregistrer les renseignements » — TOUT ou RIEN :
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
  const suppliedDuplicateToken = String(formData.get("duplicateConfirmationToken") ?? "");
  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { ok: false, error: "Rapport illisible." };
  }
  const parsed = missionReportFinalizeSchema.safeParse({ ...(payloadRaw as object), missionId });
  if (!parsed.success) {
    return { ok: false, error: formatReportIssue(parsed.error.errors[0]) };
  }
  const payload = parsed.data;
  // Le rapport conserve l'observation propre à ce groupe, indépendamment de
  // l'outcome canonique de MissionTarget que la modération pourra consolider.
  // `missionId` n'est pas dupliqué dans le JSON : la FK du rapport fait foi.
  const structuredPayload = toStoredMissionReportPayload(payload);

  const r = await resolveReporter(missionId, preferredGroupId);
  if (!r.mission || !r.groupId) return { ok: false, error: r.error ?? "Refusé." };
  const { current, mission, groupId } = r;
  if (mission.status !== "IN_PROGRESS") {
    return {
      ok: false,
      error:
        mission.status === "ASSIGNED"
          ? "La mission doit avoir commencé avant le dépôt du rapport final."
          : "La mission n'est plus en cours : le rapport final ne peut plus être déposé.",
    };
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
  const outcomeIds = new Set(payload.outcomes.map((o) => o.targetId));
  if (
    payload.outcomes.some((o) => !targetIds.has(o.targetId)) ||
    outcomeIds.size !== targetIds.size ||
    [...targetIds].some((id) => !outcomeIds.has(id))
  ) {
    return { ok: false, error: "Le sort de chaque cible de la mission doit être renseigné une seule fois." };
  }
  // Un dossier non « rattaché » doit être une cible officielle ; un dossier
  // rattaché par l'équipe (ninja croisé déjà fiché) est accepté s'il existe —
  // ses renseignements passeront par la revue comme toute contribution.
  if (payload.dossiers.some((d) => !d.linked && !targetProfileIds.includes(d.profileId))) {
    return { ok: false, error: "Un dossier du rapport n'est pas une cible de cette mission." };
  }
  if (payload.dossiers.some((d) => d.linked && d.entries.length === 0)) {
    return { ok: false, error: "Un dossier rattaché ne porte aucun renseignement : ajoutez-en ou retirez-le." };
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
  if (payload.discovered.length > 0) {
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
    if (duplicates.length > 0) {
      const expectedToken = duplicateToken(payload.discovered);
      if (suppliedDuplicateToken !== expectedToken) {
        return { ok: false, duplicates, duplicateConfirmationToken: expectedToken };
      }
    }
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
      // Même verrou que l'autosave et protocole Serializable commun avec la
      // clôture : statut, assignment, rôle de chef et cibles sont relus ici.
      const live = await assertLiveReporter(tx, {
        missionId: mission.id,
        groupId,
        actorId,
        isModerator: r.ctx.isModerator,
        requireInProgress: true,
      });
      const liveTargetIds = new Set(live.targets.map((target) => target.id));
      const liveProfileIds = new Set(live.targets.map((target) => target.profileId).filter((id): id is string => Boolean(id)));
      if (
        liveTargetIds.size !== targetIds.size ||
        [...liveTargetIds].some((id) => !targetIds.has(id)) ||
        liveProfileIds.size !== new Set(targetProfileIds).size ||
        [...liveProfileIds].some((id) => !targetProfileIds.includes(id))
      ) {
        throw new Error("TARGETS_CHANGED");
      }
      if (await hasFinalReportForGroup(tx, mission.id, groupId, actorId)) throw new Error("ALREADY_FINAL");

      // 1) Rapport final + preuves
      await tx.missionReport.create({
        data: {
          missionId: mission.id,
          authorId: actorId,
          reportingGroupId: groupId,
          payload: structuredPayload as never,
          content: payload.summary,
          isFinal: true,
          images: { create: images },
        },
      });

      // 2) Sort des cibles
      const now = new Date();
      for (const o of payload.outcomes) {
        // En mission multi-groupes, chaque rapport reste une observation
        // indépendante dans MissionReport.payload. Écraser ici l'outcome
        // global ferait gagner silencieusement le dernier groupe à cliquer ;
        // la modération consolide donc le sort canonique depuis le panneau des
        // cibles. Pour une mission mono-groupe, l'observation est canonique.
        if (live.assignments.length <= 1) {
          await tx.missionTarget.update({
            where: { id: o.targetId },
            data: {
              outcome: o.outcome,
              note: o.note || null,
              recordedAt: now,
              recordedById: actorId,
            },
          });
        }
        summary.outcomesRecorded += 1;
      }

      // 3) Renseignements par dossier
      const contribute = async (profileId: string, entry: ReportIntelEntry, profileCanEdit: boolean) => {
        const fieldKey = entry.fieldKey as ProfileFieldKey;
        const none = entry.knowledgeState === "NONE_CONFIRMED";
        // Valeur validée ET nettoyée ; options de référentiel du bon type
        const value = none ? null : parseContributionValue(fieldKey, entry.value);
        if (!none) await assertContributionOptions(tx, fieldKey, value);
        const proposedLabel = none ? "Aucun (vérifié)" : await describeContributionValue(tx, fieldKey, value);
        const conflicts = profileCanEdit ? false : await contributionConflicts(tx, profileId, fieldKey, proposedLabel, none);
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
        // « Aucune nouvelle information » l'emporte sur des entrées oubliées
        if (d.noNewInfo || d.entries.length === 0) continue;
        const profile = await tx.characterProfile.findUnique({
          where: { id: d.profileId },
          select: accessTargetSelect,
        });
        // Perdre silencieusement des renseignements saisis serait pire qu'un
        // refus : l'équipe doit retirer le bloc en connaissance de cause.
        if (!profile || profile.archivedAt) throw new Error("DOSSIER_ARCHIVED");
        // Le groupe créateur (ou la modération) écrit directement dans SON dossier
        const canEdit = decideAccessForGroup(viewer, toAccessTarget(profile), groupId).canEdit;
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
            newValue: { created: true, discoveredInMission: mission.code, groupId, outcome: d.outcome },
            changedById: actorId,
            sourceMissionId: mission.id,
          },
        });
        // Ne devient PAS une MissionTarget globale : en multi-groupes, cela
        // révélerait immédiatement le nouveau dossier aux autres équipes. Le
        // lien mission reste porté par l'octroi, la révision et les sources.
        for (const entry of d.entries) await contribute(created.id, entry, true);
        summary.discoveredProfiles.push({ id: created.id, code: created.code, firstName: created.characterFirstName });
      }

      // 5) Le brouillon a servi
      await tx.missionReportDraft.deleteMany({ where: { missionId: mission.id, groupId } });
    }, { isolationLevel: "Serializable", timeout: 30_000, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSION_CLOSED") {
      return { ok: false, error: "La mission vient d'être close : le rapport n'a pas été enregistré." };
    }
    if (error instanceof Error && error.message === "ALREADY_FINAL") {
      return { ok: false, error: "Votre groupe a déjà déposé son rapport final pour cette mission." };
    }
    if (error instanceof Error && error.message === "REPORTER_CHANGED") {
      return { ok: false, error: "L'attribution ou votre rôle de chef vient de changer." };
    }
    if (error instanceof Error && error.message === "REPORT_NOT_READY") {
      return { ok: false, error: "La mission doit être en cours avant le dépôt du rapport final." };
    }
    if (error instanceof Error && error.message === "TARGETS_CHANGED") {
      return { ok: false, error: "Les cibles de la mission viennent de changer : rechargez le rapport." };
    }
    if (error instanceof Error && error.message === "DOSSIER_ARCHIVED") {
      return {
        ok: false,
        error: "Un dossier du rapport a été archivé ou fusionné entre-temps : retirez son bloc puis redéposez.",
      };
    }
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "Votre groupe a déjà déposé son rapport final pour cette mission." };
    }
    if ((error as { code?: string }).code === "P2034") {
      return { ok: false, error: "La mission a changé pendant la finalisation : rechargez puis réessayez." };
    }
    // Seules les validations de référentiel explicitement produites par notre
    // service sont montrées ; aucune erreur interne brute ne quitte le serveur.
    if (
      error instanceof Error &&
      /^(Option de référentiel invalide|Faction inconnue|Grade inconnu|Le champ .* ne se déclare pas|Le champ .* ne peut pas être vidé)/.test(
        error.message,
      )
    ) {
      return { ok: false, error: error.message };
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
