"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { MissionStatus } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS, missionAssignSchema } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  factionLeaderIds,
  groupMemberIds,
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
    include: { faction: true, _count: { select: { members: true } } },
  });
  if (groups.length !== assignments.length) {
    return { ok: false, error: "Un des groupes sélectionnés est introuvable ou inactif." };
  }
  for (const entry of assignments) {
    const group = groups.find((g) => g.id === entry.groupId)!;
    if (group._count.members > 0 && entry.headcount > group._count.members) {
      return {
        ok: false,
        error: `${group.name} ne compte que ${group._count.members} membre(s).`,
      };
    }
  }

  const meta = await requestMeta();
  const leadEntry = assignments.find((a) => a.isLead) ?? assignments[0]!;
  const leadGroup = groups.find((g) => g.id === leadEntry.groupId)!;
  const totalHeadcount = assignments.reduce((sum, a) => sum + a.headcount, 0);

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

      // Les groupes retirés de la sélection sont libérés (historique conservé)
      await tx.missionAssignment.updateMany({
        where: { missionId, active: true, groupId: { notIn: assignments.map((a) => a.groupId) } },
        data: {
          active: false,
          releasedAt: new Date(),
          releasedReason: "Retiré lors d'une réattribution",
        },
      });

      for (const entry of assignments) {
        const group = groups.find((g) => g.id === entry.groupId)!;
        const existing = await tx.missionAssignment.findFirst({
          where: { missionId, groupId: entry.groupId, active: true },
          select: { id: true },
        });
        if (existing) {
          await tx.missionAssignment.update({
            where: { id: existing.id },
            data: {
              assignedHeadcount: entry.headcount,
              isLeadGroup: entry.groupId === leadEntry.groupId,
              notes: reason ?? null,
            },
          });
        } else {
          await tx.missionAssignment.create({
            data: {
              missionId,
              factionId: group.factionId,
              groupId: entry.groupId,
              assignedById: current.session.userId,
              assignedHeadcount: entry.headcount,
              isLeadGroup: entry.groupId === leadEntry.groupId,
              notes: reason ?? null,
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
          assignedFactionId: leadGroup.factionId,
          assignedGroupId: leadGroup.id,
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
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") return { ok: false, error: "Mission introuvable." };
      if (error.message === "BAD_STATUS")
        return { ok: false, error: "Cette mission n'est plus attribuable." };
      if (error.message === "CONCURRENT")
        return { ok: false, error: "La mission vient d'être modifiée — rechargez le tableau." };
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
        headcount: a.headcount,
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
    const members = await groupMemberIds(entry.groupId);
    await enqueueNotifications({
      userIds: members.filter((id) => id !== current.session.userId),
      event: "CLAIM_ACCEPTED",
      payload,
      missionId,
    });
    const group = groups.find((g) => g.id === entry.groupId)!;
    await enqueueNotifications({
      userIds: (await factionLeaderIds(group.factionId)).filter(
        (id) => id !== current.session.userId,
      ),
      event: "MISSION_STATUS_CHANGED",
      payload: { ...payload, fromStatus, toStatus: start ? "IN_PROGRESS" : "ASSIGNED" },
      missionId,
      batchKey: `assign:${missionId}`,
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
