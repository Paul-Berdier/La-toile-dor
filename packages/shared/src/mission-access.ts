import type { MissionViewLevel } from "./mission-views";

export interface MissionAccessInput {
  isModerator: boolean;
  viewerGroupIds: ReadonlySet<string>;
  viewerLedGroupIds: ReadonlySet<string>;
  isExplicitParticipant: boolean;
  assignedGroupIds: readonly string[];
  legacyAssignedGroupId?: string | null;
}

/** Résout le niveau avant toute sérialisation de champs confidentiels. */
export function resolveMissionViewLevel({
  isModerator,
  viewerGroupIds,
  viewerLedGroupIds,
  isExplicitParticipant,
  assignedGroupIds,
  legacyAssignedGroupId,
}: MissionAccessInput): MissionViewLevel {
  if (isModerator) return "moderator";

  const effectiveAssignedGroups = new Set(assignedGroupIds);
  if (legacyAssignedGroupId) effectiveAssignedGroups.add(legacyAssignedGroupId);

  if ([...effectiveAssignedGroups].some((groupId) => viewerLedGroupIds.has(groupId))) {
    return "leader";
  }
  if ([...effectiveAssignedGroups].some((groupId) => viewerGroupIds.has(groupId))) {
    return "assigned";
  }
  if (isExplicitParticipant) return "assigned";
  return "public";
}
