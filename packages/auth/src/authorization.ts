import { prisma } from "@toile/database";
import type { PermissionKey, MissionViewLevel } from "@toile/shared";

/** Charge l'ensemble des permissions effectives d'un utilisateur (via ses rôles). */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const keys = new Set<string>();
  for (const userRole of roles) {
    for (const rp of userRole.role.permissions) {
      keys.add(rp.permission.key);
    }
  }
  return keys;
}

export async function hasPermission(
  userId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.has(permission);
}

export class ForbiddenError extends Error {
  constructor(message = "Accès refusé") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Lève ForbiddenError si la permission manque. À appeler dans CHAQUE route sensible. */
export async function requirePermission(
  userId: string,
  permission: PermissionKey,
): Promise<void> {
  if (!(await hasPermission(userId, permission))) {
    throw new ForbiddenError(`Permission requise : ${permission}`);
  }
}

/**
 * Détermine le niveau de vue d'un utilisateur sur UNE mission donnée.
 * - moderator : permission mission.view.confidential globale
 * - assigned  : membre du groupe attribué OU participant explicitement ajouté
 * - public    : tout autre utilisateur authentifié
 */
export async function resolveMissionViewLevel(
  userId: string,
  mission: { id: string; assignedGroupId: string | null },
  permissions?: Set<string>,
): Promise<MissionViewLevel> {
  const perms = permissions ?? (await getUserPermissions(userId));
  if (perms.has("mission.view.confidential") && perms.has("mission.view.all")) {
    return "moderator";
  }

  if (mission.assignedGroupId) {
    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: mission.assignedGroupId, userId } },
    });
    if (membership) return "assigned";
  }

  const participant = await prisma.missionParticipant.findUnique({
    where: { missionId_userId: { missionId: mission.id, userId } },
  });
  if (participant) return "assigned";

  return "public";
}

/** Groupes dont l'utilisateur est chef (pour les revendications). */
export async function getLedGroupIds(userId: string): Promise<string[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, isLeader: true, group: { isActive: true } },
    select: { groupId: true },
  });
  return memberships.map((m) => m.groupId);
}
