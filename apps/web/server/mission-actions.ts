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
  evaluateTeamEligibility,
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
import { canMoveMissionManually } from "@/server/mission-lifecycle";
import { isClaimableMissionStatus } from "./mission-claim-policy";
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
  /** Une acceptation renforcée exige une confirmation explicite et une note. */
  needsReviewConfirmation?: boolean;
  /** Le passage « en cours » exige d'abord l'attribution (modale côté client) */
  needsAssignment?: boolean;
  /** Retour « À prendre » d'une mission attribuée : choix conserver/retirer requis */
  needsReleaseChoice?: boolean;
}

class EligibilityRejectedError extends Error {
  constructor(readonly warnings: string[]) {
    super("ELIGIBILITY_REJECTED");
  }
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

  // Passage « en cours » : la validation de l'équipe finale, du minimum total
  // et du contrôle renforcé appartient exclusivement à assignMissionAction.
  // Cette barrière serveur interdit aussi un appel direct contournant la modale.
  if (toStatus === "IN_PROGRESS") {
    return {
      ok: false,
      needsAssignment: true,
      error:
        mission.assignments.length === 0
          ? "Attribuez d'abord la mission à un ou plusieurs groupes."
          : "Confirmez l'équipe finale avant de démarrer la mission.",
    };
  }

  if (!canMoveMissionManually(mission.status, toStatus)) {
    return {
      ok: false,
      error: `Transition impossible : ${mission.status} ne peut pas passer directement à ${toStatus}.`,
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
  let committedMission = mission;
  let committedCompletionRyo = completionRyo;

  try {
    await prisma.$transaction(async (tx) => {
    // Relecture autoritative de l'équipe, des récompenses et du statut. Une
    // attribution ou une modification concurrente ne peut pas produire des
    // crédits calculés sur un ancien roster.
    const liveMission = await tx.mission.findUnique({
      where: { id: missionId },
      include: {
        assignments: {
          where: { active: true },
          select: { id: true, groupId: true, factionId: true },
        },
        participants: { select: { userId: true, groupId: true } },
      },
    });
    if (!liveMission || liveMission.status !== fromStatus) {
      throw new Error("CONCURRENT_MOVE");
    }
    committedMission = liveMission;
    if (toStatus === "COMPLETED") {
      committedCompletionRyo = awardedRyo ?? liveMission.rewardRyoMin;
      if (
        committedCompletionRyo < liveMission.rewardRyoMin ||
        committedCompletionRyo > liveMission.rewardRyoMax
      ) {
        throw new Error("REWARD_CHANGED");
      }
      if (liveMission.participants.length === 0) {
        throw new Error("NO_PARTICIPANTS");
      }
      const liveAssignedGroupIds = new Set(
        liveMission.assignments.map((assignment) => assignment.groupId),
      );
      if (
        liveMission.participants.some(
          (participant) =>
            !participant.groupId || !liveAssignedGroupIds.has(participant.groupId),
        )
      ) {
        throw new Error("PARTICIPANT_WITHOUT_ASSIGNMENT");
      }
    }

    const updated = await tx.mission.updateMany({
      where: { id: missionId, status: fromStatus },
      data: {
        status: toStatus,
        resolvedAt: AUTO_RESOLVED.includes(toStatus) ? new Date() : null,
        failureReason:
          toStatus === "FAILED" ? reason ?? liveMission.failureReason : liveMission.failureReason,
        cancellationReason:
          toStatus === "CANCELLED"
            ? reason ?? liveMission.cancellationReason
            : liveMission.cancellationReason,
        ...(committedCompletionRyo !== null ? { awardedRyo: committedCompletionRyo } : {}),
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

      if (toStatus === "COMPLETED" && committedCompletionRyo !== null) {
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
          liveMission.rank as Rank,
          "COMPLETED",
          {},
          liveMission.basePoints,
        );
        const participantWeights = liveMission.participants.map((participant) => ({
          key: participant.userId,
          weight: 1,
        }));
        const playerPointShares = shareInteger(total, participantWeights);
        const playerRyoShares = shareInteger(committedCompletionRyo, participantWeights);
        for (const participant of liveMission.participants) {
          await tx.missionParticipant.update({
            where: { missionId_userId: { missionId, userId: participant.userId } },
            data: {
              pointsAwarded: playerPointShares.get(participant.userId) ?? 0,
              ryoAwarded: playerRyoShares.get(participant.userId) ?? 0,
            },
          });
        }

        const groupWeights = liveMission.assignments.map((assignment) => ({
          key: assignment.groupId,
          weight: liveMission.participants.filter(
            (participant) => participant.groupId === assignment.groupId,
          ).length,
        }));
        if (groupWeights.some((group) => group.weight === 0)) {
          throw new Error("ASSIGNMENT_WITHOUT_PARTICIPANT");
        }
        for (const line of breakdown) {
          const groupShares = shareInteger(line.points, groupWeights);
          for (const assignment of liveMission.assignments) {
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
          missionCode: liveMission.code,
          // Les groupes qui ont réellement engagé des agents, pas les simples
          // attributions : c'est la participation qui ouvre l'accès.
          groupIds: [
            ...new Set(
              liveMission.participants
                .map((participant) => participant.groupId)
                .filter((groupId): groupId is string => Boolean(groupId)),
            ),
          ],
          actorId: current.session.userId,
          clientProfileId: liveMission.clientProfileId,
          // Élimination accomplie ⇒ cibles au sort inconnu présumées mortes
          missionCategory: liveMission.category,
          missionSucceeded: toStatus === "COMPLETED",
        });
      }
    }, { isolationLevel: "Serializable" });
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
    if (error instanceof Error && error.message === "REWARD_CHANGED") {
      return {
        ok: false,
        error: "La fourchette de récompense vient de changer ; rechargez puis confirmez le montant.",
      };
    }
    if (
      error instanceof Error &&
      ["NO_PARTICIPANTS", "PARTICIPANT_WITHOUT_ASSIGNMENT"].includes(error.message)
    ) {
      return {
        ok: false,
        error: "L'équipe engagée vient de changer ou n'est plus complète ; rechargez la mission.",
      };
    }
    if ((error as { code?: string }).code === "P2034") {
      return {
        ok: false,
        error: "L'équipe ou la mission vient d'être modifiée ; rechargez puis réessayez.",
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
      ...(committedCompletionRyo !== null
        ? { awardedRyo: committedCompletionRyo, participantCount: committedMission.participants.length }
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
  const targets = new Set(committedMission.participants.map((participant) => participant.userId));
  if (targets.size === 0) {
    for (const assignment of committedMission.assignments) {
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
      payload: { ...publicPayload(committedMission), fromStatus, toStatus },
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
      user: { status: "ACTIVE", profileCompleted: true },
    },
    select: { userId: true },
  });
  if (selectedMembers.length !== participantIds.length) {
    return {
      ok: false,
      error:
        "Un agent sélectionné n'appartient plus à ce groupe, n'est plus actif ou n'a pas terminé son profil.",
    };
  }

  const proposedHeadcount = participantIds.length;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { minRecommendedLevel: true },
  });
  if (!mission || !isClaimableMissionStatus(mission.status)) {
    return { ok: false, error: "Cette mission n'est plus disponible." };
  }

  const existing = await prisma.missionClaim.findUnique({
    where: { missionId_groupId: { missionId, groupId } },
  });
  if (existing?.status === "ACCEPTED") {
    return { ok: false, error: "Cette revendication a déjà été acceptée." };
  }
  // PENDING / INFO_REQUESTED : la revendication reste modifiable (effectif,
  // message) tant qu'elle n'a pas été traitée — on la met à jour en place.

  const meta = await requestMeta();
  let warnings: string[] = [];
  let responseWarnings: string[] = [];
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

        const liveMembers = await tx.groupMember.findMany({
          where: {
            groupId,
            userId: { in: participantIds },
            user: { status: "ACTIVE", profileCompleted: true },
          },
          select: {
            userId: true,
            user: { select: { playerLevel: { select: { order: true } } } },
          },
        });
        if (liveMembers.length !== participantIds.length) throw new Error("MEMBERS_CHANGED");

        const liveMission = await tx.mission.findUnique({
          where: { id: missionId },
          select: {
            status: true,
            groupSizeMin: true,
            groupSizeMax: true,
            eligibilityMode: true,
            minRecommendedLevel: { select: { order: true, label: true } },
          },
        });
        if (!liveMission || !isClaimableMissionStatus(liveMission.status)) {
          throw new Error("MISSION_CHANGED");
        }

        // Évaluation autoritative dans la même transaction que l'écriture :
        // critères et niveaux ne peuvent plus changer entre contrôle et dépôt.
        const issues = evaluateTeamEligibility({
          participantLevels: liveMembers.map((member) => member.user.playerLevel?.order),
          groupSizeMin: liveMission.groupSizeMin,
          groupSizeMax: liveMission.groupSizeMax,
          minLevel: liveMission.minRecommendedLevel,
        });
        const eligibility = applyEligibilityMode(liveMission.eligibilityMode, issues);
        warnings = eligibility.claimWarnings;
        responseWarnings = eligibility.responseWarnings;
        if (!eligibility.allowed) {
          throw new EligibilityRejectedError(eligibility.responseWarnings);
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
    if (error instanceof EligibilityRejectedError) {
      return {
        ok: false,
        error: "Critères d'éligibilité non remplis.",
        warnings: error.warnings,
      };
    }
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
  return { ok: true, warnings: responseWarnings };
}

// ─────────────────────────────────────────────────────────────
// Décision sur une revendication (modérateurs)
// ─────────────────────────────────────────────────────────────

export async function decideClaimAction(input: {
  claimId: string;
  decision: "ACCEPTED" | "REJECTED" | "INFO_REQUESTED";
  note?: string;
  reviewConfirmed?: boolean;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.CLAIM_REVIEW)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = claimDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { claimId, decision, note, reviewConfirmed } = parsed.data;

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
    let enhancedReviewPerformed = false;
    try {
      await prisma.$transaction(
        async (tx) => {
          const liveClaim = await tx.missionClaim.findUnique({
            where: { id: claimId },
            include: {
              participants: {
                select: {
                  userId: true,
                  user: { select: { playerLevel: { select: { order: true } } } },
                },
              },
              mission: {
                select: {
                  status: true,
                  assignedFactionId: true,
                  assignedGroupId: true,
                  assignedAt: true,
                  groupSizeMin: true,
                  groupSizeMax: true,
                  eligibilityMode: true,
                  requiresEnhancedReview: true,
                  minRecommendedLevel: { select: { order: true, label: true } },
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

          const enhancedReviewRequired =
            liveClaim.mission.requiresEnhancedReview ||
            liveClaim.mission.eligibilityMode === "MANUAL_REVIEW";
          if (enhancedReviewRequired && (!reviewConfirmed || !note?.trim())) {
            throw new Error("ENHANCED_REVIEW_REQUIRED");
          }
          enhancedReviewPerformed = enhancedReviewRequired;

          const liveParticipantIds = liveClaim.participants.map((participant) => participant.userId);
          if (liveParticipantIds.length === 0) throw new Error("NO_PARTICIPANTS");
          const activeMemberCount = await tx.groupMember.count({
            where: {
              groupId: liveClaim.groupId,
              userId: { in: liveParticipantIds },
              user: { status: "ACTIVE", profileCompleted: true },
            },
          });
          if (activeMemberCount !== liveParticipantIds.length) throw new Error("MEMBERS_CHANGED");

          // Une revendication peut être restée ouverte pendant qu'un niveau ou
          // les critères de mission changeaient. L'acceptation repart toujours
          // des valeurs vivantes, dans la transaction d'attribution.
          const issues = evaluateTeamEligibility({
            participantLevels: liveClaim.participants.map(
              (participant) => participant.user.playerLevel?.order,
            ),
            groupSizeMin: liveClaim.mission.groupSizeMin,
            groupSizeMax: liveClaim.mission.groupSizeMax,
            minLevel: liveClaim.mission.minRecommendedLevel,
          });
          const eligibility = applyEligibilityMode(liveClaim.mission.eligibilityMode, issues);
          if (!eligibility.allowed) {
            throw new EligibilityRejectedError(eligibility.responseWarnings);
          }

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
              warnings: eligibility.claimWarnings,
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
      if (error instanceof EligibilityRejectedError) {
        return {
          ok: false,
          error:
            "Les critères ou les niveaux ont changé : cette équipe ne peut plus être acceptée en blocage strict.",
          warnings: error.warnings,
        };
      }
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
        if (error.message === "ENHANCED_REVIEW_REQUIRED") {
          return {
            ok: false,
            error:
              "Le contrôle renforcé doit être confirmé et accompagné d'une note avant l'attribution.",
            needsReviewConfirmation: true,
          };
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
        enhancedReviewPerformed,
        reviewConfirmed: enhancedReviewPerformed && reviewConfirmed,
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
  // Le rapport FINAL passe exclusivement par le parcours en trois étapes
  // (finalizeMissionReportAction : sorts, renseignements, tout ou rien). Ici,
  // seulement un point d'étape — quoi qu'envoie le client.
  const isFinal = false;
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

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      assignments: { where: { active: true }, select: { groupId: true } },
    },
  });
  if (!mission) return { ok: false, error: "Mission introuvable." };

  const ctx = await getAccessContext(current);
  // Les affectations normalisées sont la source de vérité. L'ancien champ ne
  // sert qu'aux missions qui n'ont encore aucune affectation active : le mêler
  // aux données modernes rouvrirait l'accès à un ancien groupe désaffecté.
  const assignedGroupIds =
    mission.assignments.length > 0
      ? mission.assignments.map((assignment) => assignment.groupId)
      : mission.assignedGroupId
        ? [mission.assignedGroupId]
        : [];
  const authorized =
    ctx.isModerator ||
    assignedGroupIds.some((groupId) => ctx.groupIds.has(groupId));
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
