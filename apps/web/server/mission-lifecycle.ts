import type { MissionStatus } from "@toile/database";

/**
 * Transitions manuelles autorisées. L'attribution et le démarrage utilisent
 * une action séparée afin de toujours valider l'équipe finale.
 */
const ALLOWED_MANUAL_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  DRAFT: [],
  AVAILABLE: ["CANCELLED"],
  CLAIM_PENDING: ["AVAILABLE", "CANCELLED"],
  ASSIGNED: ["AVAILABLE", "CANCELLED"],
  IN_PROGRESS: ["AVAILABLE", "COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["AVAILABLE", "CANCELLED"],
  CANCELLED: ["AVAILABLE"],
  EXPIRED: ["AVAILABLE", "CANCELLED"],
  ARCHIVED: [],
};

export function canMoveMissionManually(
  fromStatus: MissionStatus,
  toStatus: MissionStatus,
): boolean {
  return ALLOWED_MANUAL_TRANSITIONS[fromStatus].includes(toStatus);
}

/** Le consentement public ne couvre jamais des agents ajoutés après la claim. */
export function canReusePublicRosterConsent(
  publicRoster: boolean,
  claimedParticipantIds: readonly string[],
  assignedParticipantIds: readonly string[],
): boolean {
  if (!publicRoster || claimedParticipantIds.length !== assignedParticipantIds.length) {
    return false;
  }
  const claimed = new Set(claimedParticipantIds);
  return claimed.size === claimedParticipantIds.length &&
    assignedParticipantIds.every((userId) => claimed.has(userId));
}
