const EXPIRABLE_MISSION_STATUSES = new Set([
  "AVAILABLE",
  "CLAIM_PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
]);

export interface MissionExpirationState {
  status: string;
  expiresAt: Date | null;
  timerSuspendedAt: Date | null;
}

/**
 * Décision pure utilisée avant l'écriture autoritative d'expiration.
 *
 * Une échéance atteinte ne suffit pas : la mission doit encore appartenir à
 * un état actif et son minuteur ne doit pas avoir été suspendu entre-temps.
 */
export function isMissionEligibleForExpiration(
  mission: MissionExpirationState,
  now: Date,
): boolean {
  return (
    EXPIRABLE_MISSION_STATUSES.has(mission.status) &&
    mission.timerSuspendedAt === null &&
    mission.expiresAt !== null &&
    mission.expiresAt.getTime() <= now.getTime()
  );
}
