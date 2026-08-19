/**
 * Qui peut voir, qui peut modifier un dossier ninja.
 *
 * C'est le SEUL endroit qui tranche. Avant, la règle vivait dans
 * `apps/web/server/profiles/access.ts`, était réécrite dans la route du
 * portrait, et le droit de modifier était un `permissions.has(PROFILE_MANAGE)`
 * recopié une dizaine de fois : chaque copie était une occasion de diverger,
 * et une route nouvelle pouvait oublier de vérifier. Ici la décision est pure
 * (aucune requête, aucune date) : elle se teste, et tout appelant — page,
 * action, route API — la reçoit toute faite.
 *
 * Trois notions, dans l'ordre :
 *
 *  1. **Voir** — modération, ou groupe détenteur d'un octroi actif. L'octroi
 *     appartient au GROUPE, jamais à la personne : un membre qui quitte son
 *     groupe perd l'accès à l'instant, un nouveau membre l'obtient.
 *  2. **Modifier** — modération, ou groupe CRÉATEUR du dossier. Acheter un
 *     dossier n'a jamais donné le droit d'en réécrire la source : un acheteur
 *     lit, et contribue par le canal des renseignements proposés.
 *  3. **Administrer** — supprimer, fusionner, archiver, notes internes :
 *     modération seule. Ce sont des actes sur le dossier lui-même, pas sur
 *     ce qu'il contient.
 */

import { PERMISSIONS } from "./permissions";

// ── Origine d'un accès ──────────────────────────────────────────

/**
 * D'où vient un octroi. Un lecteur ne doit jamais se demander POURQUOI il voit
 * un dossier ; et la modération doit pouvoir distinguer un accès payé d'un
 * accès gagné au prix du sang.
 */
export const GRANT_SOURCES = [
  "CREATED_BY_GROUP",
  "PURCHASED",
  "MODERATOR_GRANTED",
  "MISSION_GRANTED",
] as const;
export type GrantSource = (typeof GRANT_SOURCES)[number];

export const GRANT_SOURCE_LABELS: Record<GrantSource, string> = {
  CREATED_BY_GROUP: "Créé par votre groupe",
  PURCHASED: "Dossier acquis",
  MODERATOR_GRANTED: "Accès accordé",
  MISSION_GRANTED: "Gagné en mission",
};

// ── Ce que la règle a besoin de savoir ──────────────────────────

export interface ProfileAccessViewer {
  userId: string;
  permissions: ReadonlySet<string>;
  /** Groupes ACTIFS dont le lecteur est membre — l'appelant filtre isActive */
  groupIds: ReadonlySet<string>;
}

export interface ProfileAccessGrantLike {
  groupId: string;
  sourceType: GrantSource;
  /** null = actif. Une révocation ferme la porte, quelle que soit la source */
  revokedAt: Date | string | null;
}

export interface ProfileAccessTarget {
  id: string;
  /** Groupe qui a ouvert le dossier — null pour l'existant antérieur à la notion */
  createdByGroupId: string | null;
  /** Octrois portés par le dossier, actifs ou non */
  grants: readonly ProfileAccessGrantLike[];
  archivedAt?: Date | string | null;
}

// ── Décision ────────────────────────────────────────────────────

/** Octrois actifs dont le lecteur bénéficie par l'un de ses groupes. */
export function activeGrantsFor(
  viewer: ProfileAccessViewer,
  target: ProfileAccessTarget,
): ProfileAccessGrantLike[] {
  return target.grants.filter(
    (grant) => grant.revokedAt == null && viewer.groupIds.has(grant.groupId),
  );
}

/**
 * Le lecteur peut-il lire les VALEURS de ce dossier ?
 *
 * Le prénom, le nom et le titre restent visibles de tous les authentifiés —
 * ce n'est pas cette fonction qui les gouverne, mais le sérialiseur, qui les
 * traite comme publics par règle du produit.
 */
export function canViewCharacterProfile(
  viewer: ProfileAccessViewer,
  target: ProfileAccessTarget,
): boolean {
  if (viewer.permissions.has(PERMISSIONS.PROFILE_INTEL_VIEW)) return true;
  // Le groupe créateur voit toujours son dossier, même si l'octroi
  // CREATED_BY_GROUP manquait (données antérieures au backfill).
  if (target.createdByGroupId && viewer.groupIds.has(target.createdByGroupId)) return true;
  return activeGrantsFor(viewer, target).length > 0;
}

/**
 * Pourquoi le lecteur voit-il ce dossier ? Retourne la source la plus forte,
 * dans un ordre qui reflète ce que le lecteur veut savoir : « c'est le nôtre »
 * prime sur « on l'a payé », qui prime sur « on nous l'a donné ».
 * `null` s'il ne le voit pas, ou s'il le voit par sa fonction (modération).
 */
export function accessOrigin(
  viewer: ProfileAccessViewer,
  target: ProfileAccessTarget,
): GrantSource | null {
  if (target.createdByGroupId && viewer.groupIds.has(target.createdByGroupId)) {
    return "CREATED_BY_GROUP";
  }
  const sources = new Set(activeGrantsFor(viewer, target).map((g) => g.sourceType));
  for (const source of GRANT_SOURCES) {
    if (sources.has(source)) return source;
  }
  return null;
}

/**
 * Le lecteur peut-il MODIFIER le contenu du dossier — compléter un champ,
 * ajouter une technique, une relation, une image ?
 *
 * Modération, ou groupe créateur. Un groupe qui a seulement acheté le dossier
 * ne modifie pas la source : il propose des renseignements, que le groupe
 * créateur ou la modération arbitrent. Un dossier archivé ne se modifie plus.
 */
export function canEditCharacterProfile(
  viewer: ProfileAccessViewer,
  target: ProfileAccessTarget,
): boolean {
  if (target.archivedAt) return false;
  if (viewer.permissions.has(PERMISSIONS.PROFILE_MANAGE)) return true;
  return Boolean(target.createdByGroupId && viewer.groupIds.has(target.createdByGroupId));
}

/**
 * Le lecteur peut-il PROPOSER un renseignement sur ce dossier ?
 *
 * Plus large que modifier : quiconque VOIT le dossier peut y contribuer — un
 * acheteur qui découvre quelque chose en mission ne doit pas garder
 * l'information pour lui faute de droit. La proposition passe alors par la
 * file de revue ; elle ne touche pas la source directement.
 */
export function canContributeToCharacterProfile(
  viewer: ProfileAccessViewer,
  target: ProfileAccessTarget,
): boolean {
  if (target.archivedAt) return false;
  return canViewCharacterProfile(viewer, target);
}

/**
 * Actes sur le dossier lui-même — supprimer, fusionner, archiver, lire les
 * notes internes et l'historique complet des sources. Modération seule : ce
 * ne sont pas des renseignements, ce sont des décisions.
 */
export function canAdministerCharacterProfile(viewer: ProfileAccessViewer): boolean {
  return viewer.permissions.has(PERMISSIONS.PROFILE_MANAGE);
}

/**
 * Le lecteur peut-il CRÉER un dossier ?
 *
 * Tout membre d'au moins un groupe actif — pas seulement la modération. Un
 * agent qui croise un inconnu en RP doit pouvoir ouvrir sa fiche sur-le-champ,
 * pour son groupe. Sans groupe, on ne crée pas : le dossier n'aurait pas de
 * propriétaire, donc personne pour le voir ni le compléter. La modération,
 * elle, crée toujours — avec ou sans groupe.
 */
export function canCreateCharacterProfile(viewer: ProfileAccessViewer): boolean {
  if (viewer.permissions.has(PERMISSIONS.PROFILE_MANAGE)) return true;
  return viewer.groupIds.size > 0;
}
