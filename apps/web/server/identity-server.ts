import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";
import {
  serializeUserIdentity,
  type IdentityViewer,
  type UserIdentityView,
} from "@toile/shared";
import type { CurrentUser } from "@/lib/session";

/**
 * Construit le viewer d'identité de la requête courante (permissions +
 * groupes d'appartenance), mis en cache par requête. C'est l'UNIQUE porte
 * d'entrée vers les identités réelles — ne jamais lire firstName/lastName
 * directement dans une page.
 */
export const getIdentityViewer = cache(async (current: CurrentUser): Promise<IdentityViewer> => {
  const memberships = await prisma.groupMember.findMany({
    // Une appartenance historique à un groupe désactivé ne doit jamais
    // continuer à ouvrir le prénom/nom réel d'anciens coéquipiers.
    where: { userId: current.session.userId, group: { isActive: true } },
    select: { groupId: true },
  });
  return {
    userId: current.session.userId,
    permissions: current.permissions,
    groupIds: new Set(memberships.map((m) => m.groupId)),
  };
});

/**
 * Sérialise en masse les identités des membres d'un ensemble d'utilisateurs.
 * Charge les appartenances de groupe des cibles en UNE requête.
 */
export async function serializeUsersForViewer(
  current: CurrentUser,
  userIds: string[],
): Promise<Map<string, UserIdentityView>> {
  if (userIds.length === 0) return new Map();
  const viewer = await getIdentityViewer(current);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      // Portée choisie par l'intéressé — sans elle, on retomberait en silence
      // sur la règle par défaut et le choix ne servirait à rien.
      identityVisibility: true,
      groupMemberships: {
        where: { group: { isActive: true } },
        select: { groupId: true },
      },
    },
  });
  return new Map(
    users.map((user) => [
      user.id,
      serializeUserIdentity(viewer, {
        id: user.id,
        displayName: user.displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        identityVisibility: user.identityVisibility,
        groupIds: user.groupMemberships.map((m) => m.groupId),
      }),
    ]),
  );
}
