import "server-only";

import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import type { CurrentUser } from "@/lib/session";

/**
 * Vérifie qu'une provenance mission appartient réellement au groupe qui
 * possède le dossier. Sans cette garde, un utilisateur membre de A et B peut
 * injecter dans B les renseignements secrets appris pendant une mission de A.
 */
export async function canUseSourceMission(
  current: CurrentUser,
  sourceMissionId: string | null | undefined,
  ownerGroupId: string | null,
): Promise<boolean> {
  if (!sourceMissionId) return true;
  const mission = await prisma.mission.findUnique({
    where: { id: sourceMissionId },
    select: {
      assignedGroupId: true,
      assignments: {
        where: { active: true },
        select: { groupId: true },
      },
    },
  });
  if (!mission) return false;
  const isMissionModerator =
    current.permissions.has(PERMISSIONS.MISSION_VIEW_ALL) &&
    current.permissions.has(PERMISSIONS.MISSION_VIEW_CONFIDENTIAL);
  if (isMissionModerator) return true;
  if (!ownerGroupId) return false;
  if (mission.assignments.length > 0) {
    return mission.assignments.some((assignment) => assignment.groupId === ownerGroupId);
  }
  return mission.assignedGroupId === ownerGroupId;
}
