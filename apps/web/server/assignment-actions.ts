"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { MissionStatus } from "@toile/database";
import { audit } from "@toile/auth";
import {
  applyEligibilityMode,
  evaluateTeamEligibility,
  PERMISSIONS,
  missionAssignSchema,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  userIdsWithPermission,
} from "@/server/notifications";
import { canReusePublicRosterConsent } from "@/server/mission-lifecycle";

export interface AssignResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
}

class AssignmentEligibilityError extends Error {
  constructor(readonly issues: string[]) {
    super("ELIGIBILITY");
  }
}

/**
 * Attribution (ou réattribution) d'une mission à un ou plusieurs groupes,
 * puis passage « en cours » si demandé. TRANSACTIONNEL :
 * permission → relecture du statut → vérification des groupes → attributions
 * → revendications acceptées → statut → historique → audit → notifications.
 * Un double clic ne crée pas deux attributions (index partiel + updateMany gardé).
 */
export async function assignMissionAction(raw: unknown): Promise<AssignResult> {
  const current = await requireUser();
  if (
    !current.permissions.has(PERMISSIONS.MISSION_ASSIGN) ||
    !current.permissions.has(PERMISSIONS.MISSION_MOVE)
  ) {
    return { ok: false, error: "Seule la modération peut attribuer une mission." };
  }

  const parsed = missionAssignSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Requête invalide." };
  }
  const { missionId, assignments, start, reason, reviewConfirmed } = parsed.data;
  const normalizedReason = reason?.trim() || undefined;

  // Vérification des groupes (existence, activité, effectif réel)
  const groups = await prisma.group.findMany({
    where: { id: { in: assignments.map((a) => a.groupId) }, isActive: true },
    include: {
      faction: true,
      members: {
        where: { user: { status: "ACTIVE", profileCompleted: true } },
        select: { userId: true },
      },
    },
  });
  if (groups.length !== assignments.length) {
    return { ok: false, error: "Un des groupes sélectionnés est introuvable ou inactif." };
  }
  for (const entry of assignments) {
    const group = groups.find((g) => g.id === entry.groupId)!;
    const memberIds = new Set(group.members.map((member) => member.userId));
    if (entry.participantIds.some((userId) => !memberIds.has(userId))) {
      return {
        ok: false,
        error:
          `Un agent sélectionné n'appartient plus à ${group.name}, n'est plus actif ` +
          "ou n'a pas terminé son profil.",
      };
    }
  }

  const meta = await requestMeta();
  const leadEntry = assignments.find((a) => a.isLead) ?? assignments[0]!;
  const totalHeadcount = assignments.reduce((sum, a) => sum + a.participantIds.length, 0);

  let fromStatus: MissionStatus = "AVAILABLE";
  let toStatus: MissionStatus = start ? "IN_PROGRESS" : "ASSIGNED";
  let eligibilityWarnings: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // Relecture du statut DANS la transaction (protection concurrence)
      const mission = await tx.mission.findUnique({
        where: { id: missionId },
        select: {
          id: true,
          status: true,
          code: true,
          rank: true,
          category: true,
          publicTitle: true,
          groupSizeMin: true,
          groupSizeMax: true,
          eligibilityMode: true,
          requiresEnhancedReview: true,
          minRecommendedLevel: { select: { label: true, order: true } },
        },
      });
      if (!mission) throw new Error("NOT_FOUND");
      if (!["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"].includes(mission.status)) {
        throw new Error("BAD_STATUS");
      }
      fromStatus = mission.status;
      toStatus = start ? "IN_PROGRESS" : mission.status === "IN_PROGRESS" ? "IN_PROGRESS" : "ASSIGNED";
      const finalTeamRequired = start || mission.status === "IN_PROGRESS";

      // Un contrôle renforcé est une décision explicite du modérateur, pas une
      // simple case décorative. Toute attribution ou modification exige une
      // confirmation ET une note, même si le démarrage est différé.
      if (
        (mission.requiresEnhancedReview || mission.eligibilityMode === "MANUAL_REVIEW") &&
        (!reviewConfirmed || !normalizedReason)
      ) {
        throw new Error("ENHANCED_REVIEW_REQUIRED");
      }

      // Les membres et l'état des groupes sont relus dans la transaction :
      // une ancienne modale ne peut pas engager un agent parti depuis.
      const liveGroups = await tx.group.findMany({
        where: { id: { in: assignments.map((assignment) => assignment.groupId) }, isActive: true },
        select: {
          id: true,
          factionId: true,
          members: {
            where: { user: { status: "ACTIVE", profileCompleted: true } },
            select: {
              userId: true,
              user: { select: { playerLevel: { select: { order: true } } } },
            },
          },
        },
      });
      if (liveGroups.length !== assignments.length) throw new Error("GROUPS_CHANGED");
      for (const entry of assignments) {
        const liveGroup = liveGroups.find((group) => group.id === entry.groupId)!;
        const liveMemberIds = new Set(liveGroup.members.map((member) => member.userId));
        if (entry.participantIds.some((userId) => !liveMemberIds.has(userId))) {
          throw new Error("GROUPS_CHANGED");
        }
      }

      // Recalcul sur les agents relus dans la transaction. Le bilan affiché
      // dans la modale ne constitue jamais une autorisation suffisante.
      const participantLevels = assignments.flatMap((entry) => {
        const liveGroup = liveGroups.find((group) => group.id === entry.groupId)!;
        const membersById = new Map(
          liveGroup.members.map((member) => [member.userId, member] as const),
        );
        return entry.participantIds.map(
          (userId) => membersById.get(userId)?.user.playerLevel?.order ?? null,
        );
      });
      const eligibilityIssues = evaluateTeamEligibility({
        participantLevels,
        groupSizeMin: mission.groupSizeMin,
        groupSizeMax: mission.groupSizeMax,
        minLevel: mission.minRecommendedLevel,
      });
      const eligibilityDecision = applyEligibilityMode(
        mission.eligibilityMode,
        eligibilityIssues,
      );
      const finalTeamBelowMinimum =
        finalTeamRequired && eligibilityIssues.some((issue) => issue.code === "below_min");
      if (
        mission.eligibilityMode === "STRICT" &&
        (!eligibilityDecision.allowed || finalTeamBelowMinimum)
      ) {
        const blockingIssues = eligibilityIssues.filter(
          (issue) => issue.blocksStrict || (finalTeamRequired && issue.code === "below_min"),
        );
        throw new AssignmentEligibilityError(
          blockingIssues.map((issue) => issue.message),
        );
      }
      eligibilityWarnings = eligibilityDecision.claimWarnings;

      const liveLeadGroup = liveGroups.find((group) => group.id === leadEntry.groupId)!;
      const groupClaims = await tx.missionClaim.findMany({
        where: {
          missionId,
          groupId: { in: assignments.map((assignment) => assignment.groupId) },
          status: { in: ["PENDING", "INFO_REQUESTED", "ACCEPTED"] },
        },
        select: {
          groupId: true,
          publicRoster: true,
          participants: { select: { userId: true } },
        },
      });
      const publicRosterByGroup = new Map(
        groupClaims.map((claim) => {
          const selectedIds =
            assignments.find((assignment) => assignment.groupId === claim.groupId)
              ?.participantIds ?? [];
          const claimedIds = claim.participants.map((participant) => participant.userId);
          return [
            claim.groupId,
            canReusePublicRosterConsent(claim.publicRoster, claimedIds, selectedIds),
          ] as const;
        }),
      );

      // Les groupes retirés de la sélection sont libérés (historique conservé)
      await tx.missionAssignment.updateMany({
        where: { missionId, active: true, groupId: { notIn: assignments.map((a) => a.groupId) } },
        data: {
          active: false,
          releasedAt: new Date(),
          releasedReason: "Retiré lors d'une réattribution",
        },
      });

      const selectedParticipantIds = assignments.flatMap((assignment) => assignment.participantIds);
      await tx.missionParticipant.deleteMany({
        where: { missionId, userId: { notIn: selectedParticipantIds } },
      });

      for (const entry of assignments) {
        const group = liveGroups.find((g) => g.id === entry.groupId)!;
        const existing = await tx.missionAssignment.findFirst({
          where: { missionId, groupId: entry.groupId, active: true },
          select: { id: true },
        });
        if (existing) {
          await tx.missionAssignment.update({
            where: { id: existing.id },
            data: {
              assignedHeadcount: entry.participantIds.length,
              isLeadGroup: entry.groupId === leadEntry.groupId,
              notes: normalizedReason ?? null,
              // Le consentement public d'une revendication ne vaut que pour
              // son roster exact. Tout ajout manuel referme l'équipe.
              publicRoster: publicRosterByGroup.get(entry.groupId) ?? false,
            },
          });
        } else {
          await tx.missionAssignment.create({
            data: {
              missionId,
              factionId: group.factionId,
              groupId: entry.groupId,
              assignedById: current.session.userId,
              assignedHeadcount: entry.participantIds.length,
              isLeadGroup: entry.groupId === leadEntry.groupId,
              publicRoster: publicRosterByGroup.get(entry.groupId) ?? false,
              notes: normalizedReason ?? null,
            },
          });
        }
        for (const userId of entry.participantIds) {
          await tx.missionParticipant.upsert({
            where: { missionId_userId: { missionId, userId } },
            update: { groupId: entry.groupId, addedById: current.session.userId },
            create: {
              missionId,
              userId,
              groupId: entry.groupId,
              addedById: current.session.userId,
            },
          });
        }
        // La revendication correspondante devient acceptée
        await tx.missionClaim.updateMany({
          where: {
            missionId,
            groupId: entry.groupId,
            status: { in: ["PENDING", "INFO_REQUESTED"] },
          },
          data: {
            status: "ACCEPTED",
            moderatorId: current.session.userId,
            resolvedAt: new Date(),
          },
        });
      }

      const updated = await tx.mission.updateMany({
        where: { id: missionId, status: fromStatus },
        data: {
          status: toStatus,
          // Colonnes héritées : groupe principal (compatibilité lecture)
          assignedFactionId: liveLeadGroup.factionId,
          assignedGroupId: liveLeadGroup.id,
          assignedAt: new Date(),
        },
      });
      if (updated.count === 0) throw new Error("CONCURRENT");

      if (fromStatus !== toStatus) {
        await tx.missionStatusHistory.create({
          data: {
            missionId,
            fromStatus: fromStatus as never,
            toStatus,
            changedById: current.session.userId,
            reason:
              `Équipe : ${assignments.length} groupe(s), ${totalHeadcount} participant(s)` +
              `${normalizedReason ? ` — ${normalizedReason}` : ""}` +
              `${eligibilityWarnings.length > 0 ? ` — Écarts : ${eligibilityWarnings.join(" ")}` : ""}`,
          },
        });
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof AssignmentEligibilityError) {
      return {
        ok: false,
        error: `Critères d'éligibilité non remplis : ${error.issues.join(" ")}`,
        warnings: error.issues,
      };
    }
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") return { ok: false, error: "Mission introuvable." };
      if (error.message === "BAD_STATUS")
        return { ok: false, error: "Cette mission n'est plus attribuable." };
      if (error.message === "CONCURRENT")
        return { ok: false, error: "La mission vient d'être modifiée — rechargez le tableau." };
      if (error.message === "GROUPS_CHANGED") {
        return {
          ok: false,
          error: "Un groupe ou sa liste d'agents a changé ; rechargez l'attribution.",
        };
      }
      if (error.message === "ENHANCED_REVIEW_REQUIRED") {
        return {
          ok: false,
          error:
            "Le contrôle renforcé doit être confirmé et accompagné d'une note avant l'attribution.",
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

  const mission = await prisma.mission.findUniqueOrThrow({
    where: { id: missionId },
    select: { code: true, rank: true, category: true, publicTitle: true },
  });

  await audit({
    actorId: current.session.userId,
    action: "mission.assigned",
    resourceType: "mission",
    resourceId: missionId,
    oldValues: { status: fromStatus },
    newValues: {
      status: toStatus,
      groups: assignments.map((a) => ({
        groupId: a.groupId,
        headcount: a.participantIds.length,
        isLead: a.groupId === leadEntry.groupId,
      })),
      totalHeadcount,
      eligibilityWarnings,
      reviewConfirmed: Boolean(reviewConfirmed),
    },
    reason: normalizedReason,
    ...meta,
  });

  // Notifications APRÈS la transaction : chaque groupe + modération.
  // Payload strictement public (code, rang, titre) — pas de détails.
  const payload = {
    code: mission.code,
    rank: mission.rank,
    category: mission.category,
    title: mission.publicTitle,
    groupsCount: assignments.length,
    totalHeadcount,
  };
  for (const entry of assignments) {
    await enqueueNotifications({
      userIds: entry.participantIds.filter((id) => id !== current.session.userId),
      event: "CLAIM_ACCEPTED",
      payload,
      missionId,
    });
  }
  const moderators = await userIdsWithPermission(PERMISSIONS.CLAIM_REVIEW);
  await enqueueNotifications({
    userIds: moderators.filter((id) => id !== current.session.userId),
    event: "MISSION_STATUS_CHANGED",
    payload: { ...payload, fromStatus, toStatus },
    missionId,
    batchKey: `assign:${missionId}`,
  });

  revalidatePath("/missions");
  revalidatePath(`/missions/${missionId}`);
  revalidatePath("/revendications");
  return { ok: true, ...(eligibilityWarnings.length > 0 ? { warnings: eligibilityWarnings } : {}) };
}
