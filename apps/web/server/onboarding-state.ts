import "server-only";
import { prisma } from "@toile/database";

/**
 * État d'onboarding d'un utilisateur :
 * - identité à compléter (prénom + case de confidentialité) ;
 * - éventuelle étape de création de groupe (invitation CREATE_NEW_GROUP,
 *   une seule création possible par invitation).
 */
export async function getOnboardingState(userId: string) {
  const [user, invitation, ledGroups] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        displayName: true,
        privacyAcknowledgedAt: true,
        profileCompleted: true,
      },
    }),
    prisma.invitation.findUnique({
      where: { usedById: userId },
      select: { groupOnboardingMode: true, factionId: true },
    }),
    prisma.groupMember.count({ where: { userId, isLeader: true } }),
  ]);

  const identityDone = Boolean(user.firstName && user.privacyAcknowledgedAt);
  const groupStepNeeded =
    invitation?.groupOnboardingMode === "CREATE_NEW_GROUP" && ledGroups === 0;

  return { user, invitation, identityDone, groupStepNeeded };
}

export async function finalizeOnboardingIfComplete(userId: string): Promise<void> {
  const state = await getOnboardingState(userId);
  if (state.identityDone && !state.groupStepNeeded) {
    await prisma.user.update({ where: { id: userId }, data: { profileCompleted: true } });
  }
}
