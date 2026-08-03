/**
 * Identité des membres de la Toile.
 *
 * RÈGLE : le prénom et le nom de famille sont CONFIDENTIELS. Ils ne sont
 * visibles que par la modération (permission identity.view.real), par les
 * membres du MÊME groupe, et par l'intéressé lui-même. Partout ailleurs,
 * seul le pseudonyme public circule — les DTO ci-dessous garantissent que
 * les champs réels n'existent pas dans les réponses non autorisées.
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

export interface IdentityTarget {
  id: string;
  /** Groupes auxquels la cible appartient */
  groupIds: readonly string[];
}

/**
 * Vrai uniquement si : modération (identity.view.real), même groupe,
 * ou consultation de sa propre identité. À utiliser PARTOUT — ne pas
 * répliquer cette logique dans les composants.
 */
export function canViewRealIdentity(viewer: IdentityViewer, target: IdentityTarget): boolean {
  if (viewer.userId === target.id) return true;
  if (viewer.permissions.has(PERMISSIONS.IDENTITY_VIEW_REAL)) return true;
  return target.groupIds.some((groupId) => viewer.groupIds.has(groupId));
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
}

/** Sérialise un utilisateur au niveau exact autorisé pour ce viewer. */
export function serializeUserIdentity(
  viewer: IdentityViewer,
  user: UserIdentityRecord,
): UserIdentityView {
  if (!canViewRealIdentity(viewer, { id: user.id, groupIds: user.groupIds })) {
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
