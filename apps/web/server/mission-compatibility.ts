import { evaluateTeamEligibility } from "@toile/shared";

interface CompatibleGroupCandidate {
  members: readonly { levelOrder: number | null }[];
}

interface CompatibleMissionCriteria {
  groupSizeMin: number;
  groupSizeMax: number;
  minRecommendedLevel: { label: string; order: number } | null;
}

/**
 * Vérifie qu'au moins un groupe dirigé peut fournir une contribution conforme.
 * Seul le sous-ensemble mobilisable compte : les autres membres du groupe ne
 * font jamais dépasser l'effectif maximal de la mission. Une contribution
 * sous le minimum reste compatible puisqu'un autre groupe peut la compléter.
 */
export function hasCompatibleLedGroup(
  groups: readonly CompatibleGroupCandidate[],
  mission: CompatibleMissionCriteria,
): boolean {
  return groups.some((group) => {
    const qualifyingMembers = mission.minRecommendedLevel
      ? group.members.filter(
          (member) =>
            member.levelOrder != null &&
            member.levelOrder >= mission.minRecommendedLevel!.order,
        )
      : group.members;
    const candidateSubset = qualifyingMembers.slice(0, mission.groupSizeMax);

    return (
      candidateSubset.length > 0 &&
      !evaluateTeamEligibility({
        participantLevels: candidateSubset.map((member) => member.levelOrder),
        groupSizeMin: mission.groupSizeMin,
        groupSizeMax: mission.groupSizeMax,
        minLevel: mission.minRecommendedLevel,
      }).some((issue) => issue.blocksStrict)
    );
  });
}
