"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import { selfIdentityUpdateSchema, normalizeDisplayName } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";

interface Result {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Mise à jour par un membre de SA propre identité : Titre, grade, prénom, nom.
 *
 * Chacun est maître de sa fiche — aucune permission particulière n'est requise,
 * mais l'action ne touche jamais qu'à l'utilisateur de la session : l'`userId`
 * ne vient pas de l'entrée. Les règles de la première connexion s'appliquent
 * telles quelles (unicité du Titre insensible à la casse, grade existant).
 */
export async function updateOwnIdentityAction(raw: unknown): Promise<Result> {
  const current = await requireUser();

  const parsed = selfIdentityUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const displayName = data.displayName.trim().replace(/\s+/g, " ");
  const norm = normalizeDisplayName(displayName);

  const taken = await prisma.user.findFirst({
    where: { displayNameNorm: norm, id: { not: current.session.userId } },
    select: { id: true },
  });
  if (taken) {
    return {
      ok: false,
      fieldErrors: { displayName: ["Ce Titre est déjà porté sur la Toile."] },
      error: "Ce Titre est déjà porté sur la Toile.",
    };
  }

  const level = await prisma.playerLevel.findUnique({
    where: { id: data.playerLevelId },
    select: { id: true },
  });
  if (!level) {
    return {
      ok: false,
      fieldErrors: { playerLevelId: ["Ce grade n'existe pas."] },
      error: "Ce grade n'existe pas.",
    };
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: { displayName: true, playerLevelId: true, identityVisibility: true },
  });

  try {
    await prisma.user.update({
      where: { id: current.session.userId },
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName?.trim() ? data.lastName.trim() : null,
        displayName,
        displayNameNorm: norm,
        playerLevelId: level.id,
        identityVisibility: data.identityVisibility,
      },
    });
  } catch {
    // Course sur l'unicité du Titre → message propre plutôt qu'une 500
    return {
      ok: false,
      fieldErrors: { displayName: ["Ce Titre vient d'être pris — choisissez-en un autre."] },
      error: "Ce Titre vient d'être pris.",
    };
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.identity_updated",
    resourceType: "user",
    resourceId: current.session.userId,
    // Jamais le prénom/nom dans l'audit — uniquement ce qui est public.
    // La portée choisie y figure : c'est une décision de confidentialité, et
    // savoir quand elle a changé peut compter.
    oldValues: {
      displayName: before.displayName,
      playerLevelId: before.playerLevelId,
      identityVisibility: before.identityVisibility,
    },
    newValues: {
      displayName,
      playerLevelId: level.id,
      identityVisibility: data.identityVisibility,
    },
    ...meta,
  });

  revalidatePath("/compte");
  return { ok: true };
}
