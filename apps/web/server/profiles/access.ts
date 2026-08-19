import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";
import {
  PERMISSIONS,
  canViewCharacterProfile,
  canEditCharacterProfile,
  canContributeToCharacterProfile,
  canAdministerCharacterProfile,
  canCreateCharacterProfile,
  accessOrigin,
  type ProfileAccessViewer,
  type ProfileAccessTarget,
  type GrantSource,
} from "@toile/shared";
import type { CurrentUser } from "@/lib/session";

/**
 * Contexte d'accès aux dossiers de renseignement.
 *
 * La DÉCISION vit dans `packages/shared/src/profile-access.ts` — pure et
 * testée. Ce fichier ne fait que la nourrir : il charge une fois par requête
 * ce qu'elle a besoin de savoir sur le lecteur, et l'expose sous la forme que
 * la règle attend. Aucune route, action ou page ne doit réimplémenter la
 * décision : elle appelle `decideAccess`.
 *
 * Seuls les groupes ACTIFS comptent : un groupe désactivé n'emporte plus ses
 * dossiers avec lui — c'est le sens même de la désactivation.
 */
export const getProfileViewer = cache(async (current: CurrentUser) => {
  const canViewAll = current.permissions.has(PERMISSIONS.PROFILE_INTEL_VIEW);
  const canManage = current.permissions.has(PERMISSIONS.PROFILE_MANAGE);
  const canReview = current.permissions.has(PERMISSIONS.PROFILE_PURCHASE_REVIEW);
  const canRequest = current.permissions.has(PERMISSIONS.PROFILE_REQUEST_CREATE);
  const canManageReferences = current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE);
  const canMerge = current.permissions.has(PERMISSIONS.PROFILE_MERGE);

  const memberships = await prisma.groupMember.findMany({
    where: { userId: current.session.userId, group: { isActive: true } },
    select: { groupId: true, isLeader: true, group: { select: { name: true } } },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const ledGroupIds = memberships.filter((m) => m.isLeader).map((m) => m.groupId);
  const groupNames = new Map(memberships.map((m) => [m.groupId, m.group.name]));

  // Dossiers accessibles par les groupes du lecteur — pour la LISTE, où l'on
  // ne peut pas charger les octrois de chaque dossier un par un.
  const grantedProfileIds = new Set<string>();
  const createdProfileIds = new Set<string>();
  if (!canViewAll && groupIds.length > 0) {
    const [grants, created] = await Promise.all([
      prisma.profileAccessGrant.findMany({
        where: { groupId: { in: groupIds }, revokedAt: null },
        select: { profileId: true },
      }),
      prisma.characterProfile.findMany({
        where: { createdByGroupId: { in: groupIds }, archivedAt: null },
        select: { id: true },
      }),
    ]);
    for (const grant of grants) grantedProfileIds.add(grant.profileId);
    for (const profile of created) createdProfileIds.add(profile.id);
  }

  const accessViewer: ProfileAccessViewer = {
    userId: current.session.userId,
    permissions: current.permissions,
    groupIds: new Set(groupIds),
  };

  return {
    userId: current.session.userId,
    canViewAll,
    canManage,
    canReview,
    canRequest,
    canManageReferences,
    canMerge,
    /** Tout membre d'un groupe actif — ou la modération */
    canCreate: canCreateCharacterProfile(accessViewer),
    groupIds,
    ledGroupIds,
    groupNames,
    grantedProfileIds,
    createdProfileIds,
    /** Le lecteur sous la forme attendue par la règle partagée */
    accessViewer,
  };
});

export type ProfileViewer = Awaited<ReturnType<typeof getProfileViewer>>;

/** Ce qu'une décision d'accès dit d'un dossier pour un lecteur donné. */
export interface AccessDecision {
  canView: boolean;
  canEdit: boolean;
  canContribute: boolean;
  canAdminister: boolean;
  /** Pourquoi le lecteur voit — null s'il ne voit pas, ou voit par fonction */
  origin: GrantSource | null;
  /** Le dossier appartient à l'un de ses groupes */
  ownedByMyGroup: boolean;
}

/**
 * Décide, pour UN dossier chargé avec ses octrois, ce que le lecteur peut
 * faire. Toute la logique est dans `packages/shared` ; ceci n'est qu'un
 * adaptateur.
 */
export function decideAccess(viewer: ProfileViewer, target: ProfileAccessTarget): AccessDecision {
  const v = viewer.accessViewer;
  return {
    canView: canViewCharacterProfile(v, target),
    canEdit: canEditCharacterProfile(v, target),
    canContribute: canContributeToCharacterProfile(v, target),
    canAdminister: canAdministerCharacterProfile(v),
    origin: accessOrigin(v, target),
    ownedByMyGroup: Boolean(target.createdByGroupId && v.groupIds.has(target.createdByGroupId)),
  };
}

/**
 * Même décision, mais au nom d'UN groupe précis du lecteur.
 *
 * Indispensable aux actions multi-groupes : le fait que Paul voie ou modifie
 * un dossier grâce au groupe A ne permet pas d'attribuer la même action au
 * groupe B. Les permissions de modération restent, elles, applicables.
 */
export function decideAccessForGroup(
  viewer: ProfileViewer,
  target: ProfileAccessTarget,
  groupId: string,
): AccessDecision {
  return decideAccess(
    {
      ...viewer,
      accessViewer: {
        ...viewer.accessViewer,
        groupIds: new Set([groupId]),
      },
    },
    target,
  );
}

/**
 * Le lecteur peut-il voir les valeurs de CE dossier — version LISTE, à partir
 * des ensembles préchargés, quand on n'a pas les octrois sous la main.
 * Cohérente avec `canViewCharacterProfile` : modération, groupe créateur, ou
 * octroi actif de l'un de ses groupes.
 */
export function canViewProfileValues(viewer: ProfileViewer, profileId: string): boolean {
  return (
    viewer.canViewAll ||
    viewer.createdProfileIds.has(profileId) ||
    viewer.grantedProfileIds.has(profileId)
  );
}

/** Sélection Prisma minimale pour nourrir `decideAccess`. */
export const accessTargetSelect = {
  id: true,
  createdByGroupId: true,
  archivedAt: true,
  accessGrants: { select: { groupId: true, sourceType: true, revokedAt: true } },
} as const;

/** Convertit un dossier chargé avec `accessTargetSelect` en cible de décision. */
export function toAccessTarget(profile: {
  id: string;
  createdByGroupId: string | null;
  archivedAt: Date | null;
  accessGrants: { groupId: string; sourceType: GrantSource; revokedAt: Date | null }[];
}): ProfileAccessTarget {
  return {
    id: profile.id,
    createdByGroupId: profile.createdByGroupId,
    archivedAt: profile.archivedAt,
    grants: profile.accessGrants,
  };
}
