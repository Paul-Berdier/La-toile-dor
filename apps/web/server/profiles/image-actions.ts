"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_TYPES,
  PROFILE_IMAGES_MAX,
  type ProfileImageType,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { sniffImageMime, isFileLike } from "@/server/image-validation";
import { getProfileViewer, decideAccess, toAccessTarget, accessTargetSelect } from "./access";

/**
 * Galerie d'images d'un dossier : portrait principal + pièces (apparence,
 * preuves…). Stockage en base (Bytes), comme le portrait d'origine et les
 * images de rapport — le disque de Railway est éphémère, et aucun fournisseur
 * payant n'est ajouté sans accord.
 *
 * Qui peut téléverser : quiconque peut MODIFIER le dossier (modération,
 * groupe créateur). Qui peut voir : quiconque peut LIRE le dossier — et c'est
 * la route /api/profils/[id]/images/[imageId] qui en décide, jamais l'URL.
 *
 * Rien n'est jamais effacé : une suppression est un `deletedAt`. Le portrait
 * d'origine (colonne imageData) n'est PAS touché par ces actions.
 */

export interface ImageActionResult {
  ok: boolean;
  error?: string;
  imageId?: string;
}

async function loadForEdit(profileId: string) {
  const current = await requireUser();
  const profile = await prisma.characterProfile.findUnique({
    where: { id: profileId },
    select: { ...accessTargetSelect, code: true },
  });
  if (!profile || profile.archivedAt) return { current, profile: null, access: null };
  const viewer = await getProfileViewer(current);
  const access = decideAccess(viewer, toAccessTarget(profile));
  return { current, profile, access };
}

export async function uploadProfileGalleryImageAction(formData: FormData): Promise<ImageActionResult> {
  const profileId = String(formData.get("profileId") ?? "");
  const { current, profile, access } = await loadForEdit(profileId);
  if (!profile) return { ok: false, error: "Dossier introuvable." };
  if (!access?.canEdit) return { ok: false, error: "Vous ne pouvez pas modifier ce dossier." };

  const rawType = String(formData.get("type") ?? "OTHER");
  const type = (PROFILE_IMAGE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as ProfileImageType)
    : "OTHER";
  const caption = String(formData.get("caption") ?? "").trim().slice(0, 200) || null;
  const makePrimary = formData.get("primary") === "true";
  const sourceMissionId = String(formData.get("sourceMissionId") ?? "") || null;

  const file = formData.get("image");
  if (!isFileLike(file) || file.size === 0) return { ok: false, error: "Aucun fichier reçu." };
  if (file.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image trop lourde : 2 Mo maximum." };
  }
  // Validation par signature binaire — le type déclaré ne suffit pas, et le
  // nom du fichier n'est pas conservé (il pourrait dire qui a pris la photo).
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, error: "Format refusé : PNG, JPG/JPEG ou WEBP uniquement." };

  const alive = await prisma.profileImage.count({ where: { profileId, deletedAt: null } });
  if (alive >= PROFILE_IMAGES_MAX) {
    return { ok: false, error: `${PROFILE_IMAGES_MAX} images maximum par dossier.` };
  }
  // Premier portrait d'un dossier qui n'en a pas : il devient principal d'office
  const hasPrimary = await prisma.profileImage.count({
    where: { profileId, isPrimary: true, deletedAt: null },
  });
  const isPrimary = makePrimary || (type === "PORTRAIT" && hasPrimary === 0);

  const created = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.profileImage.updateMany({
        where: { profileId, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
    }
    const row = await tx.profileImage.create({
      data: {
        profileId,
        imageData: bytes,
        imageMime: mime,
        sizeBytes: bytes.length,
        type,
        caption,
        isPrimary,
        sortOrder: alive,
        sourceMissionId,
        uploadedById: current.session.userId,
      },
      select: { id: true },
    });
    // Le champ « Portrait » du dossier devient ACQUIS dès qu'une image existe
    await tx.characterFieldIntel.upsert({
      where: { profileId_fieldKey: { profileId, fieldKey: "image" } },
      update: { knowledgeState: "KNOWN", updatedById: current.session.userId },
      create: { profileId, fieldKey: "image", knowledgeState: "KNOWN", updatedById: current.session.userId },
    });
    await tx.characterProfile.update({
      where: { id: profileId },
      data: { updatedById: current.session.userId },
    });
    return row;
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.image_added",
    resourceType: "characterProfile",
    resourceId: profileId,
    // Jamais le contenu ni le nom du fichier : type, taille, MIME suffisent
    newValues: { imageId: created.id, type, mime, sizeBytes: bytes.length, isPrimary },
    ...meta,
  });
  revalidatePath(`/profils/${profileId}`);
  revalidatePath(`/profils/${profileId}/modifier`);
  return { ok: true, imageId: created.id };
}

export async function setPrimaryProfileImageAction(input: {
  profileId: string;
  imageId: string;
}): Promise<ImageActionResult> {
  const { current, profile, access } = await loadForEdit(input.profileId);
  if (!profile) return { ok: false, error: "Dossier introuvable." };
  if (!access?.canEdit) return { ok: false, error: "Vous ne pouvez pas modifier ce dossier." };

  const image = await prisma.profileImage.findFirst({
    where: { id: input.imageId, profileId: input.profileId, deletedAt: null },
    select: { id: true },
  });
  if (!image) return { ok: false, error: "Image introuvable." };

  await prisma.$transaction([
    prisma.profileImage.updateMany({
      where: { profileId: input.profileId, isPrimary: true, deletedAt: null },
      data: { isPrimary: false },
    }),
    prisma.profileImage.update({ where: { id: image.id }, data: { isPrimary: true } }),
  ]);
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.image_primary",
    resourceType: "characterProfile",
    resourceId: input.profileId,
    newValues: { imageId: image.id },
    ...meta,
  });
  revalidatePath(`/profils/${input.profileId}`);
  revalidatePath(`/profils/${input.profileId}/modifier`);
  return { ok: true };
}

export async function deleteProfileImageAction(input: {
  profileId: string;
  imageId: string;
}): Promise<ImageActionResult> {
  const { current, profile, access } = await loadForEdit(input.profileId);
  if (!profile) return { ok: false, error: "Dossier introuvable." };
  if (!access?.canEdit) return { ok: false, error: "Vous ne pouvez pas modifier ce dossier." };

  const image = await prisma.profileImage.findFirst({
    where: { id: input.imageId, profileId: input.profileId, deletedAt: null },
    select: { id: true, isPrimary: true },
  });
  if (!image) return { ok: false, error: "Image introuvable." };

  await prisma.$transaction(async (tx) => {
    await tx.profileImage.update({
      where: { id: image.id },
      data: { deletedAt: new Date(), isPrimary: false },
    });
    // Si c'était le portrait principal, le portrait suivant prend la place :
    // un dossier qui a des images ne doit pas se retrouver sans visage.
    if (image.isPrimary) {
      const next = await tx.profileImage.findFirst({
        where: { profileId: input.profileId, deletedAt: null, type: "PORTRAIT" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (next) await tx.profileImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    const remaining = await tx.profileImage.count({
      where: { profileId: input.profileId, deletedAt: null },
    });
    const legacy = await tx.characterProfile.findUnique({
      where: { id: input.profileId },
      select: { imageMime: true },
    });
    // Plus aucune image nulle part : le champ « Portrait » redevient Inconnu
    if (remaining === 0 && !legacy?.imageMime) {
      await tx.characterFieldIntel.updateMany({
        where: { profileId: input.profileId, fieldKey: "image" },
        data: { knowledgeState: "UNKNOWN", updatedById: current.session.userId },
      });
    }
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.image_removed",
    resourceType: "characterProfile",
    resourceId: input.profileId,
    oldValues: { imageId: image.id },
    ...meta,
  });
  revalidatePath(`/profils/${input.profileId}`);
  revalidatePath(`/profils/${input.profileId}/modifier`);
  return { ok: true };
}

export async function updateProfileImageAction(input: {
  profileId: string;
  imageId: string;
  caption?: string | null;
  type?: string;
}): Promise<ImageActionResult> {
  const { profile, access } = await loadForEdit(input.profileId);
  if (!profile) return { ok: false, error: "Dossier introuvable." };
  if (!access?.canEdit) return { ok: false, error: "Vous ne pouvez pas modifier ce dossier." };

  const data: { caption?: string | null; type?: ProfileImageType } = {};
  if (input.caption !== undefined) data.caption = input.caption?.trim().slice(0, 200) || null;
  if (input.type !== undefined) {
    if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(input.type)) {
      return { ok: false, error: "Type d'image inconnu." };
    }
    data.type = input.type as ProfileImageType;
  }
  const updated = await prisma.profileImage.updateMany({
    where: { id: input.imageId, profileId: input.profileId, deletedAt: null },
    data,
  });
  if (updated.count === 0) return { ok: false, error: "Image introuvable." };
  revalidatePath(`/profils/${input.profileId}`);
  revalidatePath(`/profils/${input.profileId}/modifier`);
  return { ok: true };
}
