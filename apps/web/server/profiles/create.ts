import "server-only";
import type { Prisma } from "@toile/database";
import { formatDossierTitle, formatProfileCode, normalizeRefLabel } from "@toile/shared";

/**
 * Création d'un dossier avec code PRF-XXXXXX dérivé du compteur — LA voie
 * unique d'insertion d'un CharacterProfile. Appelée par la création rapide,
 * les relations « nouveau proche », et le rapport de fin de mission (ninja
 * découvert). Toujours dans une transaction fournie par l'appelant.
 */
export async function createProfileRecord(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.CharacterProfileUncheckedCreateInput, "code">,
) {
  const created = await tx.characterProfile.create({
    data: { ...data, code: `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
  });
  return tx.characterProfile.update({
    where: { id: created.id },
    data: { code: formatProfileCode(created.codeNumber) },
  });
}

/**
 * Ouvre un dossier minimal POUR un groupe (propriétaire, octroi
 * CREATED_BY_GROUP) — ou sans groupe pour la modération. Titre généré s'il
 * manque. Ne vérifie pas les doublons : c'est à l'appelant de le faire
 * avant, s'il veut bloquer.
 */
export async function createOwnedProfile(
  tx: Prisma.TransactionClient,
  input: {
    firstName: string;
    lastName?: string | null;
    title?: string | null;
    ownerGroupId: string | null;
    actorId: string;
    sourceMissionId?: string | null;
  },
) {
  const firstName = input.firstName.trim();
  const lastName = input.lastName?.trim() || null;
  const profile = await createProfileRecord(tx, {
    characterFirstName: firstName,
    firstNameNorm: normalizeRefLabel(firstName),
    characterLastName: lastName,
    title: input.title?.trim() || formatDossierTitle(firstName, lastName),
    createdById: input.actorId,
    createdByGroupId: input.ownerGroupId,
  });
  if (lastName) {
    await tx.characterFieldIntel.create({
      data: { profileId: profile.id, fieldKey: "lastName", knowledgeState: "KNOWN", updatedById: input.actorId },
    });
  }
  if (input.ownerGroupId) {
    await tx.profileAccessGrant.create({
      data: {
        profileId: profile.id,
        groupId: input.ownerGroupId,
        grantedById: input.actorId,
        sourceType: "CREATED_BY_GROUP",
        sourceId: input.sourceMissionId ?? null,
      },
    });
  }
  return profile;
}
