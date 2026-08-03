"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS, groupUpsertSchema } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications } from "@/server/notifications";

interface Result {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/** Un chef ne modifie que SON groupe ; la modération (group.edit.any) modifie tout. */
async function canManageGroup(userId: string, permissions: Set<string>, groupId: string) {
  if (permissions.has(PERMISSIONS.GROUP_EDIT_ANY)) return true;
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { isLeader: true },
  });
  return membership?.isLeader === true;
}

// ── Modification de la fiche du groupe ──

export async function updateGroupAction(input: {
  groupId: string;
  values: unknown;
}): Promise<Result> {
  const current = await requireUser();
  const group = await prisma.group.findUnique({ where: { id: input.groupId } });
  if (!group || !group.isActive) return { ok: false, error: "Groupe introuvable." };

  if (!(await canManageGroup(current.session.userId, current.permissions, group.id))) {
    return { ok: false, error: "Seuls les chefs de ce groupe et la modération peuvent le modifier." };
  }

  const parsed = groupUpsertSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const name = data.name.trim();

  if (name !== group.name) {
    const taken = await prisma.group.findFirst({
      where: {
        id: { not: group.id },
        factionId: group.factionId,
        name: { equals: name, mode: "insensitive" },
      },
    });
    if (taken) return { ok: false, error: "Un groupe porte déjà ce nom dans ce rattachement." };
  }

  const oldValues = {
    name: group.name,
    primaryCountry: group.primaryCountry,
    primaryVillage: group.primaryVillage,
    specialties: group.specialties,
  };
  const newValues = {
    name,
    primaryCountry: data.primaryCountry?.trim() || null,
    primaryVillage: data.primaryVillage?.trim() || null,
    specialties: data.specialties,
  };

  await prisma.group.update({ where: { id: group.id }, data: newValues });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "group.updated",
    resourceType: "group",
    resourceId: group.id,
    oldValues,
    newValues,
    ...meta,
  });

  revalidatePath(`/groupes/${group.id}`);
  revalidatePath("/groupes");
  return { ok: true };
}

/** Le rattachement à une faction reste facultatif et ne peut être modifié que
 * par la modération ; il n'accorde aucun droit aux membres du groupe. */
export async function setGroupFactionAction(input: {
  groupId: string;
  factionId: string | null;
}): Promise<Result> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY)) {
    return { ok: false, error: "Permission refusée." };
  }

  const group = await prisma.group.findFirst({ where: { id: input.groupId, isActive: true } });
  if (!group) return { ok: false, error: "Groupe introuvable." };
  if (input.factionId) {
    const faction = await prisma.faction.findFirst({
      where: { id: input.factionId, isActive: true },
    });
    if (!faction) return { ok: false, error: "Faction introuvable ou inactive." };
  }

  const taken = await prisma.group.findFirst({
    where: {
      id: { not: group.id },
      factionId: input.factionId,
      name: { equals: group.name, mode: "insensitive" },
    },
  });
  if (taken) return { ok: false, error: "Un groupe de même nom existe déjà dans ce rattachement." };

  await prisma.$transaction([
    prisma.group.update({
      where: { id: group.id },
      data: { factionId: input.factionId },
    }),
    prisma.missionAssignment.updateMany({
      where: { groupId: group.id, active: true },
      data: { factionId: input.factionId },
    }),
    prisma.mission.updateMany({
      where: {
        assignedGroupId: group.id,
        status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
      data: { assignedFactionId: input.factionId },
    }),
    prisma.invitation.updateMany({
      where: { groupId: group.id, status: "ACTIVE" },
      data: { factionId: input.factionId },
    }),
  ]);
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "group.faction_changed",
    resourceType: "group",
    resourceId: group.id,
    oldValues: { factionId: group.factionId },
    newValues: { factionId: input.factionId },
    ...meta,
  });
  revalidatePath(`/groupes/${group.id}`);
  revalidatePath("/groupes");
  revalidatePath("/admin/factions");
  return { ok: true };
}

// ── Image du groupe (stockée en base : FS Railway éphémère) ──

const IMAGE_MAX_BYTES = 500 * 1024;
const IMAGE_SIGNATURES: { mime: string; check: (b: Buffer) => boolean }[] = [
  { mime: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/webp",
    check: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export async function uploadGroupImageAction(formData: FormData): Promise<Result> {
  const current = await requireUser();
  const groupId = String(formData.get("groupId") ?? "");
  const file = formData.get("image");

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group || !group.isActive) return { ok: false, error: "Groupe introuvable." };
  if (!(await canManageGroup(current.session.userId, current.permissions, group.id))) {
    return { ok: false, error: "Seuls les chefs de ce groupe et la modération peuvent le modifier." };
  }

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier reçu." };
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image trop lourde : 500 Ko maximum." };
  }

  // Validation par signature binaire — le type déclaré ne suffit pas
  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = IMAGE_SIGNATURES.find((s) => s.check(bytes));
  if (!signature) {
    return { ok: false, error: "Format refusé : PNG, JPG/JPEG ou WEBP uniquement." };
  }

  await prisma.group.update({
    where: { id: group.id },
    data: { imageData: bytes, imageMime: signature.mime },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "group.image_changed",
    resourceType: "group",
    resourceId: group.id,
    newValues: { mime: signature.mime, sizeBytes: bytes.length },
    ...meta,
  });

  revalidatePath(`/groupes/${group.id}`);
  return { ok: true };
}

// ── Promotion d'un agent en chef de groupe ──

export async function promoteToLeaderAction(input: {
  groupId: string;
  userId: string;
}): Promise<Result> {
  const current = await requireUser();
  const group = await prisma.group.findUnique({ where: { id: input.groupId } });
  if (!group || !group.isActive) return { ok: false, error: "Groupe introuvable." };

  // Chef DE CE groupe, modérateur ou super-modérateur — vérifié côté serveur
  if (!(await canManageGroup(current.session.userId, current.permissions, group.id))) {
    return { ok: false, error: "Seuls les chefs de ce groupe et la modération peuvent promouvoir." };
  }

  // L'agent doit appartenir AU MÊME groupe
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: group.id, userId: input.userId } },
    include: { user: { select: { displayName: true, status: true } } },
  });
  if (!membership) {
    return { ok: false, error: "Cet utilisateur n'appartient pas à ce groupe." };
  }
  if (membership.isLeader) {
    return { ok: false, error: "Ce membre est déjà chef du groupe." };
  }
  if (membership.user.status !== "ACTIVE") {
    return { ok: false, error: "Ce compte n'est pas actif." };
  }

  const leaderRole = await prisma.role.findUnique({ where: { slug: "group_leader" } });

  await prisma.$transaction(async (tx) => {
    // La promotion conserve l'historique : on ne recrée pas l'appartenance
    await tx.groupMember.update({
      where: { groupId_userId: { groupId: group.id, userId: input.userId } },
      data: { isLeader: true },
    });
    // Rôle applicatif de chef → nouvelles permissions effectives immédiatement
    // (elles sont relues à chaque requête, pas figées dans la session)
    if (leaderRole) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: input.userId, roleId: leaderRole.id } },
        update: {},
        create: { userId: input.userId, roleId: leaderRole.id, assignedById: current.session.userId },
      });
    }
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "group.member_promoted",
    resourceType: "group",
    resourceId: group.id,
    // Pseudonyme public uniquement — jamais l'identité réelle dans l'audit
    newValues: { userId: input.userId, displayName: membership.user.displayName },
    ...meta,
  });

  await enqueueNotifications({
    userIds: [input.userId],
    event: "MEMBER_PROMOTED",
    payload: { title: group.name, note: "Vous êtes désormais chef de ce groupe." },
  });

  revalidatePath(`/groupes/${group.id}`);
  return { ok: true };
}
