"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  PROFILE_FIELD_LABELS,
  canDeclareNoneForField,
  canMergeField,
  contributionDecisionSchema,
  intelContributionSchema,
  parseContributionValue,
  type ContributionDecision,
  type ProfileFieldKey,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, userIdsWithPermission } from "@/server/notifications";
import {
  getProfileViewer,
  decideAccess,
  decideAccessForGroup,
  toAccessTarget,
  accessTargetSelect,
} from "./access";
import {
  applyContributionValue,
  assertContributionOptions,
  contributionConflicts,
  describeContributionValue,
  isContributableField,
} from "./contributions";
import {
  claimPendingContribution,
  isRetryableContributionTransactionError,
  lockContributionProfile,
  runContributionTransaction,
} from "./contribution-transactions";

/**
 * Messages d'erreur du service de contribution autorisés à remonter au
 * formulaire — même liste blanche que le rapport de mission. Tout autre
 * message pourrait, un jour, contenir une valeur : il part en 500 anonyme.
 */
const SAFE_CONTRIBUTION_ERROR =
  /^(Option de référentiel invalide|Faction inconnue|Grade inconnu|Le champ .* ne se déclare pas|Le champ .* ne peut pas être vidé)/;

export interface ContributionActionResult {
  ok: boolean;
  error?: string;
  /** « APPLIED » (écrit tout de suite) ou « PENDING_REVIEW » (à valider) */
  status?: "APPLIED" | "PENDING_REVIEW";
  contributionId?: string;
}

/**
 * Proposer un renseignement sur un dossier que l'on VOIT.
 *
 * - Auteur habilité à modifier (modération, groupe créateur) : la valeur est
 *   écrite sur-le-champ, et la contribution consignée APPLIED — même trace,
 *   même historique que le formulaire, mais sans passer par lui.
 * - Autre lecteur autorisé (acquéreur, groupe engagé) : la contribution est
 *   mise en attente. Si elle contredit ce qui est en place, c'est noté côté
 *   modération — JAMAIS renvoyé à l'auteur, qui reçoit le même message dans
 *   les deux cas.
 */
export async function submitIntelContributionAction(raw: unknown): Promise<ContributionActionResult> {
  const current = await requireUser();
  const parsed = intelContributionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Contribution invalide." };
  }
  const input = parsed.data;
  const fieldKey = input.fieldKey as ProfileFieldKey;

  const profile = await prisma.characterProfile.findUnique({
    where: { id: input.profileId },
    select: { ...accessTargetSelect, code: true, characterFirstName: true },
  });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };

  const viewer = await getProfileViewer(current);
  const access = decideAccess(viewer, toAccessTarget(profile));
  if (!access.canContribute) {
    return { ok: false, error: "Vous n'avez pas accès à ce dossier." };
  }

  // Groupe au nom duquel on contribue : celui indiqué s'il est bien le sien,
  // sinon l'unique groupe, sinon aucun (modération sans groupe : USER).
  let groupId: string | null = null;
  if (input.groupId) {
    if (!viewer.groupIds.includes(input.groupId)) {
      return { ok: false, error: "Vous n'appartenez pas à ce groupe." };
    }
    groupId = input.groupId;
  } else if (viewer.groupIds.length === 1) {
    groupId = viewer.groupIds[0]!;
  } else if (viewer.groupIds.length > 1 && !access.canAdminister) {
    return { ok: false, error: "Précisez au nom de quel groupe vous contribuez." };
  }
  const groupAccess = groupId
    ? decideAccessForGroup(viewer, toAccessTarget(profile), groupId)
    : access;

  // La mission source doit viser CE dossier et concerner le contributeur
  // (engagé dessus AU NOM DU GROUPE CHOISI) ou la modération. Vérifier la
  // seule attribution laisserait n'importe quel dossier lisible être faussement
  // sourcé par une mission sans rapport. La colonne legacy ne compte que si
  // la mission ne possède aucune attribution active.
  if (input.sourceMissionId) {
    const mission = await prisma.mission.findUnique({
      where: { id: input.sourceMissionId },
      select: {
        assignedGroupId: true,
        assignments: { where: { active: true }, select: { groupId: true } },
        targets: {
          where: { profileId: profile.id, role: "TARGET" },
          take: 1,
          select: { id: true },
        },
      },
    });
    const activeAssignmentGroups = new Set(mission?.assignments.map((a) => a.groupId) ?? []);
    const assignedToSelectedGroup =
      groupId !== null &&
      (activeAssignmentGroups.size > 0
        ? activeAssignmentGroups.has(groupId)
        : mission?.assignedGroupId === groupId);
    const validSource =
      !!mission &&
      mission.targets.length > 0 &&
      (access.canAdminister || assignedToSelectedGroup);
    if (!validSource) return { ok: false, error: "Mission source inconnue ou sans rapport avec vous." };
  } else if (!groupAccess.canContribute) {
    return { ok: false, error: "Ce groupe ne possède pas ce dossier." };
  }
  const sourceType = input.sourceMissionId ? "MISSION" : groupId ? "GROUP" : "USER";

  const none = input.knowledgeState === "NONE_CONFIRMED";
  // Valeur VALIDÉE et NETTOYÉE par le schéma du champ (pas la forme brute)
  const value = none ? null : parseContributionValue(fieldKey, input.value);
  // Le droit d'écrire est celui du GROUPE auquel on attribue la contribution,
  // pas celui d'un autre groupe dont la même personne est aussi membre.
  const directWrite = groupAccess.canEdit;

  let result: { id: string; conflicts: boolean };
  try {
    result = await runContributionTransaction(async (tx) => {
      await lockContributionProfile(tx, profile.id);
      if (!none) await assertContributionOptions(tx, fieldKey, value);
      const proposedLabel = none ? "Aucun (vérifié)" : await describeContributionValue(tx, fieldKey, value);
      const conflicts = directWrite
        ? false
        : await contributionConflicts(tx, profile.id, fieldKey, proposedLabel, none);

      const row = await tx.profileIntelContribution.create({
        data: {
          profileId: profile.id,
          fieldKey,
          proposedValue: (value ?? { noneConfirmed: true }) as never,
          proposedLabel,
          knowledgeState: input.knowledgeState,
          confidence: input.confidence ?? null,
          note: input.note || null,
          sourceType,
          groupId,
          contributorId: current.session.userId,
          sourceMissionId: input.sourceMissionId ?? null,
          status: directWrite ? "APPLIED" : "PENDING_REVIEW",
          conflictsWithExisting: conflicts,
          ...(directWrite
            ? { reviewedById: current.session.userId, reviewedAt: new Date() }
            : {}),
        },
        select: { id: true },
      });

      if (directWrite) {
        await applyContributionValue(
          tx,
          profile.id,
          fieldKey,
          value,
          none ? "NONE_CONFIRMED" : "REPLACE",
          {
            actorId: current.session.userId,
            sourceMissionId: input.sourceMissionId ?? null,
            confidence: input.confidence ?? null,
            justification: input.note || `Renseignement ajouté (${PROFILE_FIELD_LABELS[fieldKey]})`,
          },
        );
      }
      return { id: row.id, conflicts };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_UNAVAILABLE") {
      return { ok: false, error: "Ce dossier vient d'être archivé ou fusionné." };
    }
    if (isRetryableContributionTransactionError(error)) {
      return { ok: false, error: "Le dossier a été modifié en même temps ; réessayez." };
    }
    // Liste BLANCHE des messages montrés au formulaire : un passthrough de
    // tout Error.message finirait par fuir un message interne contenant une
    // valeur. Tout le reste part en 500 anonyme.
    if (error instanceof Error && SAFE_CONTRIBUTION_ERROR.test(error.message)) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: directWrite ? "profile.contribution_applied" : "profile.contribution_submitted",
    resourceType: "characterProfile",
    resourceId: profile.id,
    // Jamais la valeur : le champ, la source et le sort suffisent
    newValues: { contributionId: result.id, fieldKey, sourceType, groupId },
    ...meta,
  });

  if (directWrite) {
    await notifyHolders(profile.id, profile.code, current.session.userId, fieldKey);
  } else {
    const moderators = await userIdsWithPermission(PERMISSIONS.PROFILE_MANAGE);
    await enqueueNotifications({
      userIds: moderators.filter((id) => id !== current.session.userId),
      event: "PROFILE_CONTRIBUTION_RECEIVED",
      payload: { code: profile.code, title: profile.characterFirstName, field: PROFILE_FIELD_LABELS[fieldKey] },
      batchKey: `profile-contrib:${profile.id}`,
    });
  }

  revalidatePath(`/profils/${profile.id}`);
  revalidatePath("/profils/contributions");
  return { ok: true, status: directWrite ? "APPLIED" : "PENDING_REVIEW", contributionId: result.id };
}

/**
 * Revue d'une contribution en attente — modération, ou groupe créateur du
 * dossier (il complète « son » dossier, il tranche ce qu'on lui propose).
 */
export async function reviewIntelContributionAction(raw: unknown): Promise<ContributionActionResult> {
  const current = await requireUser();
  const parsed = contributionDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Décision invalide." };
  const { contributionId, decision, reviewNote } = parsed.data;

  const contribution = await prisma.profileIntelContribution.findUnique({
    where: { id: contributionId },
    include: { profile: { select: { ...accessTargetSelect, code: true, version: true } } },
  });
  if (!contribution) return { ok: false, error: "Contribution introuvable." };
  if (contribution.status !== "PENDING_REVIEW") {
    return { ok: false, error: "Cette contribution a déjà été tranchée." };
  }
  if (contribution.profile.archivedAt) return { ok: false, error: "Dossier archivé." };

  const viewer = await getProfileViewer(current);
  const access = decideAccess(viewer, toAccessTarget(contribution.profile));
  if (!access.canEdit) return { ok: false, error: "Vous ne pouvez pas trancher sur ce dossier." };

  if (!isContributableField(contribution.fieldKey)) {
    return { ok: false, error: "Cette contribution vise un champ qui n'est plus pris en charge." };
  }
  const fieldKey = contribution.fieldKey;
  const noneConfirmed = contribution.knowledgeState === "NONE_CONFIRMED";
  if (noneConfirmed && !canDeclareNoneForField(fieldKey)) {
    return { ok: false, error: "Ce champ ne peut pas être déclaré « absent »." };
  }
  if (decision === "MERGE" && (!canMergeField(fieldKey) || noneConfirmed)) {
    return {
      ok: false,
      error: noneConfirmed
        ? "Une absence ne se fusionne pas : acceptez (le champ devient « Aucun ») ou refusez."
        : "Ce champ ne se fusionne pas : acceptez ou refusez.",
    };
  }

  const nextStatus = (
    {
      ACCEPT: "ACCEPTED",
      REJECT: "REJECTED",
      MARK_CONTRADICTORY: "CONTRADICTORY",
      MERGE: "MERGED",
    } as const satisfies Record<ContributionDecision, string>
  )[decision];

  try {
    await runContributionTransaction(async (tx) => {
      // Ordre partagé avec la fusion : dossier d'abord, contribution ensuite.
      // Cela sérialise aussi deux contributions différentes au même dossier.
      const lockedProfile = await lockContributionProfile(tx, contribution.profileId);

      const claimed = await claimPendingContribution(tx, {
        contributionId: contribution.id,
        profileId: contribution.profileId,
        status: nextStatus,
        reviewerId: current.session.userId,
        reviewNote: reviewNote || null,
        reviewedAt: new Date(),
      });
      if (!claimed) throw new Error("ALREADY_REVIEWED");

      if (decision !== "REJECT" && lockedProfile.version !== contribution.profile.version) {
        throw new Error("PROFILE_CHANGED");
      }

      // `proposedValue` est du JSON stocké, donc une frontière non fiable : il
      // est reparsé et renettoyé au moment exact où la décision va s'appliquer.
      let value: unknown = null;
      if (!noneConfirmed && decision !== "REJECT") {
        try {
          value = parseContributionValue(fieldKey, contribution.proposedValue);
        } catch {
          throw new Error("INVALID_CONTRIBUTION_VALUE");
        }
        await assertContributionOptions(tx, fieldKey, value);
      }

      const ctx = {
        actorId: current.session.userId,
        sourceMissionId: contribution.sourceMissionId,
        confidence: contribution.confidence,
        justification:
          `${reviewNote ?? ""} [contribution ${contribution.id.slice(-6)} — ${decision.toLowerCase()}]`.trim(),
      };
      if (decision === "ACCEPT") {
        await applyContributionValue(
          tx,
          contribution.profileId,
          fieldKey,
          value,
          noneConfirmed ? "NONE_CONFIRMED" : "REPLACE",
          ctx,
        );
      } else if (decision === "MERGE") {
        await applyContributionValue(tx, contribution.profileId, fieldKey, value, "MERGE", ctx);
      } else if (decision === "MARK_CONTRADICTORY") {
        // Les deux versions sont gardées (l'existante en place, la proposée dans
        // la contribution) ; le champ s'affiche « contradictoire » pour tous.
        await tx.characterFieldIntel.upsert({
          where: { profileId_fieldKey: { profileId: contribution.profileId, fieldKey } },
          update: { knowledgeState: "CONFLICTING", updatedById: current.session.userId },
          create: {
            profileId: contribution.profileId,
            fieldKey,
            knowledgeState: "CONFLICTING",
            updatedById: current.session.userId,
          },
        });
        await tx.characterProfile.update({
          where: { id: contribution.profileId },
          data: { version: { increment: 1 }, updatedById: current.session.userId },
        });
        await tx.characterProfileRevision.create({
          data: {
            profileId: contribution.profileId,
            fieldKey,
            newValue: { contradictoryProposal: contribution.proposedLabel },
            changedById: current.session.userId,
            sourceMissionId: contribution.sourceMissionId,
            justification: `${reviewNote ?? ""} [marqué contradictoire]`.trim(),
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_REVIEWED") {
      return { ok: false, error: "Cette contribution vient d'être tranchée par quelqu'un d'autre." };
    }
    if (error instanceof Error && error.message === "PROFILE_CHANGED") {
      return { ok: false, error: "Le dossier a changé depuis l'ouverture de la revue ; rechargez-le avant de trancher." };
    }
    if (error instanceof Error && error.message === "PROFILE_UNAVAILABLE") {
      return { ok: false, error: "Ce dossier vient d'être archivé ou fusionné." };
    }
    if (error instanceof Error && error.message === "INVALID_CONTRIBUTION_VALUE") {
      return { ok: false, error: "La valeur enregistrée n'est plus valide pour ce champ." };
    }
    if (isRetryableContributionTransactionError(error)) {
      return { ok: false, error: "Une autre décision a modifié ce dossier ; rechargez puis réessayez." };
    }
    if (error instanceof Error && SAFE_CONTRIBUTION_ERROR.test(error.message)) {
      return { ok: false, error: error.message };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.contribution_reviewed",
    resourceType: "characterProfile",
    resourceId: contribution.profileId,
    newValues: { contributionId: contribution.id, fieldKey, decision },
    ...meta,
  });

  // Le contributeur apprend le sort de sa proposition — pas la valeur en place
  await enqueueNotifications({
    userIds: [contribution.contributorId].filter((id) => id !== current.session.userId),
    event: "PROFILE_CONTRIBUTION_REVIEWED",
    payload: {
      code: contribution.profile.code,
      field: PROFILE_FIELD_LABELS[fieldKey],
      decision,
      note: reviewNote ?? null,
    },
  });
  if (decision === "ACCEPT" || decision === "MERGE") {
    await notifyHolders(contribution.profileId, contribution.profile.code, current.session.userId, fieldKey);
  }

  revalidatePath(`/profils/${contribution.profileId}`);
  revalidatePath("/profils/contributions");
  return { ok: true };
}

/**
 * PROFILE_UPDATED : les groupes détenteurs apprennent qu'un dossier qu'ils
 * possèdent a changé — le champ, jamais la valeur (elle est dans le dossier,
 * qu'ils peuvent ouvrir). Documenté depuis longtemps, jamais émis jusqu'ici.
 */
async function notifyHolders(profileId: string, code: string, actorId: string, fieldKey: ProfileFieldKey) {
  const [grants, profile] = await Promise.all([
    prisma.profileAccessGrant.findMany({
      where: { profileId, revokedAt: null },
      select: { groupId: true },
    }),
    prisma.characterProfile.findUnique({ where: { id: profileId }, select: { createdByGroupId: true } }),
  ]);
  const groupIds = new Set(grants.map((g) => g.groupId));
  if (profile?.createdByGroupId) groupIds.add(profile.createdByGroupId);
  if (groupIds.size === 0) return;
  const members = await prisma.groupMember.findMany({
    where: { groupId: { in: [...groupIds] }, group: { isActive: true } },
    select: { userId: true },
  });
  await enqueueNotifications({
    userIds: members.map((m) => m.userId).filter((id) => id !== actorId),
    event: "PROFILE_UPDATED",
    payload: { code, field: PROFILE_FIELD_LABELS[fieldKey] },
    batchKey: `profile-updated:${profileId}`,
  });
}
