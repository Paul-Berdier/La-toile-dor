"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { MissionStatus } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS, missionAssignSchema } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  userIdsWithPermission,
} from "@/server/notifications";

export interface AssignResult {
  ok: boolean;
  error?: string;
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
  const { missionId, assignments, start, reason } = parsed.data;

  // Vérification des groupes (existence, activité, effectif réel)
  const groups = await prisma.group.findMany({
    where: { id: { in: assignments.map((a) => a.groupId) }, isActive: true },
    include: {
      faction: true,
      members: {
        where: { user: { status: "ACTIVE" } },
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
        error: `Un agent sélectionné n'appartient plus à ${group.name} ou n'est plus actif.`,
      };
    }
  }

  const meta = await requestMeta();
  const leadEntry = assignments.find((a) => a.isLead) ?? assignments[0]!;
  const totalHeadcount = assignments.reduce((sum, a) => sum + a.participantIds.length, 0);

  let fromStatus: MissionStatus = "AVAILABLE";
  try {
    await prisma.$transaction(async (tx) => {
      // Relecture du statut DANS la transaction (protection concurrence)
      const mission = await tx.mission.findUnique({
        where: { id: missionId },
        select: { id: true, status: true, code: true, rank: true, category: true, publicTitle: true },
      });
      if (!mission) throw new Error("NOT_FOUND");
      if (!["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"].includes(mission.status)) {
        throw new Error("BAD_STATUS");
      }
      fromStatus = mission.status;

      // Les membres et l'état des groupes sont relus dans la transaction :
      // une ancienne modale ne peut pas engager un agent parti depuis.
      const liveGroups = await tx.group.findMany({
        where: { id: { in: assignments.map((assignment) => assignment.groupId) }, isActive: true },
        select: {
          id: true,
          factionId: true,
          members: {
            where: { user: { status: "ACTIVE" } },
            select: { userId: true },
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
      const liveLeadGroup = liveGroups.find((group) => group.id === leadEntry.groupId)!;
      const groupClaims = await tx.missionClaim.findMany({
        where: {
          missionId,
          groupId: { in: assignments.map((assignment) => assignment.groupId) },
        },
        select: { groupId: true, publicRoster: true },
      });
      const publicRosterByGroup = new Map(
        groupClaims.map((claim) => [claim.groupId, claim.publicRoster]),
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
          const claimedVisibility = publicRosterByGroup.get(entry.groupId);
          await tx.missionAssignment.update({
            where: { id: existing.id },
            data: {
              assignedHeadcount: entry.participantIds.length,
              isLeadGroup: entry.groupId === leadEntry.groupId,
              notes: reason ?? null,
              ...(claimedVisibility === undefined
                ? {}
                : { publicRoster: claimedVisibility }),
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
              notes: reason ?? null,
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

      const toStatus = start ? "IN_PROGRESS" : "ASSIGNED";
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
            reason: `Équipe : ${assignments.length} groupe(s), ${totalHeadcount} participant(s)${reason ? ` — ${reason}` : ""}`,
          },
        });
      }
    }, { isolationLevel: "Serializable" });
  } catch (error) {
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
      status: start ? "IN_PROGRESS" : "ASSIGNED",
      groups: assignments.map((a) => ({
        groupId: a.groupId,
        headcount: a.participantIds.length,
        isLead: a.groupId === leadEntry.groupId,
      })),
      totalHeadcount,
    },
    reason,
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
    payload: { ...payload, fromStatus, toStatus: start ? "IN_PROGRESS" : "ASSIGNED" },
    missionId,
    batchKey: `assign:${missionId}`,
  });

  revalidatePath("/missions");
  revalidatePath(`/missions/${missionId}`);
  revalidatePath("/revendications");
  return { ok: true };
}
