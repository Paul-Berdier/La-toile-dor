/**
 * Identité des membres de la Toile.
 *
 * RÈGLE : le prénom et le nom de famille sont CONFIDENTIELS. Leur portée est
 * choisie par l'INTÉRESSÉ (`identityVisibility`) : la modération seule, ses
 * propres groupes, ou tout membre autorisé. Deux accès ne dépendent jamais de
 * ce choix — le sien propre, et celui de la modération (permission
 * identity.view.real), qui doit pouvoir arbitrer et à qui c'est annoncé.
 *
 * Partout ailleurs, seul le pseudonyme public circule : les DTO ci-dessous
 * garantissent que les champs réels n'existent pas dans les réponses non
 * autorisées — ils ne sont pas masqués, ils sont absents.
 */

import { PERMISSIONS } from "./permissions";

// ── Normalisation du pseudonyme (unicité insensible à la casse) ──

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Akira" ou "Akira Uzumori" — jamais de placeholder pour un nom absent. */
export function formatRealName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const first = firstName?.trim() ?? "";
  const last = lastName?.trim() ?? "";
  return [first, last].filter(Boolean).join(" ");
}

// ── Contrôle central de visibilité ──

export interface IdentityViewer {
  userId: string;
  permissions: Set<string>;
  /** Groupes auxquels le viewer appartient */
  groupIds: ReadonlySet<string>;
}

/** Portées possibles, de la plus fermée à la plus ouverte. */
export const IDENTITY_VISIBILITIES = ["MODERATORS", "MY_GROUPS", "EVERYONE"] as const;
export type IdentityVisibility = (typeof IDENTITY_VISIBILITIES)[number];

export const IDENTITY_VISIBILITY_LABELS: Record<IdentityVisibility, string> = {
  MODERATORS: "La modération seule",
  MY_GROUPS: "Mes groupes et la modération",
  EVERYONE: "Tous les membres de la Toile",
};

export const IDENTITY_VISIBILITY_HINTS: Record<IdentityVisibility, string> = {
  MODERATORS:
    "Personne d'autre que les modérateurs ne verra votre prénom ni votre nom — pas même vos coéquipiers.",
  MY_GROUPS:
    "Les membres de vos propres groupes vous connaissent ; les autres ne voient que votre Titre.",
  EVERYONE:
    "N'importe quel membre autorisé pourra lire votre prénom et votre nom. Ce choix ne se reprend pas dans les mémoires.",
};

/** MY_GROUPS = règle d'origine, appliquée à défaut de choix explicite. */
export const DEFAULT_IDENTITY_VISIBILITY: IdentityVisibility = "MY_GROUPS";

export interface IdentityTarget {
  id: string;
  /** Groupes auxquels la cible appartient */
  groupIds: readonly string[];
  /** Portée choisie par la cible ; MY_GROUPS si l'information manque */
  identityVisibility?: IdentityVisibility | null;
}

/**
 * Décide si `viewer` peut lire l'identité réelle de `target`.
 *
 * À utiliser PARTOUT — ne pas répliquer cette logique dans les composants,
 * sans quoi un écran finira par appliquer une règle périmée.
 */
export function canViewRealIdentity(viewer: IdentityViewer, target: IdentityTarget): boolean {
  // Sa propre identité, toujours.
  if (viewer.userId === target.id) return true;
  // La modération, quel que soit le choix : elle doit pouvoir arbitrer, et
  // l'intéressé en est informé au moment où il choisit.
  if (viewer.permissions.has(PERMISSIONS.IDENTITY_VIEW_REAL)) return true;

  switch (target.identityVisibility ?? DEFAULT_IDENTITY_VISIBILITY) {
    case "MODERATORS":
      return false;
    case "EVERYONE":
      return true;
    default:
      return target.groupIds.some((groupId) => viewer.groupIds.has(groupId));
  }
}

// ── DTO à deux niveaux ──

export interface PublicUserView {
  id: string;
  displayName: string;
}

export interface RealUserView extends PublicUserView {
  firstName: string | null;
  lastName: string | null;
  realName: string; // pré-formaté, jamais "undefined"
}

export type UserIdentityView = PublicUserView | RealUserView;

interface UserIdentityRecord {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  groupIds: readonly string[];
  /** Omis = MY_GROUPS, la règle d'origine */
  identityVisibility?: IdentityVisibility | null;
}

/** Sérialise un utilisateur au niveau exact autorisé pour ce viewer. */
export function serializeUserIdentity(
  viewer: IdentityViewer,
  user: UserIdentityRecord,
): UserIdentityView {
  if (
    !canViewRealIdentity(viewer, {
      id: user.id,
      groupIds: user.groupIds,
      identityVisibility: user.identityVisibility,
    })
  ) {
    return { id: user.id, displayName: user.displayName };
  }
  return {
    id: user.id,
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    realName: formatRealName(user.firstName, user.lastName),
  };
}

export function isRealUserView(view: UserIdentityView): view is RealUserView {
  return "realName" in view;
}
