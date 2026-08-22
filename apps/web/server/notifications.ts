import "server-only";
import { prisma } from "@toile/database";
import type { NotificationEvent, Prisma } from "@toile/database";

export interface EnqueueNotificationsInput {
  userIds: string[];
  event: NotificationEvent;
  payload: Record<string, string | number | null>;
  missionId?: string;
  batchKey?: string;
}

type NotificationDb = Pick<
  Prisma.TransactionClient,
  "notificationPreference" | "notificationDelivery"
>;

type PermissionDb = Pick<Prisma.TransactionClient, "userRole">;

/**
 * File de notifications : le web ÉCRIT, le bot Discord CONSOMME.
 * Le payload ne doit contenir AUCUNE donnée confidentielle de mission —
 * uniquement code, rang, libellés publics et liens vers l'application.
 */
async function enqueueNotificationsWith(
  db: NotificationDb,
  input: EnqueueNotificationsInput,
): Promise<number> {
  if (input.userIds.length === 0) return 0;

  // Respect des préférences : désactivation, sourdine, filtres rang/catégorie
  const prefs = await db.notificationPreference.findMany({
    where: { userId: { in: input.userIds }, event: input.event },
  });
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
  const now = new Date();

  const rows: Prisma.NotificationDeliveryCreateManyInput[] = [];
  for (const userId of new Set(input.userIds)) {
    const pref = prefByUser.get(userId);
    if (pref) {
      if (!pref.enabled) continue;
      if (pref.mutedUntil && pref.mutedUntil > now) continue;
      const rank = input.payload.rank as string | undefined;
      if (rank && pref.rankFilter.length > 0 && !pref.rankFilter.includes(rank as never)) continue;
      const category = input.payload.category as string | undefined;
      if (
        category &&
        pref.categoryFilter.length > 0 &&
        !pref.categoryFilter.includes(category as never)
      )
        continue;
    }
    rows.push({
      userId,
      event: input.event,
      payload: input.payload,
      missionId: input.missionId ?? null,
      batchKey: input.batchKey ?? null,
    });
  }

  if (rows.length === 0) return 0;
  const result = await db.notificationDelivery.createMany({ data: rows });
  return result.count;
}

export async function enqueueNotifications(input: EnqueueNotificationsInput): Promise<number> {
  return enqueueNotificationsWith(prisma, input);
}

/**
 * Variante atomique à appeler depuis une transaction métier. Une erreur de
 * lecture des préférences ou de mise en file est volontairement propagée afin
 * que l'écriture métier et son écho soient annulés ensemble.
 */
export async function enqueueNotificationsTx(
  tx: Prisma.TransactionClient,
  input: EnqueueNotificationsInput,
): Promise<number> {
  return enqueueNotificationsWith(tx, input);
}

async function userIdsWithPermissionUsing(
  db: PermissionDb,
  permissionKey: string,
): Promise<string[]> {
  const users = await db.userRole.findMany({
    where: {
      role: { permissions: { some: { permission: { key: permissionKey } } } },
      user: { status: "ACTIVE" },
    },
    select: { userId: true },
  });
  return [...new Set(users.map((u) => u.userId))];
}

/** Tous les utilisateurs détenant une permission donnée (ex. les modérateurs). */
export async function userIdsWithPermission(permissionKey: string): Promise<string[]> {
  return userIdsWithPermissionUsing(prisma, permissionKey);
}

/** Résout les destinataires dans le même instantané que l'action métier. */
export async function userIdsWithPermissionTx(
  tx: Prisma.TransactionClient,
  permissionKey: string,
): Promise<string[]> {
  return userIdsWithPermissionUsing(tx, permissionKey);
}

/** Chefs de groupe actifs (destinataires des annonces de missions). */
export async function groupLeaderIds(factionId?: string): Promise<string[]> {
  const leaders = await prisma.groupMember.findMany({
    where: {
      isLeader: true,
      user: { status: "ACTIVE" },
      group: {
        isActive: true,
        ...(factionId ? { factionId } : {}),
      },
    },
    select: { userId: true },
  });
  return [...new Set(leaders.map((l) => l.userId))];
}

/** Membres actifs d'un groupe (notifications d'attribution / de mise à jour). */
export async function groupMemberIds(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}
