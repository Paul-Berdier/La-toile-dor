"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit, rateLimit } from "@toile/auth";
import { selfIdentityUpdateSchema, normalizeDisplayName } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { isFileLike, sanitizePortraitImage } from "@/server/image-validation";

interface Result {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const PORTRAIT_MAX_BYTES = 500 * 1024;

function revalidateOwnProfile() {
  revalidatePath("/compte");
  revalidatePath("/missions");
}

/**
 * Mise à jour par un membre de ses propres informations : identité,
 * présentation, spécialités et grade RP.
 *
 * Chacun est maître de sa fiche — aucune permission particulière n'est requise,
 * mais l'action ne touche jamais qu'à l'utilisateur de la session : l'`userId`
 * ne vient pas de l'entrée. Les règles de la première connexion s'appliquent
 * telles quelles (unicité du Titre insensible à la casse). Le grade choisi est
 * toujours résolu côté serveur avant d'être enregistré : un identifiant forgé
 * ne permet jamais de créer une valeur hors référentiel.
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

  const selectedLevel = await prisma.playerLevel.findUnique({
    where: { id: data.playerLevelId },
    select: { id: true, label: true },
  });
  if (!selectedLevel) {
    return {
      ok: false,
      fieldErrors: { playerLevelId: ["Ce grade n'existe pas."] },
      error: "Ce grade n'existe pas.",
    };
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: {
      displayName: true,
      identityVisibility: true,
      publicBio: true,
      specialties: true,
      playerLevelId: true,
      playerLevel: { select: { label: true } },
    },
  });
  const publicBio =
    data.publicBio === undefined
      ? before.publicBio
      : data.publicBio.trim() || null;
  const specialties = data.specialties ?? before.specialties;

  try {
    await prisma.user.update({
      where: { id: current.session.userId },
      data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName?.trim() ? data.lastName.trim() : null,
        displayName,
        displayNameNorm: norm,
        identityVisibility: data.identityVisibility,
        playerLevelId: selectedLevel.id,
        ...(data.publicBio === undefined ? {} : { publicBio }),
        ...(data.specialties === undefined ? {} : { specialties }),
      },
    });
  } catch (error) {
    // Course sur l'unicité du Titre → message propre plutôt qu'une 500
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        fieldErrors: { displayName: ["Ce Titre vient d'être pris — choisissez-en un autre."] },
        error: "Ce Titre vient d'être pris.",
      };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.identity_updated",
    resourceType: "user",
    resourceId: current.session.userId,
    // Jamais le prénom/nom dans l'audit — uniquement des métadonnées non
    // confidentielles utiles à la traçabilité.
    // La portée choisie y figure : c'est une décision de confidentialité, et
    // savoir quand elle a changé peut compter.
    oldValues: {
      displayName: before.displayName,
      identityVisibility: before.identityVisibility,
      hasPublicBio: Boolean(before.publicBio),
      publicBioLength: before.publicBio?.length ?? 0,
      specialties: before.specialties,
    },
    newValues: {
      displayName,
      identityVisibility: data.identityVisibility,
      // Le contenu de la présentation n'a aucune raison d'être dupliqué
      // durablement dans les journaux d'audit.
      hasPublicBio: Boolean(publicBio),
      publicBioLength: publicBio?.length ?? 0,
      specialties,
    },
    ...meta,
  });

  if (before.playerLevelId !== selectedLevel.id) {
    await audit({
      actorId: current.session.userId,
      action: "user.level_updated",
      resourceType: "user",
      resourceId: current.session.userId,
      oldValues: {
        playerLevelId: before.playerLevelId,
        label: before.playerLevel?.label ?? null,
      },
      newValues: {
        playerLevelId: selectedLevel.id,
        label: selectedLevel.label,
      },
      reason: "Modification personnelle depuis Mes informations.",
      ...meta,
    });
  }

  revalidateOwnProfile();
  return { ok: true };
}

/**
 * Remplace le portrait du compte courant. L'identifiant utilisateur ne
 * vient jamais du client : un membre ne peut écrire que ses propres octets.
 */
export async function uploadOwnPortraitAction(formData: FormData): Promise<Result> {
  const current = await requireUser();
  const file = formData.get("portrait");

  if (!isFileLike(file) || file.size === 0) {
    return { ok: false, error: "Aucun fichier reçu." };
  }
  if (file.size > PORTRAIT_MAX_BYTES) {
    return { ok: false, error: "Portrait trop lourd : 500 Ko maximum." };
  }

  // Le décodage natif est volontairement coûteux : un compte authentifié ne
  // doit pas pouvoir le marteler. Ce verrou mémoire convient au déploiement
  // mono-instance actuel ; passer à PostgreSQL/Redis en cas de réplication.
  const uploadLimit = rateLimit(
    `portrait-upload:${current.session.userId}`,
    12,
    10 * 60,
  );
  if (!uploadLimit.allowed) {
    return {
      ok: false,
      error: `Trop de portraits envoyés. Réessayez dans ${Math.max(
        1,
        Math.ceil(uploadLimit.retryAfterSeconds / 60),
      )} min.`,
    };
  }

  // Le type annoncé par le navigateur et le nom du fichier ne sont jamais
  // considérés comme une preuve. Après le sniff, le décodeur doit encore
  // valider puis réencoder l'image sans métadonnées avant tout stockage.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return { ok: false, error: "Le fichier est vide." };
  if (bytes.length > PORTRAIT_MAX_BYTES) {
    return { ok: false, error: "Portrait trop lourd : 500 Ko maximum." };
  }
  let sanitized: Awaited<ReturnType<typeof sanitizePortraitImage>>;
  try {
    sanitized = await sanitizePortraitImage(bytes);
  } catch {
    return { ok: false, error: "Format refusé : PNG, JPG/JPEG ou WEBP uniquement." };
  }
  if (sanitized.bytes.length > PORTRAIT_MAX_BYTES) {
    return {
      ok: false,
      error: "Portrait trop lourd après sécurisation : choisissez une image plus simple.",
    };
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: { portraitMime: true, portraitData: true },
  });
  await prisma.user.update({
    where: { id: current.session.userId },
    // Prisma 6 attend un Uint8Array adossé à un ArrayBuffer transférable ;
    // le Buffer produit par Sharp peut aussi référencer un SharedArrayBuffer.
    data: {
      portraitData: Uint8Array.from(sanitized.bytes),
      portraitMime: sanitized.mime,
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.portrait_changed",
    resourceType: "user",
    resourceId: current.session.userId,
    oldValues: {
      present: Boolean(before.portraitData && before.portraitMime),
      mime: before.portraitMime,
    },
    // Ni les octets, ni le nom local du fichier ne quittent la colonne dédiée.
    newValues: {
      present: true,
      mime: sanitized.mime,
      sizeBytes: sanitized.bytes.length,
    },
    ...meta,
  });

  revalidateOwnProfile();
  return { ok: true };
}

/** Suppression explicite et idempotente du portrait du compte courant. */
export async function removeOwnPortraitAction(): Promise<Result> {
  const current = await requireUser();
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: { portraitMime: true, portraitData: true },
  });

  if (!before.portraitData && !before.portraitMime) return { ok: true };

  await prisma.user.update({
    where: { id: current.session.userId },
    data: { portraitData: null, portraitMime: null },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.portrait_removed",
    resourceType: "user",
    resourceId: current.session.userId,
    oldValues: { present: true, mime: before.portraitMime },
    newValues: { present: false },
    ...meta,
  });

  revalidateOwnProfile();
  return { ok: true };
}
