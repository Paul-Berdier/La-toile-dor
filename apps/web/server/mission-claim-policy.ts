/**
 * Une revendication est une action de chef de groupe concret, pas un pouvoir
 * de modération. Le rôle RBAC peut être momentanément désynchronisé de
 * GroupMember.isLeader : l'appartenance active reste donc l'autorité métier.
 */
export const CLAIMABLE_MISSION_STATUSES = ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED"] as const;

export type ClaimableMissionStatus = (typeof CLAIMABLE_MISSION_STATUSES)[number];

export function isClaimableMissionStatus(status: string): status is ClaimableMissionStatus {
  return (CLAIMABLE_MISSION_STATUSES as readonly string[]).includes(status);
}

export function canActiveLeaderClaim(status: string, hasClaimableLedGroup: boolean): boolean {
  return hasClaimableLedGroup && isClaimableMissionStatus(status);
}
