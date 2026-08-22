"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import {
  PERMISSIONS,
  userLevelChangeDecisionSchema,
  userLevelChangeRequestCreateSchema,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import {
  enqueueNotificationsTx,
  userIdsWithPermissionTx,
} from "@/server/notifications";

export interface UserLevelActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

function prismaCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

/**
 * Demande motivée par le membre lui-même, ou par un chef pour un membre actif
 * d'un groupe qu'il dirige réellement. Le rôle global group_leader ne suffit
 * jamais : les deux appartenances sont relues dans la transaction.
 */
export async function requestUserLevelChangeAction(raw: unknown): Promise<UserLevelActionResult> {
  const current = await requireUser();
  const parsed = userLevelChangeRequestCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const data = parsed.data;
  const actorId = current.session.userId;
  const isSelfRequest = data.targetUserId === actorId;
  if (isSelfRequest && data.groupId) {
    return { ok: false, error: "Une demande personnelle ne doit pas être rattachée à un groupe." };
  }
  if (!isSelfRequest && !data.groupId) {
    return { ok: false, error: "Choisissez le groupe au nom duquel vous faites cette demande." };
  }

  try {
    const meta = await requestMeta();
    await prisma.$transaction(
      async (tx) => {
        const [target, requestedLevel, pending] = await Promise.all([
          tx.user.findUnique({
            where: { id: data.targetUserId },
            select: {
              id: true,
              displayName: true,
              status: true,
              profileCompleted: true,
              playerLevelId: true,
              playerLevel: { select: { label: true } },
            },
          }),
          tx.playerLevel.findUnique({
            where: { id: data.requestedLevelId },
            select: { id: true, label: true },
          }),
          tx.userLevelChangeRequest.findFirst({
            where: { targetUserId: data.targetUserId, status: "PENDING" },
            select: { id: true },
          }),
        ]);

        if (!target || target.status !== "ACTIVE") throw new Error("TARGET_INACTIVE");
        if (!target.profileCompleted) throw new Error("TARGET_INCOMPLETE");
        if (!requestedLevel) throw new Error("LEVEL_UNKNOWN");
        if (target.playerLevelId === requestedLevel.id) throw new Error("LEVEL_UNCHANGED");
        if (pending) throw new Error("REQUEST_PENDING");

        let groupName: string | null = null;
        if (!isSelfRequest) {
          const groupId = data.groupId!;
          const [leaderMembership, targetMembership] = await Promise.all([
            tx.groupMember.findUnique({
              where: { groupId_userId: { groupId, userId: actorId } },
              select: { isLeader: true, group: { select: { isActive: true, name: true } } },
            }),
            tx.groupMember.findUnique({
              where: { groupId_userId: { groupId, userId: target.id } },
              select: { userId: true },
            }),
          ]);
          if (!leaderMembership?.isLeader || !leaderMembership.group.isActive) {
            throw new Error("NOT_ACTIVE_LEADER");
          }
          if (!targetMembership) throw new Error("TARGET_NOT_MEMBER");
          groupName = leaderMembership.group.name;
        }

        const request = await tx.userLevelChangeRequest.create({
          data: {
            targetUserId: target.id,
            requestedById: actorId,
            currentLevelId: target.playerLevelId,
            requestedLevelId: requestedLevel.id,
            groupId: isSelfRequest ? null : data.groupId!,
            reason: data.reason,
          },
          select: { id: true },
        });

        const saved = {
          requestId: request.id,
          targetId: target.id,
          targetName: target.displayName,
          currentLevelId: target.playerLevelId,
          currentLevelLabel: target.playerLevel?.label ?? null,
          requestedLevelId: requestedLevel.id,
          requestedLevelLabel: requestedLevel.label,
          groupId: isSelfRequest ? null : data.groupId!,
          groupName,
        };

        await tx.auditLog.create({
          data: {
            actorId,
            action: "user.level_change_requested",
            resourceType: "user",
            resourceId: saved.targetId,
            oldValues: {
              playerLevelId: saved.currentLevelId,
              label: saved.currentLevelLabel,
            },
            newValues: {
              requestId: saved.requestId,
              playerLevelId: saved.requestedLevelId,
              label: saved.requestedLevelLabel,
              groupId: saved.groupId,
            },
            reason: data.reason,
            ...meta,
          },
        });

        const reviewers = await userIdsWithPermissionTx(
          tx,
          PERMISSIONS.USER_LEVEL_MANAGE,
        );
        await enqueueNotificationsTx(tx, {
          // Un modérateur-chef ayant déposé la demande ne peut pas la traiter :
          // ne lui envoyons donc pas un faux appel à sa propre validation.
          userIds: reviewers.filter(
            (userId) => userId !== saved.targetId && userId !== actorId,
          ),
          event: "USER_LEVEL_CHANGE_REQUESTED",
          payload: {
            title: saved.targetName,
            note: `${saved.currentLevelLabel ?? "Sans grade"} → ${saved.requestedLevelLabel}${
              saved.groupName ? ` · ${saved.groupName}` : ""
            }`,
          },
          batchKey: `user-level:${saved.requestId}`,
        });

        return saved;
      },
      { isolationLevel: "Serializable" },
    );

    revalidatePath("/grades");
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "TARGET_INACTIVE") {
        return { ok: false, error: "Ce membre n'existe pas ou son compte n'est pas actif." };
      }
      if (error.message === "TARGET_INCOMPLETE") {
        return { ok: false, error: "Ce membre doit terminer son onboarding avant de demander un grade." };
      }
      if (error.message === "LEVEL_UNKNOWN") {
        return { ok: false, error: "Le grade demandé n'existe pas." };
      }
      if (error.message === "LEVEL_UNCHANGED") {
        return { ok: false, error: "Ce membre possède déjà ce grade." };
      }
      if (error.message === "REQUEST_PENDING") {
        return { ok: false, error: "Une demande de grade est déjà en attente pour ce membre." };
      }
      if (error.message === "NOT_ACTIVE_LEADER") {
        return { ok: false, error: "Vous ne dirigez pas ce groupe actif." };
      }
      if (error.message === "TARGET_NOT_MEMBER") {
        return { ok: false, error: "Ce membre n'appartient plus à ce groupe." };
      }
    }
    if (prismaCode(error) === "P2002") {
      return { ok: false, error: "Une demande de grade est déjà en attente pour ce membre." };
    }
    if (prismaCode(error) === "P2034") {
      return { ok: false, error: "Une modification simultanée a eu lieu ; réessayez." };
    }
    throw error;
  }
}

/**
 * Tranche une demande encore PENDING. Un détenteur de la permission ne peut
 * jamais trancher sa propre évolution de grade : un autre modérateur est
 * requis. L'état attendu du grade est comparé avant toute écriture.
 */
export async function decideUserLevelChangeAction(raw: unknown): Promise<UserLevelActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.USER_LEVEL_MANAGE)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = userLevelChangeDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "La décision et son motif sont obligatoires.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { requestId, decision, reviewNote } = parsed.data;
  const actorId = current.session.userId;
  try {
    const meta = await requestMeta();
    const decided = await prisma.$transaction(
      async (tx) => {
        const request = await tx.userLevelChangeRequest.findUnique({
          where: { id: requestId },
          include: {
            targetUser: {
              select: {
                id: true,
                displayName: true,
                status: true,
                profileCompleted: true,
                playerLevelId: true,
                playerLevel: { select: { label: true } },
              },
            },
            requestedLevel: { select: { id: true, label: true } },
            requestedBy: { select: { id: true } },
            group: { select: { id: true } },
          },
        });
        if (!request || request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
        // Séparation à deux personnes : un modérateur ne tranche ni son
        // propre grade, ni une demande qu'il a lui-même déposée comme chef.
        if (request.targetUserId === actorId || request.requestedById === actorId) {
          throw new Error("SELF_REVIEW");
        }
        if (
          decision === "APPROVED" &&
          request.targetUser.playerLevelId !== request.currentLevelId
        ) {
          throw new Error("LEVEL_CHANGED");
        }
        if (
          decision === "APPROVED" &&
          (request.targetUser.status !== "ACTIVE" || !request.targetUser.profileCompleted)
        ) {
          throw new Error("TARGET_INACTIVE");
        }

        const claimed = await tx.userLevelChangeRequest.updateMany({
          where: { id: request.id, status: "PENDING" },
          data: {
            status: decision,
            reviewedById: actorId,
            reviewNote,
            reviewedAt: new Date(),
          },
        });
        if (claimed.count !== 1) throw new Error("REQUEST_NOT_PENDING");

        if (decision === "APPROVED") {
          const updated = await tx.user.updateMany({
            where: {
              id: request.targetUserId,
              status: "ACTIVE",
              playerLevelId: request.currentLevelId,
            },
            data: { playerLevelId: request.requestedLevelId },
          });
          if (updated.count !== 1) throw new Error("LEVEL_CHANGED");
        }

        const saved = {
          targetId: request.targetUserId,
          targetName: request.targetUser.displayName,
          requesterId: request.requestedBy?.id ?? null,
          groupId: request.group?.id ?? null,
          currentLevelId: request.currentLevelId,
          currentLevelLabel: request.targetUser.playerLevel?.label ?? null,
          requestedLevelId: request.requestedLevel.id,
          requestedLevelLabel: request.requestedLevel.label,
        };

        await tx.auditLog.create({
          data: {
            actorId,
            action:
              decision === "APPROVED"
                ? "user.level_change_approved"
                : "user.level_change_rejected",
            resourceType: "user",
            resourceId: saved.targetId,
            oldValues: {
              requestId,
              playerLevelId: saved.currentLevelId,
              label: saved.currentLevelLabel,
            },
            newValues: {
              status: decision,
              playerLevelId:
                decision === "APPROVED"
                  ? saved.requestedLevelId
                  : saved.currentLevelId,
              requestedPlayerLevelId: saved.requestedLevelId,
              label: saved.requestedLevelLabel,
            },
            reason: reviewNote,
            ...meta,
          },
        });

        await enqueueNotificationsTx(tx, {
          userIds: [
            ...new Set([saved.targetId, saved.requesterId].filter(Boolean) as string[]),
          ],
          event:
            decision === "APPROVED"
              ? "USER_LEVEL_CHANGE_APPROVED"
              : "USER_LEVEL_CHANGE_REJECTED",
          payload: {
            title: `${saved.targetName} · ${saved.requestedLevelLabel}`,
            note: reviewNote,
          },
          batchKey: `user-level:${requestId}:decision`,
        });

        return saved;
      },
      { isolationLevel: "Serializable" },
    );

    revalidatePath("/grades");
    revalidatePath("/compte");
    revalidatePath("/missions");
    revalidatePath("/admin/utilisateurs");
    if (decided.groupId) revalidatePath(`/groupes/${decided.groupId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "REQUEST_NOT_PENDING") {
        return { ok: false, error: "Cette demande a déjà été traitée ou n'existe plus." };
      }
      if (error.message === "SELF_REVIEW") {
        return {
          ok: false,
          error:
            "Vous ne pouvez pas trancher une demande qui vous concerne ou que vous avez déposée : un autre modérateur est requis.",
        };
      }
      if (error.message === "LEVEL_CHANGED") {
        return {
          ok: false,
          error: "Le grade actuel a changé depuis la demande ; refusez-la puis créez-en une nouvelle.",
        };
      }
      if (error.message === "TARGET_INACTIVE") {
        return { ok: false, error: "Le compte concerné n'est plus actif." };
      }
    }
    if (prismaCode(error) === "P2034") {
      return { ok: false, error: "Une décision simultanée a eu lieu ; rechargez la page." };
    }
    throw error;
  }
}
