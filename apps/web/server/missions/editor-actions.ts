"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  generateMissionPublicTitle,
  missionEditorSchema,
  rpToRealMs,
  type MissionDeadlineInput,
  type MissionEditorInput,
  type MissionProfileRole,
  type TitleTargetInput,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, groupLeaderIds, groupMemberIds } from "@/server/notifications";
import { getRpTimeConfig } from "@/server/rp-config";

/**
 * L'ÉDITEUR DE MISSION — une action, un objet, une page.
 *
 * Tout ce qui peut se déduire l'est :
 *  · le titre public, des cibles (voir `generateMissionPublicTitle`) ;
 *  · le niveau de cible, du grade le plus élevé des dossiers ;
 *  · la faction cible, de leur origine commune.
 *
 * Les SNAPSHOTS sont la clé de l'honnêteté historique : tant que la mission
 * est un brouillon, ils suivent les dossiers ; à la publication, ils gèlent.
 * Une mission close ne se réécrit jamais toute seule quand un ninja monte en
 * grade — la modération peut resynchroniser, explicitement, en voyant l'écart.
 */

export interface MissionEditorResult {
  ok: boolean;
  error?: string;
  missionId?: string;
  fieldErrors?: Record<string, string[]>;
}

// ── Délai ───────────────────────────────────────────────────────────────

/**
 * Une intention de délai → un instant UTC. Une seule vérité en base
 * (`expiresAt`) ; l'interface montre les équivalences.
 */
async function resolveDeadline(
  deadline: MissionDeadlineInput,
  from: Date,
): Promise<{ expiresAt: Date | null; error?: string }> {
  switch (deadline.mode) {
    case "NONE":
      return { expiresAt: null };
    case "REAL":
      return { expiresAt: new Date(from.getTime() + (deadline.realHours ?? 0) * 3600_000) };
    case "RP": {
      const ms = rpToRealMs(deadline.rp ?? {}, await getRpTimeConfig());
      return ms > 0 ? { expiresAt: new Date(from.getTime() + ms) } : { expiresAt: null };
    }
    case "DATE": {
      const at = deadline.at ? new Date(deadline.at) : null;
      if (!at) return { expiresAt: null };
      if (at <= from) return { expiresAt: null, error: "La date d'expiration doit être dans le futur." };
      return { expiresAt: at };
    }
  }
}

// ── Liens vers les dossiers ─────────────────────────────────────────────

interface ResolvedLink {
  profileId: string;
  role: MissionProfileRole;
  isPrimary: boolean;
  snapshotRankId: string | null;
  snapshotClassId: string | null;
  snapshotFactionId: string | null;
  gradeLabel: string | null;
  gradeOrder: number | null;
  originLabel: string | null;
}

/**
 * Charge les dossiers rattachés et prend leur photo. Un identifiant fabriqué
 * ou pointant vers un dossier archivé est écarté — la mission n'a pas à être
 * perdue pour un rattachement fautif ; un dossier fusionné suit sa
 * redirection, le lien reste juste.
 */
async function resolveLinks(
  links: MissionEditorInput["links"],
): Promise<ResolvedLink[]> {
  if (links.length === 0) return [];
  const profiles = await prisma.characterProfile.findMany({
    where: { id: { in: [...new Set(links.map((l) => l.profileId))] } },
    select: {
      id: true,
      archivedAt: true,
      mergedIntoId: true,
      rankId: true,
      ninjaClassId: true,
      factionId: true,
      rank: { select: { label: true, order: true } },
      faction: { select: { name: true } },
    },
  });
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const resolved: ResolvedLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    let profile = byId.get(link.profileId);
    if (profile?.mergedIntoId) {
      profile = await prisma.characterProfile
        .findUnique({
          where: { id: profile.mergedIntoId },
          select: {
            id: true, archivedAt: true, mergedIntoId: true, rankId: true, ninjaClassId: true,
            factionId: true, rank: { select: { label: true, order: true } }, faction: { select: { name: true } },
          },
        })
        .then((p) => p ?? undefined);
    }
    if (!profile || profile.archivedAt) continue;
    const key = `${profile.id}:${link.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({
      profileId: profile.id,
      role: link.role,
      isPrimary: link.isPrimary,
      snapshotRankId: profile.rankId,
      snapshotClassId: profile.ninjaClassId,
      snapshotFactionId: profile.factionId,
      gradeLabel: profile.rank?.label ?? null,
      gradeOrder: profile.rank?.order ?? null,
      originLabel: profile.faction?.name ?? null,
    });
  }
  return resolved;
}

/** Les cibles, sous la forme attendue par le générateur de titre. */
function titleTargets(links: readonly ResolvedLink[]): TitleTargetInput[] {
  return links
    .filter((l) => l.role === "TARGET")
    .map((l) => ({
      gradeLabel: l.gradeLabel,
      gradeOrder: l.gradeOrder,
      originLabel: l.originLabel,
    }));
}

/**
 * Ce que les cibles imposent au reste de la mission : le niveau affiché
 * publiquement (le plus élevé — c'est lui qui fait la difficulté) et la
 * faction cible quand elles n'en ont qu'une.
 */
function derivedFromTargets(links: readonly ResolvedLink[]): {
  targetLevelId: string | null;
  targetFactionId: string | null;
} {
  const targets = links.filter((l) => l.role === "TARGET");
  const graded = targets.filter((t) => t.gradeOrder != null);
  const highest = graded.length
    ? graded.reduce((best, t) => ((t.gradeOrder ?? -1) > (best.gradeOrder ?? -1) ? t : best))
    : null;
  const factions = new Set(
    targets.map((t) => t.snapshotFactionId).filter((id): id is string => Boolean(id)),
  );
  return {
    targetLevelId: highest?.snapshotRankId ?? null,
    targetFactionId: factions.size === 1 ? [...factions][0]! : null,
  };
}

/**
 * Réécrit les liens d'une mission d'après le formulaire.
 *
 * Les liens ABSENTS du formulaire sont retirés — mais on préserve ce que la
 * mission a vécu : le sort constaté d'une cible (`outcome`, `note`) et son
 * snapshot d'origine survivent à une réédition. Sans cela, corriger une
 * virgule dans l'objectif effacerait « éliminée » sur une cible.
 */
async function syncLinks(
  tx: Prisma.TransactionClient,
  missionId: string,
  links: readonly ResolvedLink[],
  actorId: string,
  options: { freezeSnapshots: boolean },
) {
  const existing = await tx.missionTarget.findMany({
    where: { missionId },
    select: { id: true, profileId: true, role: true, snapshotAt: true },
  });
  const wanted = new Map(links.map((l) => [`${l.profileId}:${l.role}`, l]));

  for (const row of existing) {
    // Une cible historique sans dossier (texte libre) n'est jamais supprimée
    // par l'éditeur : elle attend sa régularisation.
    if (!row.profileId) continue;
    const key = `${row.profileId}:${row.role}`;
    const link = wanted.get(key);
    if (!link) {
      await tx.missionTarget.delete({ where: { id: row.id } });
      continue;
    }
    wanted.delete(key);
    // Snapshot : rafraîchi tant que rien n'est figé, jamais réécrit ensuite
    const refresh = !row.snapshotAt || !options.freezeSnapshots;
    await tx.missionTarget.update({
      where: { id: row.id },
      data: {
        isPrimary: link.isPrimary,
        ...(refresh
          ? {
              snapshotRankId: link.snapshotRankId,
              snapshotClassId: link.snapshotClassId,
              snapshotFactionId: link.snapshotFactionId,
              snapshotAt: new Date(),
            }
          : {}),
      },
    });
  }

  for (const link of wanted.values()) {
    await tx.missionTarget.create({
      data: {
        missionId,
        profileId: link.profileId,
        role: link.role,
        isPrimary: link.isPrimary,
        snapshotRankId: link.snapshotRankId,
        snapshotClassId: link.snapshotClassId,
        snapshotFactionId: link.snapshotFactionId,
        snapshotAt: new Date(),
        createdById: actorId,
      },
    });
  }
}

/** Prochain code de mission — sérialisé par le plus grand numéro existant. */
async function nextMissionCode(tx: Prisma.TransactionClient, rank: string): Promise<string> {
  // Le plus grand numéro DÉJÀ ATTRIBUÉ, tous rangs confondus : `count()`
  // rendait un numéro déjà pris dès qu'une mission était supprimée.
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(NULLIF(regexp_replace("code", '^.*-', ''), '')::int) AS max FROM "Mission"
  `;
  const next = (rows[0]?.max ?? 0) + 1;
  return `TO-${rank}-${String(next).padStart(4, "0")}`;
}

// ── Action principale ───────────────────────────────────────────────────

/**
 * Enregistre une mission — création ou modification, brouillon ou publication.
 * UNE action pour l'éditeur : la page n'a pas à savoir laquelle appeler.
 */
export async function saveMissionAction(input: {
  missionId?: string;
  values: unknown;
  publish: boolean;
  /** Redirige vers la fiche après succès (pas en autosave) */
  redirectAfter?: boolean;
}): Promise<MissionEditorResult> {
  const current = await requireUser();
  const permission = input.missionId ? PERMISSIONS.MISSION_UPDATE : PERMISSIONS.MISSION_CREATE;
  if (!current.permissions.has(permission)) {
    return { ok: false, error: "Permission refusée." };
  }

  const parsed = missionEditorSchema.safeParse(input.values);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const actorId = current.session.userId;

  // Un titre manuel est une DÉROGATION : réservée aux super-modérateurs
  // (`settings.manage`, leur marqueur), et toujours motivée. Sans cela, le
  // titre reste calculé — c'est la règle qui protège du titre qui en dit trop.
  const canOverrideTitle = current.permissions.has(PERMISSIONS.SETTINGS_MANAGE);
  if (data.titleOverride && !canOverrideTitle) {
    return { ok: false, error: "Seul un super-modérateur peut imposer un titre manuel." };
  }

  const existing = input.missionId
    ? await prisma.mission.findUnique({
        where: { id: input.missionId },
        select: { id: true, code: true, status: true, publishedAt: true, expiresAt: true, publicTitle: true },
      })
    : null;
  if (input.missionId && !existing) return { ok: false, error: "Mission introuvable." };

  const wasPublished = Boolean(existing && existing.status !== "DRAFT");
  const publishing = input.publish && !wasPublished;
  const now = new Date();

  const { expiresAt, error: deadlineError } = await resolveDeadline(
    data.deadline,
    // En modification d'une mission déjà publiée, une durée court depuis sa
    // publication — pas depuis l'instant où l'on corrige une virgule.
    wasPublished && existing?.publishedAt ? existing.publishedAt : now,
  );
  if (deadlineError) return { ok: false, error: deadlineError };

  const links = await resolveLinks(data.links);
  const derived = derivedFromTargets(links);
  const generated = generateMissionPublicTitle({
    category: data.category,
    rank: data.rank,
    rankModifier: data.rankModifier,
    targets: titleTargets(links),
    originVisibility: data.originVisibility,
  });
  const publicTitle = data.titleOverride?.trim() || generated.title;

  const minLevel = data.minRecommendedLevelSlug
    ? await prisma.playerLevel.findUnique({ where: { slug: data.minRecommendedLevelSlug } })
    : null;

  const shared = {
    status: input.publish ? ("AVAILABLE" as const) : undefined,
    rank: data.rank,
    rankModifier: data.rankModifier,
    category: data.category,
    publicTitle,
    titleAuto: !data.titleOverride,
    titleOverrideReason: data.titleOverride ? (data.titleOverrideReason ?? null) : null,
    originVisibility: data.originVisibility,
    publicSummary: data.publicSummary || null,
    confidentialDescription: data.confidentialDescription || null,
    primaryObjective: data.primaryObjective || null,
    secondaryObjectives: data.secondaryObjectives,
    location: data.location || null,
    constraints: data.constraints || null,
    prohibitions: data.prohibitions || null,
    evidence: data.evidence || null,
    soughtFieldKeys: data.soughtFieldKeys.length > 0 ? data.soughtFieldKeys : undefined,
    internalTitle: data.internalTitle || null,
    moderatorNotes: data.moderatorNotes || null,
    rewardRyoMin: data.rewardRyoMin,
    rewardRyoMax: data.rewardRyoMax,
    basePoints: data.basePoints,
    // Dérivés des dossiers — plus jamais saisis à la main
    targetLevelId: derived.targetLevelId,
    targetFactionId: derived.targetFactionId,
    minRecommendedLevelId: minLevel?.id ?? null,
    groupSizeMin: data.groupSizeMin,
    groupSizeMax: data.groupSizeMax,
    eligibilityMode: data.eligibilityMode,
    requiresEnhancedReview: data.requiresEnhancedReview,
    expiresAt,
    responsibleModeratorId: actorId,
  };

  let missionId = existing?.id ?? "";
  let code = existing?.code ?? "";
  try {
    await prisma.$transaction(async (tx) => {
      if (existing) {
        const updated = await tx.mission.updateMany({
          // Statut relu : une transition concurrente ne se laisse pas écraser
          where: { id: existing.id, status: existing.status },
          data: {
            ...shared,
            // Publier un brouillon, oui ; « dépublier », jamais implicitement
            ...(publishing ? { status: "AVAILABLE", publishedAt: now } : { status: existing.status }),
          },
        });
        if (updated.count === 0) throw new Error("CONCURRENT_UPDATE");
        await tx.missionVisibility.upsert({
          where: { missionId: existing.id },
          create: { missionId: existing.id, ...data.visibility },
          update: data.visibility,
        });
        missionId = existing.id;
        code = existing.code;
      } else {
        code = await nextMissionCode(tx, data.rank);
        const created = await tx.mission.create({
          data: {
            ...shared,
            code,
            status: input.publish ? "AVAILABLE" : "DRAFT",
            publishedAt: input.publish ? now : null,
            creatorId: actorId,
            visibility: { create: data.visibility },
          },
          select: { id: true },
        });
        missionId = created.id;
      }

      await syncLinks(tx, missionId, links, actorId, {
        // Les snapshots gèlent dès que la mission est publiée
        freezeSnapshots: wasPublished || input.publish,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return { ok: false, error: "La mission vient d'être modifiée — rechargez avant d'enregistrer." };
    }
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "Un code de mission identique vient d'être attribué ; réessayez." };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId,
    action: existing ? "mission.updated" : "mission.created",
    resourceType: "mission",
    resourceId: missionId,
    newValues: {
      code,
      rank: data.rank,
      rankModifier: data.rankModifier,
      published: input.publish,
      title: publicTitle,
      titleManual: Boolean(data.titleOverride),
      ...(data.titleOverride ? { titleOverrideReason: data.titleOverrideReason } : {}),
      targets: links.filter((l) => l.role === "TARGET").length,
      clients: links.filter((l) => l.role === "CLIENT").length,
    },
    ...meta,
  });

  // Notifications : le titre public est le SEUL libellé diffusé — il ne
  // nomme personne (voir mission-title.ts).
  if (publishing && data.notifyLeaders) {
    await enqueueNotifications({
      userIds: await groupLeaderIds(),
      event: "MISSION_AVAILABLE",
      payload: {
        code,
        rank: data.rank,
        category: data.category,
        title: publicTitle,
        rewardMin: data.rewardRyoMin,
        rewardMax: data.rewardRyoMax,
      },
      missionId,
      batchKey: "missions:new",
    });
  } else if (existing && wasPublished && data.notifyLeaders) {
    const assignments = await prisma.missionAssignment.findMany({
      where: { missionId, active: true },
      select: { groupId: true },
    });
    if (assignments.length > 0) {
      const memberLists = await Promise.all(
        assignments.map((assignment) => groupMemberIds(assignment.groupId)),
      );
      await enqueueNotifications({
        userIds: [...new Set(memberLists.flat())],
        event: "MISSION_UPDATED",
        payload: { code, rank: data.rank, category: data.category, title: publicTitle },
        missionId,
        batchKey: `missions:updated:${missionId}`,
      });
    }
  }

  revalidatePath("/missions");
  revalidatePath(`/missions/${missionId}`);
  if (input.redirectAfter !== false) redirect(`/missions/${missionId}`);
  return { ok: true, missionId };
}

// ── Description d'un dossier pour l'éditeur ─────────────────────────────

export interface EditorProfileSummary {
  profileId: string;
  code: string;
  name: string;
  gradeLabel: string | null;
  classLabel: string | null;
  originLabel: string | null;
  lifeStatus: string | null;
}

/**
 * Ce que l'éditeur affiche d'un dossier rattaché : code, nom (publics), plus
 * grade, classe et origine — les trois valeurs qui alimenteront le titre et
 * les snapshots. Réservé à qui peut écrire une mission : c'est la modération,
 * qui voit déjà tous les dossiers.
 */
export async function describeProfileForEditorAction(
  profileId: string,
): Promise<EditorProfileSummary | null> {
  const current = await requireUser();
  if (
    !current.permissions.has(PERMISSIONS.MISSION_CREATE) &&
    !current.permissions.has(PERMISSIONS.MISSION_UPDATE)
  ) {
    return null;
  }
  const profile = await prisma.characterProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      code: true,
      characterFirstName: true,
      characterLastName: true,
      lifeStatus: true,
      archivedAt: true,
      mergedIntoId: true,
      rank: { select: { label: true } },
      ninjaClass: { select: { label: true } },
      faction: { select: { name: true } },
    },
  });
  if (!profile || profile.archivedAt) return null;
  if (profile.mergedIntoId) return describeProfileForEditorAction(profile.mergedIntoId);
  return {
    profileId: profile.id,
    code: profile.code,
    name: [profile.characterFirstName, profile.characterLastName].filter(Boolean).join(" "),
    gradeLabel: profile.rank?.label ?? null,
    classLabel: profile.ninjaClass?.label ?? null,
    originLabel: profile.faction?.name ?? null,
    lifeStatus: profile.lifeStatus,
  };
}

// ── Resynchronisation explicite des snapshots ───────────────────────────

export interface SnapshotDiff {
  linkId: string;
  profileCode: string;
  profileName: string;
  role: MissionProfileRole;
  gradeBefore: string | null;
  gradeAfter: string | null;
  factionBefore: string | null;
  factionAfter: string | null;
}

/**
 * Ce qui a changé dans les dossiers depuis la publication. La modération voit
 * l'écart AVANT de décider : une mission publiée ne se réécrit jamais en
 * silence.
 */
export async function missionSnapshotDiff(missionId: string): Promise<SnapshotDiff[]> {
  const links = await prisma.missionTarget.findMany({
    where: { missionId, profileId: { not: null } },
    select: {
      id: true,
      role: true,
      snapshotRankId: true,
      snapshotFactionId: true,
      snapshotRank: { select: { label: true } },
      snapshotFaction: { select: { name: true } },
      profile: {
        select: {
          code: true,
          characterFirstName: true,
          characterLastName: true,
          rankId: true,
          factionId: true,
          rank: { select: { label: true } },
          faction: { select: { name: true } },
        },
      },
    },
  });
  const diffs: SnapshotDiff[] = [];
  for (const link of links) {
    if (!link.profile) continue;
    const gradeChanged = link.snapshotRankId !== link.profile.rankId;
    const factionChanged = link.snapshotFactionId !== link.profile.factionId;
    if (!gradeChanged && !factionChanged) continue;
    diffs.push({
      linkId: link.id,
      profileCode: link.profile.code,
      profileName: [link.profile.characterFirstName, link.profile.characterLastName]
        .filter(Boolean)
        .join(" "),
      role: link.role as MissionProfileRole,
      gradeBefore: link.snapshotRank?.label ?? null,
      gradeAfter: link.profile.rank?.label ?? null,
      factionBefore: link.snapshotFaction?.name ?? null,
      factionAfter: link.profile.faction?.name ?? null,
    });
  }
  return diffs;
}

/** Applique les valeurs actuelles des dossiers à une mission publiée. */
export async function syncMissionSnapshotsAction(missionId: string): Promise<MissionEditorResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_UPDATE)) {
    return { ok: false, error: "Permission refusée." };
  }
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true, code: true, category: true, rank: true, rankModifier: true, originVisibility: true, titleAuto: true },
  });
  if (!mission) return { ok: false, error: "Mission introuvable." };

  await prisma.$transaction(async (tx) => {
    const links = await tx.missionTarget.findMany({
      where: { missionId, profileId: { not: null } },
      select: {
        id: true,
        role: true,
        profile: {
          select: {
            rankId: true, ninjaClassId: true, factionId: true,
            rank: { select: { label: true, order: true } },
            faction: { select: { name: true } },
          },
        },
      },
    });
    const targets: TitleTargetInput[] = [];
    for (const link of links) {
      if (!link.profile) continue;
      await tx.missionTarget.update({
        where: { id: link.id },
        data: {
          snapshotRankId: link.profile.rankId,
          snapshotClassId: link.profile.ninjaClassId,
          snapshotFactionId: link.profile.factionId,
          snapshotAt: new Date(),
        },
      });
      if (link.role === "TARGET") {
        targets.push({
          gradeLabel: link.profile.rank?.label ?? null,
          gradeOrder: link.profile.rank?.order ?? null,
          originLabel: link.profile.faction?.name ?? null,
        });
      }
    }
    // Le titre suit les snapshots — sauf s'il a été imposé à la main
    if (mission.titleAuto) {
      const { title } = generateMissionPublicTitle({
        category: mission.category,
        rank: mission.rank,
        rankModifier: mission.rankModifier,
        targets,
        originVisibility: mission.originVisibility,
      });
      await tx.mission.update({ where: { id: missionId }, data: { publicTitle: title } });
    }
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.snapshots_synced",
    resourceType: "mission",
    resourceId: missionId,
    newValues: { code: mission.code },
    ...meta,
  });
  revalidatePath(`/missions/${missionId}`);
  return { ok: true, missionId };
}

// ── Duplication ─────────────────────────────────────────────────────────

/**
 * Reprend une mission comme point de départ : même type, même rang, mêmes
 * consignes. Les PERSONNES ne suivent que si on le demande — deux contrats
 * qui se ressemblent visent rarement les mêmes gens.
 */
export async function duplicateMissionAction(input: {
  missionId: string;
  copyLinks: boolean;
}): Promise<MissionEditorResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.MISSION_CREATE)) {
    return { ok: false, error: "Permission refusée." };
  }
  const source = await prisma.mission.findUnique({
    where: { id: input.missionId },
    include: { visibility: true, targets: { where: { profileId: { not: null } } } },
  });
  if (!source) return { ok: false, error: "Mission introuvable." };

  let missionId = "";
  let code = "";
  await prisma.$transaction(async (tx) => {
    code = await nextMissionCode(tx, source.rank);
    const created = await tx.mission.create({
      data: {
        code,
        status: "DRAFT",
        rank: source.rank,
        rankModifier: source.rankModifier,
        category: source.category,
        publicTitle: source.publicTitle,
        titleAuto: source.titleAuto,
        originVisibility: source.originVisibility,
        publicSummary: source.publicSummary,
        confidentialDescription: source.confidentialDescription,
        primaryObjective: source.primaryObjective,
        secondaryObjectives: source.secondaryObjectives ?? undefined,
        location: source.location,
        constraints: source.constraints,
        prohibitions: source.prohibitions,
        evidence: source.evidence,
        soughtFieldKeys: source.soughtFieldKeys ?? undefined,
        internalTitle: source.internalTitle,
        moderatorNotes: source.moderatorNotes,
        rewardRyoMin: source.rewardRyoMin,
        rewardRyoMax: source.rewardRyoMax,
        basePoints: source.basePoints,
        minRecommendedLevelId: source.minRecommendedLevelId,
        groupSizeMin: source.groupSizeMin,
        groupSizeMax: source.groupSizeMax,
        eligibilityMode: source.eligibilityMode,
        requiresEnhancedReview: source.requiresEnhancedReview,
        creatorId: current.session.userId,
        responsibleModeratorId: current.session.userId,
        visibility: {
          create: {
            showCategory: source.visibility?.showCategory ?? true,
            showTargetLevel: source.visibility?.showTargetLevel ?? true,
            showSummary: source.visibility?.showSummary ?? true,
          },
        },
        // Le sort des cibles ne se recopie JAMAIS : la nouvelle mission n'a
        // encore rien constaté.
        ...(input.copyLinks && source.targets.length > 0
          ? {
              targets: {
                create: source.targets.map((t) => ({
                  profileId: t.profileId!,
                  role: t.role,
                  isPrimary: t.isPrimary,
                  snapshotRankId: t.snapshotRankId,
                  snapshotClassId: t.snapshotClassId,
                  snapshotFactionId: t.snapshotFactionId,
                  snapshotAt: new Date(),
                  createdById: current.session.userId,
                })),
              },
            }
          : {}),
      },
      select: { id: true },
    });
    missionId = created.id;
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "mission.duplicated",
    resourceType: "mission",
    resourceId: missionId,
    newValues: { code, from: source.code, copiedLinks: input.copyLinks },
    ...meta,
  });
  revalidatePath("/missions");
  return { ok: true, missionId };
}
