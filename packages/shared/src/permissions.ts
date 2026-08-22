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
  // Groupes (sans autorité dérivée de la faction)
  GROUP_MANAGE: "group.manage",
  // Créer un groupe (modération ; les chefs ne créent que via une invitation
  // portant explicitement le mode CREATE_NEW_GROUP)
  GROUP_CREATE: "group.create",
  // Modifier n'importe quel groupe (modération) — un chef ne modifie que le sien
  GROUP_EDIT_ANY: "group.edit.any",
  // Identité réelle (prénom/nom) : modération uniquement — les membres d'un
  // même groupe passent par la règle de co-appartenance, pas par ce droit
  IDENTITY_VIEW_REAL: "identity.view.real",
  // Dossiers de renseignement (profils de personnages)
  // profile.manage : créer/modifier les dossiers (modération)
  PROFILE_MANAGE: "profile.manage",
  // profile.intel.view : voir toutes les valeurs, sources, historique
  PROFILE_INTEL_VIEW: "profile.intel.view",
  // profile.purchase.review : traiter les demandes d'achat, révoquer les accès
  PROFILE_PURCHASE_REVIEW: "profile.purchase.review",
  // profile.request.create : demander l'achat pour SON groupe (chefs)
  PROFILE_REQUEST_CREATE: "profile.request.create",
  // Référentiels et fusion : super-modérateurs
  PROFILE_REFERENCE_MANAGE: "profile.reference.manage",
  PROFILE_MERGE: "profile.merge",
  // Invitations
  // invite.create : tendre un fil selon sa position dans la hiérarchie
  // (modérateur → chefs/agents ; chef → agents de ses groupes).
  // invite.manage : voir et révoquer TOUTES les invitations (Tisseur d'Or).
  INVITE_CREATE: "invite.create",
  // Administration
  INVITE_MANAGE: "invite.manage",
  FACTION_MANAGE: "faction.manage",
  USER_MANAGE: "user.manage",
  // Examiner les demandes d'évolution/correction du grade RP. Cette
  // permission reste distincte de user.manage, beaucoup plus large.
  USER_LEVEL_MANAGE: "user.level.manage",
  MODERATOR_MANAGE: "moderator.manage",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_READ: "audit.read",
  ACCESS_REVOKE: "access.revoke",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_SLUGS = {
  SUPER_ADMIN: "super_admin",
  MODERATOR: "moderator",
  GROUP_LEADER: "group_leader",
  GROUP_MEMBER: "group_member",
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

const P = PERMISSIONS;

/** Attribution par défaut des permissions aux rôles système (seed + référence). */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleSlug, PermissionKey[]> = {
  super_admin: Object.values(P),
  moderator: [
    P.INVITE_CREATE,
    P.GROUP_CREATE,
    P.GROUP_EDIT_ANY,
    P.IDENTITY_VIEW_REAL,
    P.PROFILE_MANAGE,
    P.PROFILE_INTEL_VIEW,
    P.PROFILE_PURCHASE_REVIEW,
    P.MISSION_CREATE,
    P.MISSION_UPDATE,
    P.MISSION_CANCEL,
    P.MISSION_MOVE,
    P.MISSION_ASSIGN,
    P.MISSION_VIEW_ALL,
    P.MISSION_VIEW_CONFIDENTIAL,
    P.CLAIM_REVIEW,
    P.USER_LEVEL_MANAGE,
    P.POINTS_ADJUST,
    P.LEADERBOARD_VIEW,
    P.AUDIT_READ, // journaux liés aux missions
  ],
  group_leader: [
    P.INVITE_CREATE,
    P.PROFILE_REQUEST_CREATE,
    P.MISSION_CLAIM,
    P.MISSION_REPORT_SUBMIT,
    P.GROUP_MANAGE,
    P.LEADERBOARD_VIEW,
  ],
  group_member: [P.LEADERBOARD_VIEW],
};
