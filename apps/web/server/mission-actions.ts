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
  type Rank,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotifications,
  factionLeaderIds,
  groupMemberIds,
  userIdsWithPermission,
} from "@/server/notifications";
import { getAccessContext } from "@/server/missions";

export interface ActionResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
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
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_MOVE)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = missionMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { missionId, toStatus, reason } = parsed.data;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) return { ok: false, error: "Mission introuvable." };
  if (mission.status === toStatus) return { ok: true };

  const meta = await requestMeta();
  const fromStatus = mission.status;

  await prisma.$transaction([
    prisma.mission.update({
      where: { id: missionId },
      data: {
        status: toStatus,
        resolvedAt: AUTO_RESOLVED.includes(toStatus) ? new Date() : null,
        failureReason: toStatus === "FAILED" ? reason ?? mission.failureReason : mission.failureReason,
        cancellationReason:
          toStatus === "CANCELLED" ? reason ?? mission.cancellationReason : mission.cancellationReason,
      },
    }),
    prisma.missionStatusHistory.create({
      data: {
        missionId,
        fromStatus,
        toStatus,
        changedById: current.session.userId,
        reason: reason ?? null,
      },
    }),
  ]);

  await audit({
    actorId: current.session.userId,
    action: "mission.status_changed",
    resourceType: "mission",
    resourceId: missionId,
    oldValues: { status: fromStatus },
    newValues: { status: toStatus },
    reason,
    ...meta,
  });

  // Points automatiques à l'accomplissement (ligne de registre justifiée)
  if (toStatus === "COMPLETED" && mission.assignedFactionId) {
    const alreadyScored = await prisma.missionScore.findFirst({
      where: { missionId, reason: "MISSION_COMPLETED" },
    });
    if (!alreadyScored) {
      const season = await prisma.leaderboardSeason.findFirst({ where: { isActive: true } });
      const { breakdown } = computeMissionScore(mission.rank as Rank, "COMPLETED", {}, mission.basePoints);
      for (const line of breakdown) {
        await prisma.missionScore.create({
          data: {
            missionId,
            seasonId: season?.id ?? null,
            factionId: mission.assignedFactionId,
            groupId: mission.assignedGroupId,
            points: line.points,
            reason: line.reason as never,
            justification: "Attribution automatique à l'accomplissement (ajustable).",
            createdById: current.session.userId,
          },
        });
      }
    }
  }

  // Notifications : groupe attribué + chefs de faction concernés
  const targets = new Set<string>();
  if (mission.assignedGroupId) {
    for (const id of await groupMemberIds(mission.assignedGroupId)) targets.add(id);
  }
  if (mission.assignedFactionId) {
    for (const id of await factionLeaderIds(mission.assignedFactionId)) targets.add(id);
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
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Revendication (chefs de faction)
// ─────────────────────────────────────────────────────────────

export async function claimMissionAction(input: {
  missionId: string;
  groupId: string;
  message?: string;
}): Promise<ActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_CLAIM)) {
    return { ok: false, error: "Seuls les chefs de faction peuvent réclamer une mission." };
  }
  const parsed = missionClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Requête invalide." };
  const { missionId, groupId, message } = parsed.data;

  const ctx = await getAccessContext(current);
  const ledGroup = ctx.ledGroups.find((g) => g.id === groupId);
  if (!ledGroup) return { ok: false, error: "Vous ne dirigez pas ce groupe." };

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { minRecommendedLevel: true },
  });
  if (!mission || !["AVAILABLE", "CLAIM_PENDING"].includes(mission.status)) {
    return { ok: false, error: "Cette mission n'est plus disponible." };
  }

  // Avertissements d'éligibilité (mode configuré par mission)
  const warnings: string[] = [];
  if (ledGroup.memberCount < mission.groupSizeMin) {
    warnings.push(
      `Le groupe compte ${ledGroup.memberCount} membre(s) ; minimum recommandé : ${mission.groupSizeMin}.`,
    );
  }
  if (ledGroup.memberCount > mission.groupSizeMax) {
    warnings.push(
      `Le groupe compte ${ledGroup.memberCount} membre(s) ; maximum autorisé : ${mission.groupSizeMax}.`,
    );
  }
  if (mission.minRecommendedLevelId) {
    const [minLevel, members] = await Promise.all([
      prisma.playerLevel.findUnique({ where: { id: mission.minRecommendedLevelId } }),
      prisma.groupMember.findMany({
        where: { groupId },
        include: { user: { include: { playerLevel: true } } },
      }),
    ]);
    if (minLevel) {
      const below = members.filter(
        (m) => (m.user.playerLevel?.order ?? 0) < minLevel.order,
      ).length;
      if (below > 0) {
        warnings.push(
          `${below} membre(s) du groupe se trouvent sous le niveau recommandé (${minLevel.label}).`,
        );
      }
    }
  }
  if (mission.eligibilityMode === "STRICT" && warnings.length > 0) {
    return { ok: false, error: "Critères d'éligibilité non remplis.", warnings };
  }

  const existing = await prisma.missionClaim.findUnique({
    where: { missionId_groupId: { missionId, groupId } },
  });
  if (existing && ["PENDING", "ACCEPTED", "INFO_REQUESTED"].includes(existing.status)) {
    return { ok: false, error: "Ce groupe a déjà une revendication en cours sur cette mission." };
  }

  const meta = await requestMeta();
  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.missionClaim.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          message: message ?? null,
          leaderId: current.session.userId,
          warnings,
          resolvedAt: null,
          moderatorId: null,
          moderatorNote: null,
          createdAt: new Date(),
        },
      });
    } else {
      await tx.missionClaim.create({
        data: {
          missionId,
          groupId,
          leaderId: current.session.userId,
          message: message ?? null,
          warnings,
        },
      });
    }
    if (mission.status === "AVAILABLE") {
      await tx.mission.update({ where: { id: missionId }, data: { status: "CLAIM_PENDING" } });
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
  });

  await audit({
    actorId: current.session.userId,
    action: "mission.claimed",
    resourceType: "mission",
    resourceId: missionId,
    newValues: { groupId },
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
  return { ok: true, warnings };
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
    include: { mission: true, group: { include: { faction: true } } },
  });
  if (!claim || !["PENDING", "INFO_REQUESTED"].includes(claim.status)) {
    return { ok: false, error: "Revendication introuvable ou déjà traitée." };
  }
  const meta = await requestMeta();
  const mission = claim.mission;

  if (decision === "ACCEPTED") {
    if (!["AVAILABLE", "CLAIM_PENDING"].includes(mission.status)) {
      return { ok: false, error: "La mission n'est plus attribuable." };
    }
    const rejectedLeaders: string[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.missionClaim.update({
        where: { id: claimId },
        data: {
          status: "ACCEPTED",
          moderatorId: current.session.userId,
          moderatorNote: note ?? null,
          resolvedAt: new Date(),
        },
      });
      // Les autres revendications en attente sont refusées automatiquement
      const others = await tx.missionClaim.findMany({
        where: { missionId: mission.id, id: { not: claimId }, status: { in: ["PENDING", "INFO_REQUESTED"] } },
      });
      rejectedLeaders.push(...others.map((o) => o.leaderId));
      await tx.missionClaim.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: {
          status: "REJECTED",
          moderatorId: current.session.userId,
          moderatorNote: "La mission a été attribuée à un autre groupe.",
          resolvedAt: new Date(),
        },
      });
      // Une seule attribution active par mission
      await tx.missionAssignment.updateMany({
        where: { missionId: mission.id, active: true },
        data: { active: false, releasedAt: new Date(), releasedReason: "Réattribution" },
      });
      await tx.missionAssignment.create({
        data: {
          missionId: mission.id,
          factionId: claim.group.factionId,
          groupId: claim.groupId,
          assignedById: current.session.userId,
        },
      });
      await tx.mission.update({
        where: { id: mission.id },
        data: {
          status: "ASSIGNED",
          assignedFactionId: claim.group.factionId,
          assignedGroupId: claim.groupId,
          assignedAt: new Date(),
        },
      });
      await tx.missionStatusHistory.create({
        data: {
          missionId: mission.id,
          fromStatus: mission.status,
          toStatus: "ASSIGNED",
          changedById: current.session.userId,
          reason: `Attribuée à ${claim.group.faction.name} — ${claim.group.name}`,
        },
      });
    });

    await audit({
      actorId: current.session.userId,
      action: "mission.assigned",
      resourceType: "mission",
      resourceId: mission.id,
      newValues: { groupId: claim.groupId, factionId: claim.group.factionId },
      reason: note,
      ...meta,
    });

    const members = await groupMemberIds(claim.groupId);
    await enqueueNotifications({
      userIds: members,
      event: "CLAIM_ACCEPTED",
      payload: publicPayload(mission),
      missionId: mission.id,
    });
    if (rejectedLeaders.length > 0) {
      await enqueueNotifications({
        userIds: rejectedLeaders,
        event: "CLAIM_REJECTED",
        payload: publicPayload(mission),
        missionId: mission.id,
      });
    }
  } else {
    await prisma.missionClaim.update({
      where: { id: claimId },
      data: {
        status: decision,
        moderatorId: current.session.userId,
        moderatorNote: note ?? null,
        resolvedAt: decision === "REJECTED" ? new Date() : null,
      },
    });
    if (decision === "REJECTED") {
      const remaining = await prisma.missionClaim.count({
        where: { missionId: mission.id, status: { in: ["PENDING", "INFO_REQUESTED"] } },
      });
      if (remaining === 0 && mission.status === "CLAIM_PENDING") {
        await prisma.mission.update({ where: { id: mission.id }, data: { status: "AVAILABLE" } });
        await prisma.missionStatusHistory.create({
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

export async function submitReportAction(input: {
  missionId: string;
  content: string;
  isFinal: boolean;
}): Promise<ActionResult> {
  const current = await requireUser();
  const content = input.content?.trim();
  if (!content || content.length < 10 || content.length > 20_000) {
    return { ok: false, error: "Le rapport doit contenir entre 10 et 20 000 caractères." };
  }

  const mission = await prisma.mission.findUnique({ where: { id: input.missionId } });
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
      isFinal: input.isFinal,
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.report_submitted",
    resourceType: "mission",
    resourceId: mission.id,
    newValues: { isFinal: input.isFinal },
    ...meta,
  });

  if (input.isFinal) {
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
