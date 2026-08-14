import { prisma } from "@toile/database";
import type { Invitation, Prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { generateToken, hashInviteToken } from "./crypto";

export const INVITATION_ROLE_TIERS: Readonly<Record<string, readonly string[]>> = {
  super_admin: ["super_admin", "moderator", "group_leader", "group_member"],
  moderator: ["group_leader", "group_member"],
  group_leader: ["group_member"],
};
const INVITABLE_ROLE_SLUGS = new Set(Object.values(INVITATION_ROLE_TIERS).flat());

export interface CreateInvitationInput {
  createdById: string;
  roleId?: string;
  factionId?: string;
  groupId?: string;
  /** Grade RP attribué dans le cadre contrôlé de l'invitation. */
  playerLevelId?: string;
  groupOnboardingMode?: "NONE" | "EXISTING_GROUP" | "CREATE_NEW_GROUP";
  expiresInHours: number;
  restrictedDiscordId?: string;
  note?: string;
}

/**
 * Crée une invitation. Le jeton clair n'est retourné QU'UNE FOIS ici —
 * seul son hash poivré est stocké.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ token: string; invitation: Invitation }> {
  const token = generateToken();
  const invitation = await prisma.invitation.create({
    data: {
      tokenHash: hashInviteToken(token),
      createdById: input.createdById,
      roleId: input.roleId ?? null,
      factionId: input.factionId ?? null,
      groupId: input.groupId ?? null,
      playerLevelId: input.playerLevelId ?? null,
      groupOnboardingMode: input.groupOnboardingMode ?? "NONE",
      expiresAt: new Date(Date.now() + input.expiresInHours * 3600 * 1000),
      // La possession d'un fil valide vaut admission : aucune seconde
      // approbation manuelle ne doit pouvoir être réactivée par un appelant.
      requireApproval: false,
      restrictedDiscordId: input.restrictedDiscordId ?? null,
      note: input.note ?? null,
    },
  });
  return { token, invitation };
}

export type InvitationCheck =
  | { valid: true; invitation: Invitation }
  | { valid: false; reason: "invalid" | "expired" | "used" | "revoked" };

export type InvitationConsumptionFailure =
  | "invalid"
  | "expired"
  | "used"
  | "revoked"
  | "discord_id_mismatch"
  | "missing_player_level"
  | "creator_inactive"
  | "creator_unauthorized"
  | "invalid_target_role"
  | "invalid_group_mode"
  | "group_inactive"
  | "group_unauthorized"
  | "faction_inactive";

export interface InvitationAuthorityContext {
  creatorStatus: string;
  creatorRoleSlugs: readonly string[];
  creatorPermissions: readonly string[];
  targetRoleSlug: string | null;
  groupOnboardingMode: "NONE" | "EXISTING_GROUP" | "CREATE_NEW_GROUP";
  groupId: string | null;
  factionId: string | null;
  playerLevelId: string | null;
  playerLevelExists: boolean;
  lowestPlayerLevelId: string | null;
  group: {
    isActive: boolean;
    factionId: string | null;
    creatorIsLeader: boolean;
  } | null;
  factionIsActive: boolean | null;
}

/**
 * Rejoue la hiérarchie d'invitation au moment où le fil est consommé.
 * Cette fonction est pure afin que la matrice de sécurité reste testable sans
 * base de données et ne dérive pas silencieusement du formulaire serveur.
 */
export function getInvitationAuthorityFailure(
  context: InvitationAuthorityContext,
): InvitationConsumptionFailure | null {
  if (!context.playerLevelId || !context.playerLevelExists) return "missing_player_level";
  if (context.creatorStatus !== "ACTIVE") return "creator_inactive";
  if (!context.targetRoleSlug || !INVITABLE_ROLE_SLUGS.has(context.targetRoleSlug)) {
    return "invalid_target_role";
  }

  const roleSlugs = new Set(context.creatorRoleSlugs);
  const permissions = new Set(context.creatorPermissions);
  if (
    !permissions.has(PERMISSIONS.INVITE_CREATE) &&
    !permissions.has(PERMISSIONS.INVITE_MANAGE)
  ) {
    return "creator_unauthorized";
  }
  const allowedTargets = new Set(
    [...roleSlugs].flatMap((slug) => INVITATION_ROLE_TIERS[slug] ?? []),
  );
  if (!allowedTargets.has(context.targetRoleSlug)) return "creator_unauthorized";

  const isModOrAbove = roleSlugs.has("super_admin") || roleSlugs.has("moderator");
  const isLeaderInvitation = context.targetRoleSlug === "group_leader";
  const isMemberInvitation = context.targetRoleSlug === "group_member";

  if (isLeaderInvitation) {
    const validLeaderMode =
      (context.groupOnboardingMode === "CREATE_NEW_GROUP" && !context.groupId) ||
      (context.groupOnboardingMode === "EXISTING_GROUP" && Boolean(context.groupId));
    if (!validLeaderMode) return "invalid_group_mode";
  } else if (isMemberInvitation) {
    if (context.groupOnboardingMode !== "NONE" || !context.groupId) {
      return "invalid_group_mode";
    }
  } else if (
    context.groupOnboardingMode !== "NONE" ||
    context.groupId ||
    context.factionId
  ) {
    return "invalid_group_mode";
  }

  if (context.groupOnboardingMode === "CREATE_NEW_GROUP") {
    if (!isModOrAbove || !permissions.has(PERMISSIONS.GROUP_CREATE)) {
      return "creator_unauthorized";
    }
    if (context.factionId && context.factionIsActive !== true) return "faction_inactive";
  }

  if (context.groupId) {
    if (!context.group?.isActive) return "group_inactive";
    if (context.group.factionId !== context.factionId) return "invalid_group_mode";
    if (!isModOrAbove && !context.group.creatorIsLeader) return "group_unauthorized";
  }

  // Un chef ne peut attribuer que le grade initial. Une rétrogradation de
  // l'inviteur neutralise donc également ses anciennes invitations surclassées.
  if (
    !isModOrAbove &&
    (!context.lowestPlayerLevelId || context.playerLevelId !== context.lowestPlayerLevelId)
  ) {
    return "creator_unauthorized";
  }

  return null;
}

export type ConsumableInvitation = Pick<
  Invitation,
  | "id"
  | "roleId"
  | "factionId"
  | "groupId"
  | "playerLevelId"
  | "groupOnboardingMode"
  | "restrictedDiscordId"
> & {
  playerLevelId: string;
  targetRoleSlug: string;
};

export type InvitationConsumptionCheck =
  | { valid: true; invitation: ConsumableInvitation }
  | { valid: false; reason: InvitationConsumptionFailure };

/**
 * Revalide un fil dans LA transaction qui va créer le compte. Une invitation
 * dont l'autorité a disparu est révoquée, et une invitation expirée est
 * matérialisée EXPIRED : un ancien écran « valide » ne suffit jamais.
 */
export async function checkInvitationForConsumption(
  tx: Prisma.TransactionClient,
  invitationId: string,
  discordId: string,
  now = new Date(),
): Promise<InvitationConsumptionCheck> {
  const invitation = await tx.invitation.findUnique({
    where: { id: invitationId },
    include: {
      role: { select: { slug: true } },
      playerLevel: { select: { id: true } },
      faction: { select: { isActive: true } },
      group: { select: { isActive: true, factionId: true } },
      createdBy: {
        select: {
          status: true,
          roles: {
            select: {
              role: {
                select: {
                  slug: true,
                  permissions: {
                    select: { permission: { select: { key: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!invitation) return { valid: false, reason: "invalid" };
  if (invitation.status === "REVOKED") return { valid: false, reason: "revoked" };
  if (invitation.status === "USED" || invitation.usedById) {
    return { valid: false, reason: "used" };
  }
  if (invitation.status === "EXPIRED" || invitation.expiresAt <= now) {
    await tx.invitation.updateMany({
      where: { id: invitation.id, status: "ACTIVE", usedById: null },
      data: { status: "EXPIRED" },
    });
    return { valid: false, reason: "expired" };
  }
  if (
    invitation.restrictedDiscordId &&
    invitation.restrictedDiscordId !== discordId
  ) {
    return { valid: false, reason: "discord_id_mismatch" };
  }

  const creatorMembership = invitation.groupId
    ? await tx.groupMember.findUnique({
        where: {
          groupId_userId: {
            groupId: invitation.groupId,
            userId: invitation.createdById,
          },
        },
        select: { isLeader: true },
      })
    : null;
  const lowestPlayerLevel = await tx.playerLevel.findFirst({
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const creatorRoleSlugs = invitation.createdBy.roles.map(({ role }) => role.slug);
  const creatorPermissions = invitation.createdBy.roles.flatMap(({ role }) =>
    role.permissions.map(({ permission }) => permission.key),
  );
  const authorityFailure = getInvitationAuthorityFailure({
    creatorStatus: invitation.createdBy.status,
    creatorRoleSlugs,
    creatorPermissions,
    targetRoleSlug: invitation.role?.slug ?? null,
    groupOnboardingMode: invitation.groupOnboardingMode,
    groupId: invitation.groupId,
    factionId: invitation.factionId,
    playerLevelId: invitation.playerLevelId,
    playerLevelExists: Boolean(invitation.playerLevel),
    lowestPlayerLevelId: lowestPlayerLevel?.id ?? null,
    group: invitation.group
      ? {
          isActive: invitation.group.isActive,
          factionId: invitation.group.factionId,
          creatorIsLeader: creatorMembership?.isLeader === true,
        }
      : null,
    factionIsActive: invitation.faction?.isActive ?? null,
  });

  if (authorityFailure) {
    await tx.invitation.updateMany({
      where: { id: invitation.id, status: "ACTIVE", usedById: null },
      data: { status: "REVOKED", revokedAt: now },
    });
    return { valid: false, reason: authorityFailure };
  }

  return {
    valid: true,
    invitation: {
      id: invitation.id,
      roleId: invitation.roleId,
      factionId: invitation.factionId,
      groupId: invitation.groupId,
      playerLevelId: invitation.playerLevelId!,
      groupOnboardingMode: invitation.groupOnboardingMode,
      restrictedDiscordId: invitation.restrictedDiscordId,
      targetRoleSlug: invitation.role!.slug,
    },
  };
}

/**
 * Vérifie un jeton d'invitation sans le consommer.
 * Les raisons d'échec restent internes : l'interface affiche toujours
 * un message générique pour ne rien révéler.
 */
export async function checkInvitation(token: string): Promise<InvitationCheck> {
  if (!token || token.length < 20) return { valid: false, reason: "invalid" };
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });
  if (!invitation) return { valid: false, reason: "invalid" };
  if (invitation.status === "REVOKED") return { valid: false, reason: "revoked" };
  if (invitation.status === "USED" || invitation.usedById)
    return { valid: false, reason: "used" };
  if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date())
    return { valid: false, reason: "expired" };
  return { valid: true, invitation };
}

/**
 * Consomme une invitation pour un utilisateur donné, de façon atomique :
 * la contrainte d'unicité sur usedById + la clause WHERE status=ACTIVE
 * empêchent toute double utilisation, même en cas de requêtes concurrentes.
 */
export async function consumeInvitation(
  invitationId: string,
  userId: string,
): Promise<boolean> {
  const consumedAt = new Date();
  const result = await prisma.invitation.updateMany({
    where: {
      id: invitationId,
      status: "ACTIVE",
      usedById: null,
      expiresAt: { gt: consumedAt },
    },
    data: { status: "USED", usedById: userId, usedAt: consumedAt },
  });
  return result.count === 1;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}
