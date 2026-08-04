import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import type { CurrentUser } from "@/lib/session";

/**
 * Contexte d'accès aux dossiers de renseignement.
 * - `canViewAll` : modération (profile.intel.view) — toutes les valeurs ;
 * - `grantedProfileIds` : dossiers achetés par les groupes ACTUELS de
 *   l'utilisateur (un membre retiré d'un groupe perd l'accès immédiatement,
 *   un nouveau membre l'obtient tant que l'octroi du groupe est actif).
 */
export const getProfileViewer = cache(async (current: CurrentUser) => {
  const canViewAll = current.permissions.has(PERMISSIONS.PROFILE_INTEL_VIEW);
  const canManage = current.permissions.has(PERMISSIONS.PROFILE_MANAGE);
  const canReview = current.permissions.has(PERMISSIONS.PROFILE_PURCHASE_REVIEW);
  const canRequest = current.permissions.has(PERMISSIONS.PROFILE_REQUEST_CREATE);
  const canManageReferences = current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE);
  const canMerge = current.permissions.has(PERMISSIONS.PROFILE_MERGE);

  const memberships = await prisma.groupMember.findMany({
    where: { userId: current.session.userId },
    select: { groupId: true, isLeader: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const ledGroupIds = memberships.filter((m) => m.isLeader).map((m) => m.groupId);

  const grantedProfileIds = new Set<string>();
  if (!canViewAll && groupIds.length > 0) {
    const grants = await prisma.profileAccessGrant.findMany({
      where: { groupId: { in: groupIds }, revokedAt: null },
      select: { profileId: true },
    });
    for (const grant of grants) grantedProfileIds.add(grant.profileId);
  }

  return {
    userId: current.session.userId,
    canViewAll,
    canManage,
    canReview,
    canRequest,
    canManageReferences,
    canMerge,
    groupIds,
    ledGroupIds,
    grantedProfileIds,
  };
});

export type ProfileViewer = Awaited<ReturnType<typeof getProfileViewer>>;

/** Le lecteur peut-il voir les valeurs de CE dossier ? */
export function canViewProfileValues(viewer: ProfileViewer, profileId: string): boolean {
  return viewer.canViewAll || viewer.grantedProfileIds.has(profileId);
}
