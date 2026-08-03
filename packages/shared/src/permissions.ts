/**
 * Clés de permission atomiques.
 * Toute vérification a lieu CÔTÉ SERVEUR : masquer un bouton n'est pas une sécurité.
 */
export const PERMISSIONS = {
  // Missions
  MISSION_CREATE: "mission.create",
  MISSION_UPDATE: "mission.update",
  MISSION_CANCEL: "mission.cancel",
  MISSION_MOVE: "mission.move",
  MISSION_ASSIGN: "mission.assign",
  MISSION_VIEW_ALL: "mission.view.all",
  MISSION_VIEW_CONFIDENTIAL: "mission.view.confidential", // + accès par attribution
  MISSION_CLAIM: "mission.claim",
  MISSION_REPORT_SUBMIT: "mission.report.submit",
  // Revendications
  CLAIM_REVIEW: "claim.review",
  // Points et classement
  POINTS_ADJUST: "points.adjust",
  LEADERBOARD_VIEW: "leaderboard.view",
  // Groupes (au sein de sa faction)
  GROUP_MANAGE: "group.manage",
  // Invitations
  // invite.create : tendre un fil selon sa position dans la hiérarchie
  // (modérateur → chefs/agents ; chef → agents de ses groupes).
  // invite.manage : voir et révoquer TOUTES les invitations (Tisseur d'Or).
  INVITE_CREATE: "invite.create",
  // Administration
  INVITE_MANAGE: "invite.manage",
  FACTION_MANAGE: "faction.manage",
  USER_MANAGE: "user.manage",
  MODERATOR_MANAGE: "moderator.manage",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_READ: "audit.read",
  ACCESS_REVOKE: "access.revoke",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_SLUGS = {
  SUPER_ADMIN: "super_admin",
  MODERATOR: "moderator",
  FACTION_LEADER: "faction_leader",
  FACTION_MEMBER: "faction_member",
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

const P = PERMISSIONS;

/** Attribution par défaut des permissions aux rôles système (seed + référence). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleSlug, PermissionKey[]> = {
  super_admin: Object.values(P),
  moderator: [
    P.INVITE_CREATE,
    P.MISSION_CREATE,
    P.MISSION_UPDATE,
    P.MISSION_CANCEL,
    P.MISSION_MOVE,
    P.MISSION_ASSIGN,
    P.MISSION_VIEW_ALL,
    P.MISSION_VIEW_CONFIDENTIAL,
    P.CLAIM_REVIEW,
    P.POINTS_ADJUST,
    P.LEADERBOARD_VIEW,
    P.AUDIT_READ, // journaux liés aux missions
  ],
  faction_leader: [
    P.INVITE_CREATE,
    P.MISSION_CLAIM,
    P.MISSION_REPORT_SUBMIT,
    P.GROUP_MANAGE,
    P.LEADERBOARD_VIEW,
  ],
  faction_member: [P.LEADERBOARD_VIEW],
};
