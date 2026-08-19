"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import { PERMISSIONS } from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";

export interface TargetActionResult {
  ok: boolean;
  error?: string;
  /** Avertissements non bloquants (renseignement de cible incomplet…) */
  warnings?: string[];
}

const OUTCOMES = ["UNKNOWN", "ELIMINATED", "CAPTURED", "ESCAPED", "UNHARMED", "MISSING"] as const;
type Outcome = (typeof OUTCOMES)[number];

async function guardMove() {
  const current = await requireUser();
  return current.permissions.has(PERMISSIONS.MISSION_UPDATE) ||
    current.permissions.has(PERMISSIONS.MISSION_MOVE)
    ? current
    : null;
}

/**
 * Rattache une cible à une mission — dossier existant, ou nouveau dossier
 * ouvert au passage. Une mission peut viser plusieurs personnes : on ne
 * remplace pas la précédente, on ajoute.
 */
export async function addMissionTargetAction(input: {
  missionId: string;
  profileId?: string;
  /** Prénom d'une cible sans dossier : on lui en ouvre un */
  newProfileFirstName?: string;
  /** Ou simple nom libre, sans dossier du tout */
  label?: string;
}): Promise<TargetActionResult> {
  const current = await guardMove();
  if (!current) return { ok: false, error: "Permission refusée." };

  const mission = await prisma.mission.findUnique({
    where: { id: input.missionId },
    select: { id: true, code: true },
  });
  if (!mission) return { ok: false, error: "Mission introuvable." };

  let profileId = input.profileId ?? null;

  if (!profileId && input.newProfileFirstName?.trim()) {
    // UNE seule voie de création, la même que partout ailleurs : groupe
    // propriétaire, octroi CREATED_BY_GROUP, titre, détection de doublons,
    // audit. Ce chemin contournait tout cela — un dossier ouvert depuis une
    // mission n'avait ni propriétaire ni vérification de doublon.
    const created = await quickCreateProfileAction({
      firstName: input.newProfileFirstName,
      sourceMissionId: mission.id,
      // La modération ouvre souvent la cible d'une mission qui n'est celle
      // d'aucun groupe : on ne bloque pas sur un doublon ici, on l'audite.
      confirmDespiteDuplicates: true,
    });
    if (!created.ok || !created.profileId) {
      return { ok: false, error: created.error ?? "L'ouverture du dossier a échoué." };
    }
    profileId = created.profileId;
  }

  if (!profileId && !input.label?.trim()) {
    return { ok: false, error: "Indiquez un dossier ou un nom de cible." };
  }

  if (profileId) {
    const already = await prisma.missionTarget.findFirst({
      where: { missionId: mission.id, profileId },
      select: { id: true },
    });
    if (already) return { ok: false, error: "Cette cible est déjà rattachée à la mission." };
  }

  await prisma.missionTarget.create({
    data: {
      missionId: mission.id,
      profileId,
      label: profileId ? null : input.label!.trim(),
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.target_added",
    resourceType: "mission",
    resourceId: mission.id,
    newValues: { profileId, label: input.label ?? null },
    ...meta,
  });
  revalidatePath(`/missions/${mission.id}`);
  return { ok: true };
}

export async function removeMissionTargetAction(targetId: string): Promise<TargetActionResult> {
  const current = await guardMove();
  if (!current) return { ok: false, error: "Permission refusée." };

  const target = await prisma.missionTarget.findUnique({
    where: { id: targetId },
    select: { id: true, missionId: true, profileId: true },
  });
  if (!target) return { ok: false, error: "Cible introuvable." };

  await prisma.missionTarget.delete({ where: { id: targetId } });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.target_removed",
    resourceType: "mission",
    resourceId: target.missionId,
    oldValues: { profileId: target.profileId },
    ...meta,
  });
  revalidatePath(`/missions/${target.missionId}`);
  return { ok: true };
}

/**
 * Consigne le sort d'une cible. C'est cette information qui, à la résolution,
 * met à jour l'état vital du dossier — d'où la trace de qui l'a constatée.
 */
export async function setMissionTargetOutcomeAction(input: {
  targetId: string;
  outcome: string;
  note?: string;
}): Promise<TargetActionResult> {
  const current = await guardMove();
  if (!current) return { ok: false, error: "Permission refusée." };
  if (!OUTCOMES.includes(input.outcome as Outcome)) {
    return { ok: false, error: "Sort inconnu." };
  }

  const target = await prisma.missionTarget.findUnique({
    where: { id: input.targetId },
    select: { id: true, missionId: true },
  });
  if (!target) return { ok: false, error: "Cible introuvable." };

  await prisma.missionTarget.update({
    where: { id: target.id },
    data: {
      outcome: input.outcome as Outcome,
      note: input.note?.trim() || null,
      recordedAt: new Date(),
      recordedById: current.session.userId,
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.target_outcome",
    resourceType: "mission",
    resourceId: target.missionId,
    newValues: { targetId: target.id, outcome: input.outcome },
    ...meta,
  });
  revalidatePath(`/missions/${target.missionId}`);
  return { ok: true };
}
