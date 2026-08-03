"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import {
  audit,
  createInvitation,
  revokeInvitation,
  revokeAllUserSessions,
} from "@toile/auth";
import { PERMISSIONS, invitationCreateSchema, scoreAdjustSchema } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";

interface Result {
  ok: boolean;
  error?: string;
  inviteUrl?: string;
}

async function guard(permission: string): Promise<{ userId: string } | null> {
  const current = await requireUser();
  if (!current.permissions.has(permission)) return null;
  return { userId: current.session.userId };
}

// ── Utilisateurs ─────────────────────────────────────────────

export async function setUserStatusAction(input: {
  userId: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  reason?: string;
}): Promise<Result> {
  const actor = await guard(
    input.status === "REVOKED" ? PERMISSIONS.ACCESS_REVOKE : PERMISSIONS.USER_MANAGE,
  );
  if (!actor) return { ok: false, error: "Permission refusée." };
  if (input.userId === actor.userId) {
    return { ok: false, error: "Impossible de modifier son propre statut." };
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) return { ok: false, error: "Utilisateur introuvable." };

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      status: input.status,
      approvedById: input.status === "ACTIVE" && user.status === "PENDING" ? actor.userId : user.approvedById,
      approvedAt: input.status === "ACTIVE" && user.status === "PENDING" ? new Date() : user.approvedAt,
      revokedAt: input.status === "REVOKED" ? new Date() : null,
      revokedReason: input.status === "REVOKED" ? input.reason ?? null : null,
    },
  });

  // Révocation immédiate de toutes les sessions si l'accès est retiré
  if (input.status !== "ACTIVE") {
    await revokeAllUserSessions(input.userId);
  }

  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action:
      input.status === "REVOKED"
        ? "access.revoked"
        : input.status === "SUSPENDED"
          ? "access.suspended"
          : "access.granted",
    resourceType: "user",
    resourceId: input.userId,
    oldValues: { status: user.status },
    newValues: { status: input.status },
    reason: input.reason,
    ...meta,
  });

  revalidatePath("/admin/utilisateurs");
  return { ok: true };
}

export async function setUserRoleAction(input: {
  userId: string;
  roleSlug: string;
  grant: boolean;
}): Promise<Result> {
  const actor = await guard(PERMISSIONS.MODERATOR_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };

  const role = await prisma.role.findUnique({ where: { slug: input.roleSlug } });
  if (!role) return { ok: false, error: "Rôle inconnu." };

  if (input.grant) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: input.userId, roleId: role.id } },
      update: {},
      create: { userId: input.userId, roleId: role.id, assignedById: actor.userId },
    });
  } else {
    await prisma.userRole.deleteMany({ where: { userId: input.userId, roleId: role.id } });
  }

  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action: "user.role_changed",
    resourceType: "user",
    resourceId: input.userId,
    newValues: { role: input.roleSlug, grant: input.grant },
    ...meta,
  });
  revalidatePath("/admin/utilisateurs");
  return { ok: true };
}

// ── Invitations ──────────────────────────────────────────────

/**
 * Hiérarchie d'invitation de la Toile :
 * - Tisseur d'Or / super administrateurs : peuvent tendre n'importe quel fil ;
 * - Modérateurs : peuvent inviter chefs de groupe et agents ;
 * - Chefs de groupe : peuvent inviter des agents, uniquement dans les
 *   groupes qu'ils dirigent.
 * Les règles sont appliquées CÔTÉ SERVEUR, quel que soit le formulaire.
 */
const INVITE_TIERS: Record<string, string[]> = {
  super_admin: ["super_admin", "moderator", "faction_leader", "faction_member"],
  moderator: ["faction_leader", "faction_member"],
  faction_leader: ["faction_member"],
};

export async function createInvitationAction(raw: unknown): Promise<Result> {
  const current = await requireUser();
  const canManage = current.permissions.has(PERMISSIONS.INVITE_MANAGE);
  if (!canManage && !current.permissions.has(PERMISSIONS.INVITE_CREATE)) {
    return { ok: false, error: "Permission refusée." };
  }

  const parsed = invitationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Paramètres invalides." };
  const data = parsed.data;

  // Rôles détenus par l'inviteur → rôles qu'il peut accorder
  const actorRoles = await prisma.userRole.findMany({
    where: { userId: current.session.userId },
    include: { role: { select: { slug: true } } },
  });
  const slugs = new Set(actorRoles.map((r) => r.role.slug));
  const allowedTargets = new Set<string>(
    [...slugs].flatMap((slug) => INVITE_TIERS[slug] ?? []),
  );
  if (!allowedTargets.has(data.roleSlug)) {
    return { ok: false, error: "La Toile ne vous autorise pas à tendre ce fil-là." };
  }

  let factionId = data.factionId;
  let groupId = data.groupId;

  const isModOrAbove = slugs.has("super_admin") || slugs.has("moderator");
  if (!isModOrAbove) {
    // Chef de groupe : le fil ne peut mener que vers un de SES groupes
    if (!groupId) {
      return { ok: false, error: "Choisissez le groupe que rejoindra votre agent." };
    }
    const led = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: current.session.userId } },
      include: { group: true },
    });
    if (!led?.isLeader || !led.group.isActive) {
      return { ok: false, error: "Vous ne dirigez pas ce groupe." };
    }
    factionId = led.group.factionId;
  } else if (groupId) {
    // Cohérence groupe/faction pour la modération
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || !group.isActive) return { ok: false, error: "Groupe introuvable." };
    if (factionId && group.factionId !== factionId) {
      return { ok: false, error: "Ce groupe n'appartient pas à cette faction." };
    }
    factionId = group.factionId;
  }

  const role = await prisma.role.findUnique({ where: { slug: data.roleSlug } });
  if (!role) return { ok: false, error: "Rôle inconnu." };

  const { token } = await createInvitation({
    createdById: current.session.userId,
    roleId: role.id,
    factionId,
    groupId,
    expiresInHours: data.expiresInHours,
    requireApproval: data.requireApproval,
    restrictedDiscordId: data.restrictedDiscordId,
    note: data.note,
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "invite.created",
    resourceType: "invitation",
    newValues: {
      roleSlug: data.roleSlug,
      factionId: factionId ?? null,
      groupId: groupId ?? null,
      expiresInHours: data.expiresInHours,
    },
    ...meta,
  });

  revalidatePath("/invitations");
  // Le jeton clair n'est montré qu'UNE fois, ici, au créateur.
  return { ok: true, inviteUrl: `${process.env.APP_URL ?? ""}/invitation/${token}` };
}

export async function revokeInvitationAction(invitationId: string): Promise<Result> {
  const current = await requireUser();
  const canManage = current.permissions.has(PERMISSIONS.INVITE_MANAGE);
  if (!canManage && !current.permissions.has(PERMISSIONS.INVITE_CREATE)) {
    return { ok: false, error: "Permission refusée." };
  }

  // Sans invite.manage, on ne peut rompre que ses propres fils
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) return { ok: false, error: "Invitation introuvable." };
  if (!canManage && invitation.createdById !== current.session.userId) {
    return { ok: false, error: "Vous ne pouvez rompre que vos propres fils." };
  }

  await revokeInvitation(invitationId);
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "invite.revoked",
    resourceType: "invitation",
    resourceId: invitationId,
    ...meta,
  });
  revalidatePath("/invitations");
  return { ok: true };
}

// ── Configuration ────────────────────────────────────────────

export async function updateRpTimeAction(input: {
  realMsPerRpMonth: number;
  rpMonthsPerYear: number;
  realEpochIso: string;
  rpEpochYear: number;
}): Promise<Result> {
  const actor = await guard(PERMISSIONS.SETTINGS_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };
  if (input.realMsPerRpMonth < 60_000) {
    return { ok: false, error: "Le ratio minimal est d'une minute réelle par mois RP." };
  }
  if (!Number.isInteger(input.rpMonthsPerYear) || input.rpMonthsPerYear < 1 || input.rpMonthsPerYear > 24) {
    return { ok: false, error: "L'année RP doit compter entre 1 et 24 mois." };
  }

  await prisma.appSetting.upsert({
    where: { key: "rp_time" },
    update: { value: input, updatedById: actor.userId },
    create: { key: "rp_time", value: input, updatedById: actor.userId },
  });

  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action: "settings.rp_time_updated",
    newValues: input,
    ...meta,
  });
  revalidatePath("/admin/configuration");
  return { ok: true };
}

export async function updateRankConfigAction(input: {
  rank: string;
  rewardRyoMin: number;
  rewardRyoMax: number;
  defaultPoints: number;
  recommendedGroupSize: number;
}): Promise<Result> {
  const actor = await guard(PERMISSIONS.SETTINGS_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };

  await prisma.rankConfig.update({
    where: { rank: input.rank as never },
    data: {
      rewardRyoMin: input.rewardRyoMin,
      rewardRyoMax: input.rewardRyoMax,
      defaultPoints: input.defaultPoints,
      recommendedGroupSize: input.recommendedGroupSize,
    },
  });
  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action: "settings.rank_updated",
    resourceType: "rank",
    resourceId: input.rank,
    newValues: input,
    ...meta,
  });
  revalidatePath("/admin/configuration");
  return { ok: true };
}

export async function updateLevelLabelAction(input: {
  slug: string;
  label: string;
}): Promise<Result> {
  const actor = await guard(PERMISSIONS.SETTINGS_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };
  const label = input.label.trim();
  if (!label || label.length > 60) return { ok: false, error: "Libellé invalide." };

  await prisma.playerLevel.update({ where: { slug: input.slug }, data: { label } });
  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action: "settings.level_renamed",
    resourceType: "level",
    resourceId: input.slug,
    newValues: { label },
    ...meta,
  });
  revalidatePath("/admin/configuration");
  return { ok: true };
}

export async function createSeasonAction(input: { name: string }): Promise<Result> {
  const actor = await guard(PERMISSIONS.SETTINGS_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nom requis." };

  await prisma.$transaction([
    prisma.leaderboardSeason.updateMany({ where: { isActive: true }, data: { isActive: false, endsAt: new Date() } }),
    prisma.leaderboardSeason.create({ data: { name, startsAt: new Date(), isActive: true } }),
  ]);
  const meta = await requestMeta();
  await audit({ actorId: actor.userId, action: "season.created", newValues: { name }, ...meta });
  revalidatePath("/admin/configuration");
  revalidatePath("/classement");
  return { ok: true };
}

// ── Points (ajustement manuel justifié) ──────────────────────

export async function adjustScoreAction(raw: unknown): Promise<Result> {
  const actor = await guard(PERMISSIONS.POINTS_ADJUST);
  if (!actor) return { ok: false, error: "Permission refusée." };

  const parsed = scoreAdjustSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Paramètres invalides (justification obligatoire, 3 caractères min)." };
  }
  const data = parsed.data;
  const season = await prisma.leaderboardSeason.findFirst({ where: { isActive: true } });

  await prisma.missionScore.create({
    data: {
      missionId: data.missionId ?? null,
      seasonId: season?.id ?? null,
      factionId: data.factionId,
      groupId: data.groupId ?? null,
      points: data.points,
      reason: data.reason,
      justification: data.justification,
      createdById: actor.userId,
    },
  });
  const meta = await requestMeta();
  await audit({
    actorId: actor.userId,
    action: "points.adjusted",
    resourceType: "faction",
    resourceId: data.factionId,
    newValues: { points: data.points, reason: data.reason },
    reason: data.justification,
    ...meta,
  });
  revalidatePath("/classement");
  return { ok: true };
}

// ── Factions et groupes ──────────────────────────────────────

export async function createFactionAction(input: { name: string }): Promise<Result> {
  const actor = await guard(PERMISSIONS.FACTION_MANAGE);
  if (!actor) return { ok: false, error: "Permission refusée." };
  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, error: "Nom invalide." };
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (!slug) return { ok: false, error: "Nom invalide." };

  const existing = await prisma.faction.findUnique({ where: { slug } });
  if (existing) return { ok: false, error: "Une faction porte déjà ce nom." };

  await prisma.faction.create({ data: { slug, name } });
  const meta = await requestMeta();
  await audit({ actorId: actor.userId, action: "faction.created", newValues: { name }, ...meta });
  revalidatePath("/admin/factions");
  return { ok: true };
}

export async function createGroupAction(input: {
  factionId: string;
  name: string;
}): Promise<Result> {
  const current = await requireUser();
  const isAdmin = current.permissions.has(PERMISSIONS.FACTION_MANAGE);
  const isLeaderOfFaction =
    current.permissions.has(PERMISSIONS.GROUP_MANAGE) &&
    (await prisma.factionMember.findFirst({
      where: { factionId: input.factionId, userId: current.session.userId, isLeader: true },
    })) !== null;
  if (!isAdmin && !isLeaderOfFaction) return { ok: false, error: "Permission refusée." };

  const name = input.name.trim();
  if (!name || name.length > 80) return { ok: false, error: "Nom invalide." };

  const existing = await prisma.group.findUnique({
    where: { factionId_name: { factionId: input.factionId, name } },
  });
  if (existing) return { ok: false, error: "Ce groupe existe déjà." };

  await prisma.group.create({ data: { factionId: input.factionId, name } });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "group.created",
    resourceType: "faction",
    resourceId: input.factionId,
    newValues: { name },
    ...meta,
  });
  revalidatePath("/admin/factions");
  return { ok: true };
}
