export interface AssignmentRosterVisibilityInput {
  isModerator: boolean;
  viewerGroupIds: ReadonlySet<string>;
  assignmentGroupId: string;
  publicRoster: boolean;
}

/**
 * Une équipe est visible par la modération, par les membres de son propre
 * groupe, ou lorsque son chef a explicitement rendu le roster public.
 */
export function canViewAssignmentRoster({
  isModerator,
  viewerGroupIds,
  assignmentGroupId,
  publicRoster,
}: AssignmentRosterVisibilityInput): boolean {
  return isModerator || viewerGroupIds.has(assignmentGroupId) || publicRoster;
}

/** La vue publique ne doit contenir que le pseudonyme/titre déjà public. */
export function toPublicRosterAgent(user: { displayName: string }): { displayName: string } {
  return { displayName: user.displayName };
}
