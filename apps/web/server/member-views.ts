export interface MemberGroupRecord {
  groupId: string;
  isLeader: boolean;
  group: {
    id: string;
    name: string;
    faction: { id: string; name: string } | null;
  };
}

export interface MemberMissionStatRow {
  userId: string;
  pointsAwarded: number;
  ryoAwarded: number;
  mission: { status: "COMPLETED" | "FAILED" };
}

export interface MemberMissionStats {
  resolved: number;
  completed: number;
  failed: number;
  points: number;
  ryos: number;
}

export const EMPTY_MEMBER_MISSION_STATS: MemberMissionStats = {
  resolved: 0,
  completed: 0,
  failed: 0,
  points: 0,
  ryos: 0,
};

/**
 * Un annuaire de membres ne doit pas devenir un moyen de reconstruire les
 * rosters privés : hors modération et fiche personnelle, seules les
 * appartenances partagées avec le lecteur sont servies.
 */
export function visibleMemberGroups(input: {
  viewerUserId: string;
  viewerGroupIds: ReadonlySet<string>;
  canViewAllGroups: boolean;
  targetUserId: string;
  groups: readonly MemberGroupRecord[];
}): MemberGroupRecord[] {
  if (input.canViewAllGroups || input.viewerUserId === input.targetUserId) {
    return [...input.groups];
  }
  return input.groups.filter((membership) => input.viewerGroupIds.has(membership.groupId));
}

/** Agrège uniquement les missions résolues : aucune mission active ou secrète ne fuit. */
export function aggregateMemberMissionStats(
  rows: readonly MemberMissionStatRow[],
): Map<string, MemberMissionStats> {
  const result = new Map<string, MemberMissionStats>();
  for (const row of rows) {
    const current = result.get(row.userId) ?? { ...EMPTY_MEMBER_MISSION_STATS };
    current.resolved += 1;
    if (row.mission.status === "COMPLETED") current.completed += 1;
    else current.failed += 1;
    current.points += row.pointsAwarded;
    current.ryos += row.ryoAwarded;
    result.set(row.userId, current);
  }
  return result;
}
