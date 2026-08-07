"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { MissionStatus } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  missionClaimSchema,
  claimDecisionSchema,
  missionMoveSchema,
  computeMissionScore,
  applyEligibilityMode,
  shareInteger,
  REPORT_IMAGES_MAX,
  REPORT_IMAGE_MAX_BYTES,
  type Rank,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  groupMemberIds,
  userIdsWithPermission,
} from "@/server/notifications";
import { getAccessContext } from "@/server/missions";
import {
  applyMissionOutcomeToProfiles,
  type TargetIntelResult,
} from "@/server/missions/target-intel";
import { checkTargetIntel } from "@/server/missions/target-requirements";
import { sniffImageMime, isFileLike } from "@/server/image-validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
  /** Le passage « en cours » exige d'abord l'attribution (modale côté client) */
  needsAssignment?: boolean;
  /** Retour « À prendre » d'une mission attribuée : choix conserver/retirer requis */
  needsReleaseChoice?: boolean;
}

/** Payload de notification : UNIQUEMENT des champs publics. */
function publicPayload(mission: {
  code: string;
  rank: string;
  category: string;
  publicTitle: string;
}) {
  return {
    code: mission.code,
    rank: mission.rank,
    category: mission.category,
    title: mission.publicTitle,
  };
}

// ─────────────────────────────────────────────────────────────
// Déplacement Kanban (modérateurs)
// ─────────────────────────────────────────────────────────────

const AUTO_RESOLVED: MissionStatus[] = ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"];

export async function moveMissionAction(input: {
  missionId: string;
  toStatus: string;
  reason?: string;
  releaseAssignments?: boolean;
  awardedRyo?: number;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_MOVE)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = missionMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { missionId, toStatus, reason, releaseAssignments, awardedRyo } = parsed.data;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      assignments: { where: { active: true }, select: { id: true, groupId: true, factionId: true } },
      participants: { select: { userId: true, groupId: true } },
    },
  });
  // Renseigné par la résolution, puis rapporté à l'appelant : le modérateur
  // doit savoir ce que sa décision a changé dans les dossiers.
  // Volontairement non initialisée : l'affectation a lieu dans la transaction,
  // et TypeScript réduirait sinon le type à `null` faute de suivre la closure.
  let intelResult: TargetIntelResult | undefined;
  if (!mission) return { ok: false, error: "Mission introuvable." };
  if (mission.status === toStatus) return { ok: true };
  if (mission.status === "COMPLETED") {
    return {
      ok: false,
      error: "Une mission accomplie et récompensée ne peut pas être rouverte.",
    };
  }

  // Passage « en cours » : IMPOSSIBLE sans équipe — la modale d'attribution
  // (assignMissionAction) est le seul chemin.
  if (toStatus === "IN_PROGRESS" && mission.assignments.length === 0) {
    return {
      ok: false,
      needsAssignment: true,
      error: "Attribuez d'abord la mission à un ou plusieurs groupes.",
    };
  }

  // Retour « À prendre » d'une mission qui possède des groupes assignés :
  // le modérateur doit choisir conserver / retirer (jamais implicite).
  const releasing =
    toStatus === "AVAILABLE" && mission.assignments.length > 0;
  if (releasing && releaseAssignments === undefined) {
    return {
      ok: false,
      needsReleaseChoice: true,
      error: "La mission possède des groupes assignés : conserver ou retirer les attributions ?",
    };
  }

  const completionRyo = toStatus === "COMPLETED" ? awardedRyo ?? mission.rewardRyoMin : null;
  if (
    completionRyo !== null &&
    (completionRyo < mission.rewardRyoMin || completionRyo > mission.rewardRyoMax)
  ) {
    return {
      ok: false,
      error: `La somme distribuée doit être comprise entre ${mission.rewardRyoMin} et ${mission.rewardRyoMax} ryō.`,
    };
  }
  // Renseignement des cibles : la modération règle le niveau d'exigence.
  // Sans cela, la prime est touchée et le dossier reste vide — or c'est
  // précisément ce renseignement que la Toile revend.
  let intelIssues: string[] = [];
  if (toStatus === "COMPLETED" || toStatus === "FAILED") {
    const check = await checkTargetIntel(missionId);
    intelIssues = check.issues;
    if (check.blocking) {
      return {
        ok: false,
        error:
          "Le renseignement des cibles est incomplet : " +
          check.issues.join(" ") +
          " Complétez les dossiers, ou assouplissez la règle dans la configuration.",
      };
    }
  }

  if (toStatus === "COMPLETED") {
    if (mission.participants.length === 0) {
      return { ok: false, error: "Ajoutez les agents engagés avant d'accomplir la mission." };
    }
    const assignedGroupIds = new Set(mission.assignments.map((assignment) => assignment.groupId));
    if (
      mission.participants.some(
        (participant) => !participant.groupId || !assignedGroupIds.has(participant.groupId),
      )
    ) {
      return {
        ok: false,
        error: "Chaque agent doit être rattaché à un groupe actif de la mission.",
      };
    }
  }

  const meta = await requestMeta();
  const fromStatus = mission.status;

  try {
    await prisma.$transaction(async (tx) => {
    // Protection contre les mises à jour concurrentes : le statut doit être
    // inchangé au moment de l'écriture.
    const updated = await tx.mission.updateMany({
      where: { id: missionId, status: fromStatus },
      data: {
        status: toStatus,
        resolvedAt: AUTO_RESOLVED.includes(toStatus) ? new Date() : null,
        failureReason: toStatus === "FAILED" ? reason ?? mission.failureReason : mission.failureReason,
        cancellationReason:
          toStatus === "CANCELLED" ? reason ?? mission.cancellationReason : mission.cancellationReason,
        ...(completionRyo !== null ? { awardedRyo: completionRyo } : {}),
        ...(releasing && releaseAssignments
          ? { assignedFactionId: null, assignedGroupId: null, assignedAt: null }
          : {}),
      },
    });
    if (updated.count === 0) throw new Error("CONCURRENT_MOVE");

    if (releasing && releaseAssignments) {
      await tx.missionAssignment.updateMany({
        where: { missionId, active: true },
        data: {
          active: false,
          releasedAt: new Date(),
          releasedReason: reason ?? "Mission rouverte par la modération",
        },
      });
      // Retirer l'attribution retire aussi immédiatement l'accès confidentiel
      // accordé aux agents nommément engagés.
      await tx.missionParticipant.deleteMany({ where: { missionId } });
    }

      await tx.missionStatusHistory.create({
        data: {
          missionId,
          fromStatus,
          toStatus,
          changedById: current.session.userId,
          reason:
            releasing
              ? `${reason ?? ""}${reason ? " — " : ""}attributions ${releaseAssignments ? "retirées" : "conservées"}`.trim()
              : reason ?? null,
        },
      });

      if (toStatus === "COMPLETED" && completionRyo !== null) {
        const alreadyScored = await tx.missionScore.findFirst({
          where: { missionId, reason: "MISSION_COMPLETED" },
          select: { id: true },
        });
        if (alreadyScored) throw new Error("ALREADY_REWARDED");

        const season = await tx.leaderboardSeason.findFirst({
          where: { isActive: true },
          select: { id: true },
        });
        const { total, breakdown } = computeMissionScore(
          mission.rank as Rank,
          "COMPLETED",
          {},
          mission.basePoints,
        );
        const participantWeights = mission.participants.map((participant) => ({
          key: participant.userId,
          weight: 1,
        }));
        const playerPointShares = shareInteger(total, participantWeights);
        const playerRyoShares = shareInteger(completionRyo, participantWeights);
        for (const participant of mission.participants) {
          await tx.missionParticipant.update({
            where: { missionId_userId: { missionId, userId: participant.userId } },
            data: {
              pointsAwarded: playerPointShares.get(participant.userId) ?? 0,
              ryoAwarded: playerRyoShares.get(participant.userId) ?? 0,
            },
          });
        }

        const groupWeights = mission.assignments.map((assignment) => ({
          key: assignment.groupId,
          weight: mission.participants.filter(
            (participant) => participant.groupId === assignment.groupId,
          ).length,
        }));
        if (groupWeights.some((group) => group.weight === 0)) {
          throw new Error("ASSIGNMENT_WITHOUT_PARTICIPANT");
        }
        for (const line of breakdown) {
          const groupShares = shareInteger(line.points, groupWeights);
          for (const assignment of mission.assignments) {
            const points = groupShares.get(assignment.groupId) ?? 0;
            if (points === 0) continue;
            await tx.missionScore.create({
              data: {
                missionId,
                seasonId: season?.id ?? null,
                factionId: assignment.factionId,
                groupId: assignment.groupId,
                points,
                reason: line.reason as never,
                justification:
                  "Part proportionnelle aux agents engagés lors de l'accomplissement.",
                createdById: current.session.userId,
              },
            });
          }
        }
      }

      // Répercussions sur les dossiers : état vital des cibles, accès des
      // groupes engagés, trace chez le commanditaire. Dans la MÊME transaction
      // que la résolution — une mission dont les effets échouent ne doit pas
      // rester close à moitié.
      if (toStatus === "COMPLETED" || toStatus === "FAILED") {
        intelResult = await applyMissionOutcomeToProfiles(tx, {
          missionId,
          missionCode: mission.code,
          // Les groupes qui ont réellement engagé des agents, pas les simples
          // attributions : c'est la participation qui ouvre l'accès.
          groupIds: [
            ...new Set(
              mission.participants
                .map((participant) => participant.groupId)
                .filter((groupId): groupId is string => Boolean(groupId)),
            ),
          ],
          actorId: current.session.userId,
          clientProfileId: mission.clientProfileId,
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_MOVE") {
      return {
        ok: false,
        error: "La mission vient d'être modifiée par quelqu'un d'autre — rechargez le tableau.",
      };
    }
    if (error instanceof Error && error.message === "ASSIGNMENT_WITHOUT_PARTICIPANT") {
      return {
        ok: false,
        error: "Chaque groupe attribué doit compter au moins un agent engagé.",
      };
    }
    if (error instanceof Error && error.message === "ALREADY_REWARDED") {
      return {
        ok: false,
        error: "Cette mission a déjà été récompensée ; aucun second crédit n'est possible.",
      };
    }
    throw error;
  }

  await audit({
    actorId: current.session.userId,
    action: "mission.status_changed",
    resourceType: "mission",
    resourceId: missionId,
    oldValues: { status: fromStatus },
    newValues: {
      status: toStatus,
      ...(releasing ? { releaseAssignments } : {}),
      ...(completionRyo !== null
        ? { awardedRyo: completionRyo, participantCount: mission.participants.length }
        : {}),
      // Ce que la résolution a changé dans les dossiers : une modification
      // automatique doit rester traçable au même titre qu'une saisie.
      ...(intelResult
        ? {
            dossiersMisAJour: intelResult.lifeStatusUpdated,
            accesOuverts: intelResult.grantsCreated,
          }
        : {}),
    },
    reason,
    ...meta,
  });

  // Notifications : les agents effectivement engagés ; repli historique sur
  // tous les membres du groupe si l'ancienne mission n'avait pas de sélection.
  const targets = new Set(mission.participants.map((participant) => participant.userId));
  if (targets.size === 0) {
    for (const assignment of mission.assignments) {
      for (const id of await groupMemberIds(assignment.groupId)) targets.add(id);
    }
  }
  targets.delete(current.session.userId);
  if (targets.size > 0) {
    await enqueueNotifications({
      userIds: [...targets],
      event:
        toStatus === "CANCELLED"
          ? "MISSION_CANCELLED"
          : toStatus === "EXPIRED"
            ? "MISSION_EXPIRED"
            : "MISSION_STATUS_CHANGED",
      payload: { ...publicPayload(mission), fromStatus, toStatus },
      missionId,
      batchKey: `status:${missionId}`,
    });
  }

  revalidatePath("/missions");
  // Les dossiers touchés changent aussi de contenu pour leurs lecteurs
  if (intelResult) revalidatePath("/profils");

  // Ce que la clôture a produit dans les dossiers, dit au modérateur : une
  // mise à jour automatique qu'on ne voit pas est une mise à jour qu'on ne
  // vérifie jamais.
  const warnings = [...intelIssues];
  if (intelResult) {
    if (intelResult.lifeStatusUpdated.length > 0) {
      warnings.push(
        `État vital mis à jour : ${intelResult.lifeStatusUpdated.join(", ")}.`,
      );
    }
    if (intelResult.grantsCreated > 0) {
      warnings.push(
        `${intelResult.grantsCreated} accès au dossier de la cible ouvert${
          intelResult.grantsCreated > 1 ? "s" : ""
        } aux groupes engagés.`,
      );
    }
  }
  return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
}

// ─────────────────────────────────────────────────────────────
// Revendication (chefs de groupe)
// ─────────────────────────────────────────────────────────────

export async function claimMissionAction(input: {
  missionId: string;
  groupId: string;
  participantIds: string[];
  publicRoster: boolean;
  message?: string;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_CLAIM)) {
    return { ok: false, error: "Seuls les chefs de groupe peuvent réclamer une mission." };
  }
  const parsed = missionClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { missionId, groupId, message, participantIds, publicRoster } = parsed.data;

  const ctx = await getAccessContext(current);
  const ledGroup = ctx.ledGroups.find((g) => g.id === groupId);
  if (!ledGroup) return { ok: false, error: "Vous ne dirigez pas ce groupe." };

  const selectedMembers = await prisma.groupMember.findMany({
    where: {
      groupId,
      userId: { in: participantIds },
      user: { status: "ACTIVE" },
    },
    include: { user: { include: { playerLevel: true } } },
  });
  if (selectedMembers.length !== participantIds.length) {
    return {
      ok: false,
      error: "Un agent sélectionné n'appartient plus à ce groupe ou n'est plus actif.",
    };
  }

  const proposedHeadcount = participantIds.length;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { minRecommendedLevel: true },
  });
  if (!mission || !["AVAILABLE", "CLAIM_PENDING"].includes(mission.status)) {
    return { ok: false, error: "Cette mission n'est plus disponible." };
  }

  // Les critères portent sur l'effectif réellement proposé pour la mission,
  // pas sur tous les membres que le groupe pourrait mobiliser.
  const criteriaWarnings: string[] = [];
  if (proposedHeadcount < mission.groupSizeMin) {
    criteriaWarnings.push(
      `L'effectif proposé est de ${proposedHeadcount} membre(s) ; minimum demandé : ${mission.groupSizeMin}.`,
    );
  }
  if (proposedHeadcount > mission.groupSizeMax) {
    criteriaWarnings.push(
      `L'effectif proposé est de ${proposedHeadcount} membre(s) ; maximum demandé : ${mission.groupSizeMax}.`,
    );
  }
  if (mission.minRecommendedLevelId) {
    const minLevel = await prisma.playerLevel.findUnique({
      where: { id: mission.minRecommendedLevelId },
    });
    if (minLevel) {
      const below = selectedMembers.filter(
        (m) => (m.user.playerLevel?.order ?? 0) < minLevel.order,
      ).length;
      if (below > 0) {
        criteriaWarnings.push(
          `${below} membre(s) du groupe se trouvent sous le niveau recommandé (${minLevel.label}).`,
        );
      }
    }
  }
  const eligibility = applyEligibilityMode(mission.eligibilityMode, criteriaWarnings);
  if (!eligibility.allowed) {
    return {
      ok: false,
      error: "Critères d'éligibilité non remplis.",
      warnings: eligibility.responseWarnings,
    };
  }
  const warnings = eligibility.claimWarnings;

  const existing = await prisma.missionClaim.findUnique({
    where: { missionId_groupId: { missionId, groupId } },
  });
  if (existing?.status === "ACCEPTED") {
    return { ok: false, error: "Cette revendication a déjà été acceptée." };
  }
  // PENDING / INFO_REQUESTED : la revendication reste modifiable (effectif,
  // message) tant qu'elle n'a pas été traitée — on la met à jour en place.

  const meta = await requestMeta();
  try {
    await prisma.$transaction(
      async (tx) => {
        // Revalidation dans la transaction : les droits du chef, l'activité du
        // groupe, ses membres et le statut ont pu changer depuis l'affichage.
        const liveLeader = await tx.groupMember.findFirst({
          where: {
            groupId,
            userId: current.session.userId,
            isLeader: true,
            group: { isActive: true },
          },
          select: { userId: true },
        });
        if (!liveLeader) throw new Error("NOT_GROUP_LEADER");

        const liveMemberCount = await tx.groupMember.count({
          where: {
            groupId,
            userId: { in: participantIds },
            user: { status: "ACTIVE" },
          },
        });
        if (liveMemberCount !== participantIds.length) throw new Error("MEMBERS_CHANGED");

        const liveMission = await tx.mission.findUnique({
          where: { id: missionId },
          select: { status: true },
        });
        if (!liveMission || !["AVAILABLE", "CLAIM_PENDING"].includes(liveMission.status)) {
          throw new Error("MISSION_CHANGED");
        }

        const liveExisting = await tx.missionClaim.findUnique({
          where: { missionId_groupId: { missionId, groupId } },
        });
        if (liveExisting?.status === "ACCEPTED") throw new Error("CLAIM_ACCEPTED");

        let savedClaimId: string;
        if (liveExisting) {
          const saved = await tx.missionClaim.update({
            where: { id: liveExisting.id },
            data: {
              status: "PENDING",
              message: message ?? null,
              proposedHeadcount,
              publicRoster,
              leaderId: current.session.userId,
              warnings,
              resolvedAt: null,
              moderatorId: null,
              moderatorNote: null,
              createdAt: new Date(),
            },
          });
          savedClaimId = saved.id;
          await tx.missionClaimParticipant.deleteMany({ where: { claimId: savedClaimId } });
        } else {
          const saved = await tx.missionClaim.create({
            data: {
              missionId,
              groupId,
              leaderId: current.session.userId,
              message: message ?? null,
              proposedHeadcount,
              publicRoster,
              warnings,
            },
          });
          savedClaimId = saved.id;
        }
        await tx.missionClaimParticipant.createMany({
          data: participantIds.map((userId) => ({ claimId: savedClaimId, userId })),
        });
        if (liveMission.status === "AVAILABLE") {
          const moved = await tx.mission.updateMany({
            where: { id: missionId, status: "AVAILABLE" },
            data: { status: "CLAIM_PENDING" },
          });
          if (moved.count === 0) throw new Error("MISSION_CHANGED");
          await tx.missionStatusHistory.create({
            data: {
              missionId,
              fromStatus: "AVAILABLE",
              toStatus: "CLAIM_PENDING",
              changedById: current.session.userId,
              reason: "Revendication soumise",
            },
          });
        }
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NOT_GROUP_LEADER") {
        return { ok: false, error: "Vous ne dirigez plus ce groupe ou il est inactif." };
      }
      if (error.message === "MEMBERS_CHANGED") {
        return {
          ok: false,
          error: "L'équipe du groupe a changé ; sélectionnez de nouveau les agents.",
        };
      }
      if (error.message === "MISSION_CHANGED") {
        return { ok: false, error: "Cette mission n'est plus disponible." };
      }
      if (error.message === "CLAIM_ACCEPTED") {
        return { ok: false, error: "Cette revendication a déjà été acceptée." };
      }
    }
    if ((error as { code?: string }).code === "P2034") {
      return {
        ok: false,
        error: "Une modification simultanée a eu lieu ; rechargez puis réessayez.",
      };
    }
    throw error;
  }

  await audit({
    actorId: current.session.userId,
    action: "mission.claimed",
    resourceType: "mission",
    resourceId: missionId,
    newValues: { groupId, participantCount: participantIds.length, publicRoster },
    ...meta,
  });

  const moderators = await userIdsWithPermission(PERMISSIONS.CLAIM_REVIEW);
  await enqueueNotifications({
    userIds: moderators,
    event: "NEW_CLAIM",
    payload: { ...publicPayload(mission), groupName: ledGroup.name, warnings: warnings.length },
    missionId,
    batchKey: `claims:${missionId}`,
  });

  revalidatePath("/missions");
  revalidatePath(`/missions/${missionId}`);
  return { ok: true, warnings: eligibility.responseWarnings };
}

// ─────────────────────────────────────────────────────────────
// Décision sur une revendication (modérateurs)
// ─────────────────────────────────────────────────────────────

export async function decideClaimAction(input: {
  claimId: string;
  decision: "ACCEPTED" | "REJECTED" | "INFO_REQUESTED";
  note?: string;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.CLAIM_REVIEW)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = claimDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { claimId, decision, note } = parsed.data;

  const claim = await prisma.missionClaim.findUnique({
    where: { id: claimId },
    include: {
      mission: true,
      group: { include: { faction: true } },
      participants: { select: { userId: true } },
    },
  });
  if (!claim || !["PENDING", "INFO_REQUESTED"].includes(claim.status)) {
    return { ok: false, error: "Revendication introuvable ou déjà traitée." };
  }
  const meta = await requestMeta();
  const mission = claim.mission;

  if (decision === "ACCEPTED") {
    // Accepter une revendication AJOUTE le groupe à l'équipe de la mission.
    // Les autres revendications restent en attente : plusieurs groupes
    // peuvent être acceptés et faire équipe.
    if (!["AVAILABLE", "CLAIM_PENDING", "ASSIGNED"].includes(mission.status)) {
      return { ok: false, error: "La mission n'est plus attribuable." };
    }
    if (claim.participants.length === 0) {
      return {
        ok: false,
        error: "Cette ancienne revendication ne contient aucun agent. Demandez au chef de la mettre à jour.",
      };
    }
    let acceptedParticipantIds = claim.participants.map((participant) => participant.userId);
    let acceptedPublicRoster = claim.publicRoster;
    try {
      await prisma.$transaction(
        async (tx) => {
          const liveClaim = await tx.missionClaim.findUnique({
            where: { id: claimId },
            include: {
              participants: { select: { userId: true } },
              mission: {
                select: {
                  status: true,
                  assignedFactionId: true,
                  assignedGroupId: true,
                  assignedAt: true,
                },
              },
              group: { select: { factionId: true, isActive: true } },
            },
          });
          if (!liveClaim || !["PENDING", "INFO_REQUESTED"].includes(liveClaim.status)) {
            throw new Error("CLAIM_CHANGED");
          }
          if (!liveClaim.group.isActive) throw new Error("GROUP_INACTIVE");
          if (!["AVAILABLE", "CLAIM_PENDING", "ASSIGNED"].includes(liveClaim.mission.status)) {
            throw new Error("MISSION_CHANGED");
          }

          const liveParticipantIds = liveClaim.participants.map((participant) => participant.userId);
          if (liveParticipantIds.length === 0) throw new Error("NO_PARTICIPANTS");
          const activeMemberCount = await tx.groupMember.count({
            where: {
              groupId: liveClaim.groupId,
              userId: { in: liveParticipantIds },
              user: { status: "ACTIVE" },
            },
          });
          if (activeMemberCount !== liveParticipantIds.length) throw new Error("MEMBERS_CHANGED");

          // Un utilisateur peut appartenir à plusieurs groupes, mais il ne peut
          // représenter qu'un seul groupe sur une mission donnée.
          const conflictingParticipant = await tx.missionParticipant.findFirst({
            where: {
              missionId: liveClaim.missionId,
              userId: { in: liveParticipantIds },
              groupId: { not: liveClaim.groupId },
            },
            select: { userId: true },
          });
          if (conflictingParticipant) throw new Error("PARTICIPANT_ALREADY_ASSIGNED");
          acceptedParticipantIds = liveParticipantIds;
          acceptedPublicRoster = liveClaim.publicRoster;

          const claimUpdated = await tx.missionClaim.updateMany({
            where: { id: claimId, status: { in: ["PENDING", "INFO_REQUESTED"] } },
            data: {
              status: "ACCEPTED",
              moderatorId: current.session.userId,
              moderatorNote: note ?? null,
              resolvedAt: new Date(),
            },
          });
          if (claimUpdated.count === 0) throw new Error("CLAIM_CHANGED");

          const activeCount = await tx.missionAssignment.count({
            where: { missionId: liveClaim.missionId, active: true },
          });
          const existingAssignment = await tx.missionAssignment.findFirst({
            where: {
              missionId: liveClaim.missionId,
              groupId: liveClaim.groupId,
              active: true,
            },
            select: { id: true },
          });
          if (existingAssignment) {
            await tx.missionAssignment.update({
              where: { id: existingAssignment.id },
              data: {
                assignedHeadcount: liveParticipantIds.length,
                publicRoster: liveClaim.publicRoster,
              },
            });
          } else {
            await tx.missionAssignment.create({
              data: {
                missionId: liveClaim.missionId,
                factionId: liveClaim.group.factionId,
                groupId: liveClaim.groupId,
                assignedById: current.session.userId,
                assignedHeadcount: liveParticipantIds.length,
                isLeadGroup: activeCount === 0,
                publicRoster: liveClaim.publicRoster,
              },
            });
          }
          await tx.missionParticipant.deleteMany({
            where: {
              missionId: liveClaim.missionId,
              groupId: liveClaim.groupId,
              userId: { notIn: liveParticipantIds },
            },
          });
          for (const userId of liveParticipantIds) {
            await tx.missionParticipant.upsert({
              where: {
                missionId_userId: { missionId: liveClaim.missionId, userId },
              },
              update: { groupId: liveClaim.groupId, addedById: current.session.userId },
              create: {
                missionId: liveClaim.missionId,
                userId,
                groupId: liveClaim.groupId,
                addedById: current.session.userId,
              },
            });
          }
          const missionUpdated = await tx.mission.updateMany({
            where: {
              id: liveClaim.missionId,
              status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED"] },
            },
            data: {
              status: "ASSIGNED",
              assignedFactionId:
                liveClaim.mission.assignedFactionId ?? liveClaim.group.factionId,
              assignedGroupId: liveClaim.mission.assignedGroupId ?? liveClaim.groupId,
              assignedAt: liveClaim.mission.assignedAt ?? new Date(),
            },
          });
          if (missionUpdated.count === 0) throw new Error("MISSION_CHANGED");
          if (liveClaim.mission.status !== "ASSIGNED") {
            await tx.missionStatusHistory.create({
              data: {
                missionId: liveClaim.missionId,
                fromStatus: liveClaim.mission.status,
                toStatus: "ASSIGNED",
                changedById: current.session.userId,
                reason: `Revendication du groupe ${liveClaim.groupId} acceptée`,
              },
            });
          }
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "CLAIM_CHANGED") {
          return { ok: false, error: "Cette revendication vient d'être modifiée ou traitée." };
        }
        if (error.message === "GROUP_INACTIVE") {
          return { ok: false, error: "Ce groupe n'est plus actif." };
        }
        if (error.message === "MISSION_CHANGED") {
          return { ok: false, error: "La mission n'est plus attribuable." };
        }
        if (error.message === "NO_PARTICIPANTS" || error.message === "MEMBERS_CHANGED") {
          return {
            ok: false,
            error: "La liste des agents n'est plus valide ; demandez au chef de la mettre à jour.",
          };
        }
        if (error.message === "PARTICIPANT_ALREADY_ASSIGNED") {
          return {
            ok: false,
            error: "Un agent sélectionné représente déjà un autre groupe sur cette mission.",
          };
        }
      }
      if ((error as { code?: string }).code === "P2034") {
        return {
          ok: false,
          error: "Une attribution simultanée a eu lieu ; rechargez puis réessayez.",
        };
      }
      throw error;
    }

    await audit({
      actorId: current.session.userId,
      action: "mission.assigned",
      resourceType: "mission",
      resourceId: mission.id,
      newValues: {
        groupId: claim.groupId,
        factionId: claim.group.factionId,
        headcount: acceptedParticipantIds.length,
        participantCount: acceptedParticipantIds.length,
        publicRoster: acceptedPublicRoster,
      },
      reason: note,
      ...meta,
    });

    const members = new Set(acceptedParticipantIds);
    members.add(claim.leaderId);
    await enqueueNotifications({
      userIds: [...members],
      event: "CLAIM_ACCEPTED",
      payload: publicPayload(mission),
      missionId: mission.id,
    });
  } else {
    try {
      await prisma.$transaction(
        async (tx) => {
          const claimUpdated = await tx.missionClaim.updateMany({
            where: { id: claimId, status: { in: ["PENDING", "INFO_REQUESTED"] } },
            data: {
              status: decision,
              moderatorId: current.session.userId,
              moderatorNote: note ?? null,
              resolvedAt: decision === "REJECTED" ? new Date() : null,
            },
          });
          if (claimUpdated.count === 0) throw new Error("CLAIM_CHANGED");

          if (decision === "REJECTED") {
            const remaining = await tx.missionClaim.count({
              where: {
                missionId: mission.id,
                status: { in: ["PENDING", "INFO_REQUESTED"] },
              },
            });
            if (remaining === 0) {
              const reopened = await tx.mission.updateMany({
                where: { id: mission.id, status: "CLAIM_PENDING" },
                data: { status: "AVAILABLE" },
              });
              if (reopened.count > 0) {
                await tx.missionStatusHistory.create({
                  data: {
                    missionId: mission.id,
                    fromStatus: "CLAIM_PENDING",
                    toStatus: "AVAILABLE",
                    changedById: current.session.userId,
                    reason: "Toutes les revendications refusées",
                  },
                });
              }
            }
          }
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "CLAIM_CHANGED") {
        return { ok: false, error: "Cette revendication vient d'être modifiée ou traitée." };
      }
      if ((error as { code?: string }).code === "P2034") {
        return {
          ok: false,
          error: "Une décision simultanée a eu lieu ; rechargez puis réessayez.",
        };
      }
      throw error;
    }
    await audit({
      actorId: current.session.userId,
      action: `claim.${decision.toLowerCase()}`,
      resourceType: "claim",
      resourceId: claimId,
      reason: note,
      ...meta,
    });
    await enqueueNotifications({
      userIds: [claim.leaderId],
      event: decision === "REJECTED" ? "CLAIM_REJECTED" : "CLAIM_INFO_REQUESTED",
      payload: { ...publicPayload(mission), note: note ?? null },
      missionId: mission.id,
    });
  }

  revalidatePath("/missions");
  revalidatePath("/revendications");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Rapport de mission (groupe attribué)
// ─────────────────────────────────────────────────────────────

export async function submitReportAction(formData: FormData): Promise<ActionResult> {
  const current = await requireUser();
  const missionId = String(formData.get("missionId") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  const isFinal = formData.get("isFinal") === "true";
  if (!content || content.length < 10 || content.length > 20_000) {
    return { ok: false, error: "Le rapport doit contenir entre 10 et 20 000 caractères." };
  }

  const files = formData
    .getAll("images")
    .filter((f) => isFileLike(f) && f.size > 0) as File[];
  if (files.length > REPORT_IMAGES_MAX) {
    return { ok: false, error: `${REPORT_IMAGES_MAX} images maximum par rapport.` };
  }

  // Validation par signature binaire — le type déclaré ne suffit pas
  const images: { imageData: Buffer<ArrayBuffer>; imageMime: string; sizeBytes: number }[] = [];
  for (const file of files) {
    if (file.size > REPORT_IMAGE_MAX_BYTES) {
      return { ok: false, error: `Image « ${file.name} » trop lourde : 2 Mo maximum.` };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = sniffImageMime(bytes);
    if (!mime) {
      return {
        ok: false,
        error: `Image « ${file.name} » refusée : PNG, JPG/JPEG ou WEBP uniquement.`,
      };
    }
    images.push({ imageData: bytes, imageMime: mime, sizeBytes: bytes.length });
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) return { ok: false, error: "Mission introuvable." };

  const ctx = await getAccessContext(current);
  const authorized =
    ctx.isModerator ||
    (mission.assignedGroupId != null && ctx.groupIds.has(mission.assignedGroupId));
  if (!authorized) return { ok: false, error: "Vous n'êtes pas affecté à cette mission." };

  await prisma.missionReport.create({
    data: {
      missionId: mission.id,
      authorId: current.session.userId,
      content,
      isFinal,
      images: { create: images },
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.report_submitted",
    resourceType: "mission",
    resourceId: mission.id,
    newValues: { isFinal, imagesCount: images.length },
    ...meta,
  });

  if (isFinal) {
    const moderators = await userIdsWithPermission(PERMISSIONS.CLAIM_REVIEW);
    await enqueueNotifications({
      userIds: moderators,
      event: "FINAL_REPORT_SUBMITTED",
      payload: publicPayload(mission),
      missionId: mission.id,
    });
  }

  revalidatePath(`/missions/${mission.id}`);
  return { ok: true };
}

/**
 * Retire une mission de la Toile sans effacer son historique. La suppression
 * est donc un archivage audité : attributions actives libérées, candidatures
 * en attente retirées et accès non-modérateur immédiatement fermé.
 */
export async function archiveMissionAction(input: {
  missionId: string;
  reason?: string;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_CANCEL)) {
    return { ok: false, error: "Permission refusée." };
  }
  const reason = input.reason?.trim();
  if (reason && reason.length > 1000) {
    return { ok: false, error: "Le motif ne doit pas dépasser 1 000 caractères." };
  }

  const mission = await prisma.mission.findUnique({
    where: { id: input.missionId },
    include: {
      assignments: { where: { active: true }, select: { groupId: true } },
    },
  });
  if (!mission) return { ok: false, error: "Mission introuvable." };
  if (mission.status === "ARCHIVED") return { ok: true };

  const fromStatus = mission.status;
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.mission.updateMany({
        where: { id: mission.id, status: fromStatus },
        data: {
          status: "ARCHIVED",
          assignedFactionId: null,
          assignedGroupId: null,
          assignedAt: null,
        },
      });
      if (updated.count === 0) throw new Error("CONCURRENT_ARCHIVE");

      await tx.missionAssignment.updateMany({
        where: { missionId: mission.id, active: true },
        data: {
          active: false,
          releasedAt: new Date(),
          releasedReason: reason || "Mission supprimée de la Toile",
        },
      });
      await tx.missionClaim.updateMany({
        where: {
          missionId: mission.id,
          status: { in: ["PENDING", "INFO_REQUESTED"] },
        },
        data: { status: "WITHDRAWN", resolvedAt: new Date() },
      });
      await tx.missionStatusHistory.create({
        data: {
          missionId: mission.id,
          fromStatus,
          toStatus: "ARCHIVED",
          changedById: current.session.userId,
          reason: reason || "Mission supprimée de la Toile",
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_ARCHIVE") {
      return {
        ok: false,
        error: "La mission vient d'être modifiée — rechargez la page avant de la supprimer.",
      };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.archived",
    resourceType: "mission",
    resourceId: mission.id,
    oldValues: { status: fromStatus },
    newValues: { status: "ARCHIVED" },
    reason: reason || "Mission supprimée de la Toile",
    ...meta,
  });

  const recipients = new Set<string>();
  for (const assignment of mission.assignments) {
    for (const userId of await groupMemberIds(assignment.groupId)) recipients.add(userId);
  }
  recipients.delete(current.session.userId);
  await enqueueNotifications({
    userIds: [...recipients],
    event: "MISSION_CANCELLED",
    payload: publicPayload(mission),
    missionId: mission.id,
    batchKey: `archive:${mission.id}`,
  });

  revalidatePath("/missions");
  revalidatePath(`/missions/${mission.id}`);
  revalidatePath("/revendications");
  return { ok: true };
}
