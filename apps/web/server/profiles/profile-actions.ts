"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { Prisma, ProfileKnowledgeState } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
  formatDossierTitle,
  formatProfileCode,
  normalizeRefLabel,
  profileQuickCreateSchema,
  profileUpdateSchema,
  techniqueCreateSchema,
  relationCreateSchema,
  purchaseRequestSchema,
  purchaseDecisionSchema,
  referenceSuggestionSchema,
  referenceOptionCreateSchema,
  PROFILE_FIELD_LABELS,
  TRAIT_FIELD_TO_TYPE,
  type ProfileFieldKey,
  type ProfileUpdateInput,
} from "@toile/shared";
import { requireUser, requestMeta } from "@/lib/session";
import { enqueueNotifications, userIdsWithPermission } from "@/server/notifications";
import { getProfileViewer, decideAccess, toAccessTarget, accessTargetSelect } from "./access";
import { findSimilarProfiles } from "./queries";
import { uploadProfileGalleryImageAction } from "./image-actions";
import { createOwnedProfile, createProfileRecord } from "./create";

export interface ProfileActionResult {
  ok: boolean;
  error?: string;
  profileId?: string;
  /** Doublons potentiels (création non bloquée : confirmer pour passer outre) */
  duplicates?: { id: string; code: string; name: string }[];
  /** Conflits détectés : le modérateur doit choisir une stratégie */
  conflicts?: { fieldKey: string; fieldLabel: string; currentValue: string; newValue: string }[];
  /** Avertissements non bloquants (artefact unique déjà porté…) */
  warnings?: string[];
  /**
   * Le dossier a été enregistré par quelqu'un d'autre depuis l'ouverture du
   * formulaire : l'écriture est refusée plutôt que d'écraser son travail.
   */
  staleVersion?: boolean;
}

async function guardManage() {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MANAGE)) return null;
  return current;
}

// ─────────────────────────────────────────────────────────────
// Création rapide (prénom seul)
// ─────────────────────────────────────────────────────────────

/**
 * Ouvre un dossier — pour tout membre d'un groupe actif, plus seulement la
 * modération. Un agent qui croise un inconnu en RP doit pouvoir ouvrir sa
 * fiche sur-le-champ, pour son groupe.
 *
 * Le groupe devient PROPRIÉTAIRE : il reçoit un octroi CREATED_BY_GROUP, si
 * bien que tous ses membres, présents et futurs, voient et complètent le
 * dossier. La personne qui a cliqué n'a aucun droit particulier — si elle
 * quitte le groupe, le dossier reste au groupe.
 */
export async function quickCreateProfileAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await requireUser();
  const viewer = await getProfileViewer(current);
  if (!viewer.canCreate) {
    return {
      ok: false,
      error:
        "Vous n'appartenez à aucun groupe : un dossier doit avoir un groupe propriétaire pour être vu et complété.",
    };
  }

  const parsed = profileQuickCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Prénom invalide." };
  }
  const firstName = parsed.data.firstName.replace(/\s+/g, " ");
  const lastName = parsed.data.lastName?.trim().replace(/\s+/g, " ") || null;

  // ── Groupe propriétaire ──
  // Un seul groupe : déduit. Plusieurs : le formulaire doit l'avoir demandé.
  // Modération : peut créer sans groupe (dossier de la Toile elle-même).
  let ownerGroupId: string | null = null;
  if (parsed.data.groupId) {
    if (!viewer.groupIds.includes(parsed.data.groupId) && !viewer.canManage) {
      return { ok: false, error: "Vous n'appartenez pas à ce groupe." };
    }
    ownerGroupId = parsed.data.groupId;
  } else if (viewer.groupIds.length === 1) {
    ownerGroupId = viewer.groupIds[0]!;
  } else if (viewer.groupIds.length > 1 && !viewer.canManage) {
    return { ok: false, error: "Précisez pour quel groupe vous ouvrez ce dossier." };
  }

  // Doublons potentiels : avertir sans bloquer. Pour un lecteur qui n'a pas
  // accès aux dossiers similaires, seuls code, titre, prénom et nom sont
  // révélés — exactement ce que la liste montre déjà à tous.
  if (!parsed.data.confirmDespiteDuplicates) {
    const similar = await findSimilarProfiles(firstName);
    if (similar.length > 0) {
      return {
        ok: false,
        duplicates: similar.map((p) => ({
          id: p.id,
          code: p.code,
          name: [p.characterFirstName, p.characterLastName].filter(Boolean).join(" "),
        })),
      };
    }
  }

  const title = parsed.data.title?.trim() || formatDossierTitle(firstName, lastName);

  const profile = await prisma.$transaction(async (tx) => {
    // Une seule voie de création (dossier + octroi CREATED_BY_GROUP + titre)
    const created = await createOwnedProfile(tx, {
      firstName,
      lastName,
      title,
      ownerGroupId,
      actorId: current.session.userId,
      sourceMissionId: parsed.data.sourceMissionId ?? null,
    });
    await tx.characterProfileRevision.create({
      data: {
        profileId: created.id,
        fieldKey: "profile",
        newValue: { created: true, firstName, lastName, title, groupId: ownerGroupId },
        changedById: current.session.userId,
        sourceMissionId: parsed.data.sourceMissionId ?? null,
      },
    });
    return created;
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.created",
    resourceType: "characterProfile",
    resourceId: profile.id,
    newValues: { code: profile.code, groupId: ownerGroupId },
    ...meta,
  });

  revalidatePath("/profils");
  return { ok: true, profileId: profile.id };
}

// ─────────────────────────────────────────────────────────────
// Mise à jour d'un dossier (avec états de connaissance et conflits)
// ─────────────────────────────────────────────────────────────

const SCALAR_CONFLICT_FIELDS: ProfileFieldKey[] = [
  "lastName", "sex", "height", "hairColor", "skinTone", "eyeColor", "ninjaClass", "faction", "rank", "lifeStatus",
];

export async function updateProfileAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await requireUser();

  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };
  }
  const input = parsed.data;

  const profile = await prisma.characterProfile.findUnique({
    where: { id: input.profileId },
    include: {
      accessGrants: accessTargetSelect.accessGrants,
      fieldIntel: true,
      traits: { include: { option: true } },
      hairColor: true,
      skinTone: true,
      eyeColor: true,
      eyeColorSecondary: true,
      ninjaClass: true,
      faction: { select: { name: true } },
      rank: { select: { label: true } },
    },
  });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };

  // Modération, ou groupe créateur : c'est la règle centrale qui tranche, la
  // même que celle de la page. Un acquéreur passe par une contribution, pas
  // par ici. Les notes internes, elles, restent à la modération seule.
  const viewer = await getProfileViewer(current);
  const access = decideAccess(viewer, toAccessTarget(profile));
  if (!access.canEdit) {
    return { ok: false, error: "Seuls la modération et le groupe créateur peuvent modifier ce dossier." };
  }
  if (input.internalNotes !== undefined && !access.canAdminister) {
    return { ok: false, error: "Les notes internes sont réservées à la modération." };
  }

  // Verrouillage optimiste : le formulaire renvoie la version qu'il a chargée.
  // Sans ce contrôle, deux modérateurs complétant le même dossier pendant la
  // même session RP s'écrasent l'un l'autre en silence. Le test précoce donne
  // un message clair ; la garde atomique à l'écriture (plus bas) traite la
  // course où l'autre enregistrement tombe pendant ce traitement.
  if (input.version !== undefined && input.version !== profile.version) {
    return {
      ok: false,
      staleVersion: true,
      error:
        "Ce dossier a été enregistré par quelqu'un d'autre depuis que vous l'avez ouvert. " +
        "Rechargez pour repartir de la version à jour — votre saisie n'a pas été appliquée.",
    };
  }

  const intelByKey = new Map(profile.fieldIntel.map((row) => [row.fieldKey, row]));
  const now = new Date();
  const warnings: string[] = [];
  const conflicts: NonNullable<ProfileActionResult["conflicts"]> = [];

  // Valeurs scalaires actuelles/nouvelles (libellés pour l'écran de conflit)
  const currentScalarLabel: Record<string, string> = {
    lastName: profile.characterLastName ?? "",
    sex: profile.sexCode ?? "",
    height: [profile.heightMinCm, profile.heightMaxCm].filter((v) => v != null).join("–"),
    hairColor: profile.hairColor?.label ?? "",
    skinTone: profile.skinTone?.label ?? "",
    eyeColor: profile.eyeColor
      ? [profile.eyeColor.label, profile.eyeColorSecondary?.label].filter(Boolean).join(" / ")
      : "",
    ninjaClass: profile.ninjaClass?.label ?? "",
    faction: profile.faction?.name ?? "",
    rank: profile.rank?.label ?? "",
    lifeStatus: profile.lifeStatus ?? "",
  };

  const provided: Partial<Record<ProfileFieldKey, { newLabel: string; changed: boolean }>> = {};
  const has = (key: keyof ProfileUpdateInput) => input[key] !== undefined;

  if (has("lastName")) provided.lastName = { newLabel: input.lastName ?? "", changed: (input.lastName ?? null) !== profile.characterLastName };
  if (has("sexCode")) provided.sex = { newLabel: input.sexCode ?? "", changed: (input.sexCode ?? null) !== profile.sexCode };
  if (has("heightMinCm") || has("heightMaxCm")) {
    const label = [input.heightMinCm, input.heightMaxCm].filter((v) => v != null).join("–");
    provided.height = {
      newLabel: label,
      changed:
        (input.heightMinCm ?? null) !== profile.heightMinCm ||
        (input.heightMaxCm ?? null) !== profile.heightMaxCm,
    };
  }
  if (has("hairColorId")) provided.hairColor = { newLabel: input.hairColorId ?? "", changed: (input.hairColorId ?? null) !== profile.hairColorId };
  if (has("skinToneId")) provided.skinTone = { newLabel: input.skinToneId ?? "", changed: (input.skinToneId ?? null) !== profile.skinToneId };
  if (has("eyeColorId") || has("eyeColorSecondaryId")) {
    // Les deux iris forment UN champ : changer l'un ou l'autre change le champ.
    const nextPrimary = has("eyeColorId") ? (input.eyeColorId ?? null) : profile.eyeColorId;
    const nextSecondary = has("eyeColorSecondaryId") ? (input.eyeColorSecondaryId ?? null) : profile.eyeColorSecondaryId;
    provided.eyeColor = {
      newLabel: [nextPrimary, nextSecondary].filter(Boolean).join(" / "),
      changed: nextPrimary !== profile.eyeColorId || nextSecondary !== profile.eyeColorSecondaryId,
    };
  }
  if (has("ninjaClassId")) provided.ninjaClass = { newLabel: input.ninjaClassId ?? "", changed: (input.ninjaClassId ?? null) !== profile.ninjaClassId };
  if (has("factionId")) provided.faction = { newLabel: input.factionId ?? "", changed: (input.factionId ?? null) !== profile.factionId };
  if (has("rankId")) provided.rank = { newLabel: input.rankId ?? "", changed: (input.rankId ?? null) !== profile.rankId };
  if (has("lifeStatus")) provided.lifeStatus = { newLabel: input.lifeStatus ?? "", changed: (input.lifeStatus ?? null) !== profile.lifeStatus };

  // Détection de conflit : l'information actuelle est CONNUE, la nouvelle
  // valeur diffère, et aucune stratégie n'a été choisie → on demande.
  for (const key of SCALAR_CONFLICT_FIELDS) {
    const change = provided[key];
    if (!change?.changed) continue;
    const intel = intelByKey.get(key);
    const currentlyKnown =
      (intel?.knowledgeState ?? (currentScalarLabel[key] ? "KNOWN" : "UNKNOWN")) === "KNOWN" &&
      currentScalarLabel[key] !== "";
    if (currentlyKnown && !input.conflictStrategy) {
      conflicts.push({
        fieldKey: key,
        fieldLabel: PROFILE_FIELD_LABELS[key],
        currentValue: currentScalarLabel[key] ?? "",
        newValue: change.newLabel,
      });
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, conflicts };
  }
  const strategy = input.conflictStrategy ?? "REPLACE";

  // « Aucun Subjutsu » alors que le dossier en liste : on ne supprime rien —
  // ces fiches sont trop riches pour partir sur un choix de liste déroulante —
  // mais on signale la contradiction plutôt que de l'enregistrer en silence.
  if (input.fieldStates?.techniques === "NONE_CONFIRMED") {
    const owned = await prisma.characterSignatureTechnique.count({
      where: { profileId: profile.id },
    });
    if (owned > 0) {
      warnings.push(
        `Le dossier déclare « aucune technique propre » alors qu'il en liste ${owned}. ` +
          "Retirez-les depuis la page du dossier, ou choisissez un autre état.",
      );
    }
  }

  // Artefacts uniques : avertir si déjà portés par un autre personnage vivant
  if (input.artifactIds && input.artifactIds.length > 0) {
    const uniqueArtifacts = await prisma.profileReferenceOption.findMany({
      where: { id: { in: input.artifactIds }, isUnique: true },
      select: { id: true, label: true },
    });
    for (const artifact of uniqueArtifacts) {
      const holder = await prisma.characterProfileTrait.findFirst({
        where: {
          optionId: artifact.id,
          profileId: { not: profile.id },
          profile: { archivedAt: null, lifeStatus: { not: "DEAD" } },
        },
        include: { profile: { select: { code: true, characterFirstName: true } } },
      });
      if (holder) {
        warnings.push(
          `${artifact.label} est déjà attribué à ${holder.profile.code} — ${holder.profile.characterFirstName}. ` +
            "Copie, faux ou possession incertaine ? Vous pouvez marquer le champ comme contradictoire.",
        );
      }
    }
  }

  const revisions: Prisma.CharacterProfileRevisionCreateManyInput[] = [];
  // dedupeIntel conserve la DERNIÈRE entrée d'un même champ : l'ordre compte.
  // 1) états explicites du formulaire, 2) décisions de conflit (prioritaires).
  const intelUpserts: { fieldKey: string; state: ProfileKnowledgeState }[] = [];
  const conflictResolved = new Set<string>();
  const data: Prisma.CharacterProfileUncheckedUpdateInput = {
    updatedById: current.session.userId,
    version: { increment: 1 },
  };

  const applyScalar = (
    key: ProfileFieldKey,
    dbAssign: () => void,
    oldValue: unknown,
    newValue: unknown,
  ) => {
    const change = provided[key];
    if (!change) return;
    if (change.changed && strategy === "KEEP") {
      // On conserve l'ancienne valeur ; la nouvelle info reste tracée
      revisions.push({
        profileId: profile.id,
        fieldKey: key,
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
        changedById: current.session.userId,
        sourceMissionId: input.sourceMissionId ?? null,
        confidence: input.confidence ?? null,
        justification: `${input.justification ?? ""} [ancienne valeur conservée]`.trim(),
      });
      return;
    }
    if (change.changed && strategy === "MARK_CONFLICTING") {
      // La contradiction prime sur l'état affiché dans le formulaire
      conflictResolved.add(key);
      intelUpserts.push({ fieldKey: key, state: "CONFLICTING" });
      revisions.push({
        profileId: profile.id,
        fieldKey: key,
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
        changedById: current.session.userId,
        sourceMissionId: input.sourceMissionId ?? null,
        confidence: input.confidence ?? null,
        justification: `${input.justification ?? ""} [marqué contradictoire]`.trim(),
      });
      return;
    }
    dbAssign();
    if (change.changed) {
      intelUpserts.push({ fieldKey: key, state: "KNOWN" });
      revisions.push({
        profileId: profile.id,
        fieldKey: key,
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
        changedById: current.session.userId,
        sourceMissionId: input.sourceMissionId ?? null,
        confidence: input.confidence ?? null,
        justification: input.justification ?? null,
      });
    }
  };

  applyScalar("lastName", () => { data.characterLastName = input.lastName ?? null; }, profile.characterLastName, input.lastName ?? null);
  applyScalar("sex", () => { data.sexCode = input.sexCode ?? null; }, profile.sexCode, input.sexCode ?? null);
  applyScalar("height", () => {
    if (has("heightMinCm")) data.heightMinCm = input.heightMinCm ?? null;
    if (has("heightMaxCm")) data.heightMaxCm = input.heightMaxCm ?? null;
  }, { min: profile.heightMinCm, max: profile.heightMaxCm }, { min: input.heightMinCm ?? null, max: input.heightMaxCm ?? null });
  applyScalar("hairColor", () => { data.hairColorId = input.hairColorId ?? null; }, profile.hairColorId, input.hairColorId ?? null);
  applyScalar("skinTone", () => { data.skinToneId = input.skinToneId ?? null; }, profile.skinToneId, input.skinToneId ?? null);
  applyScalar("eyeColor", () => {
    if (has("eyeColorId")) data.eyeColorId = input.eyeColorId ?? null;
    if (has("eyeColorSecondaryId")) data.eyeColorSecondaryId = input.eyeColorSecondaryId ?? null;
    // Pas de second œil sans premier — la contrainte SQL le refuserait de
    // toute façon, mais on ne veut pas d'une erreur 500 pour une case oubliée.
    const primaryAfter = has("eyeColorId") ? (input.eyeColorId ?? null) : profile.eyeColorId;
    if (!primaryAfter) data.eyeColorSecondaryId = null;
  }, { primary: profile.eyeColorId, secondary: profile.eyeColorSecondaryId },
     { primary: input.eyeColorId ?? null, secondary: input.eyeColorSecondaryId ?? null });
  applyScalar("ninjaClass", () => { data.ninjaClassId = input.ninjaClassId ?? null; }, profile.ninjaClassId, input.ninjaClassId ?? null);
  applyScalar("faction", () => { data.factionId = input.factionId ?? null; }, profile.factionId, input.factionId ?? null);
  applyScalar("rank", () => { data.rankId = input.rankId ?? null; }, profile.rankId, input.rankId ?? null);
  applyScalar("lifeStatus", () => {
    data.lifeStatus = input.lifeStatus ?? null;
    data.statusChangedRealAt = now;
    if (input.lifeStatus === "DEAD" && input.deathNow !== false) data.deathRealAt = profile.deathRealAt ?? now;
    if (input.lifeStatus === "MISSING") data.missingSinceRealAt = profile.missingSinceRealAt ?? now;
  }, profile.lifeStatus, input.lifeStatus ?? null);

  if (has("firstName") && input.firstName && input.firstName !== profile.characterFirstName) {
    data.characterFirstName = input.firstName;
    data.firstNameNorm = normalizeRefLabel(input.firstName);
    revisions.push({
      profileId: profile.id,
      fieldKey: "firstName",
      oldValue: profile.characterFirstName,
      newValue: input.firstName,
      changedById: current.session.userId,
      justification: input.justification ?? null,
    });
  }

  // Âge : la référence temporelle est TOUJOURS « maintenant » côté serveur
  if (has("ageMode")) {
    data.ageMode = input.ageMode!;
    if (input.ageMode === "AGE_AT_REFERENCE" && input.ageYearsNow != null) {
      data.ageYearsAtRef = input.ageYearsNow;
      data.ageReferenceRealAt = now;
      data.ageMinAtRef = null;
      data.ageMaxAtRef = null;
    } else if (
      input.ageMode === "AGE_RANGE_AT_REFERENCE" &&
      input.ageMinNow != null &&
      input.ageMaxNow != null
    ) {
      data.ageMinAtRef = input.ageMinNow;
      data.ageMaxAtRef = input.ageMaxNow;
      data.ageReferenceRealAt = now;
      data.ageYearsAtRef = null;
    } else if (input.ageMode === "UNKNOWN") {
      data.ageYearsAtRef = null;
      data.ageMinAtRef = null;
      data.ageMaxAtRef = null;
      data.ageReferenceRealAt = null;
    }
    intelUpserts.push({ fieldKey: "age", state: input.ageMode === "UNKNOWN" ? "UNKNOWN" : "KNOWN" });
    revisions.push({
      profileId: profile.id,
      fieldKey: "age",
      oldValue: { mode: profile.ageMode, years: profile.ageYearsAtRef, min: profile.ageMinAtRef, max: profile.ageMaxAtRef },
      newValue: { mode: input.ageMode, years: input.ageYearsNow ?? null, min: input.ageMinNow ?? null, max: input.ageMaxNow ?? null },
      changedById: current.session.userId,
      sourceMissionId: input.sourceMissionId ?? null,
      confidence: input.confidence ?? null,
      justification: input.justification ?? null,
    });
  }

  // Textes d'analyse + notes internes
  const applyText = (key: ProfileFieldKey & ("details" | "strengths" | "weaknesses"), value: string | null | undefined) => {
    if (value === undefined) return;
    const old = profile[key];
    if ((value ?? null) === old) return;
    data[key] = value ?? null;
    intelUpserts.push({ fieldKey: key, state: value ? "KNOWN" : "UNKNOWN" });
    revisions.push({
      profileId: profile.id,
      fieldKey: key,
      oldValue: (old ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (value ?? undefined) as Prisma.InputJsonValue | undefined,
      changedById: current.session.userId,
      sourceMissionId: input.sourceMissionId ?? null,
      confidence: input.confidence ?? null,
      justification: input.justification ?? null,
    });
  };
  applyText("details", input.details);
  applyText("strengths", input.strengths);
  applyText("weaknesses", input.weaknesses);
  if (input.internalNotes !== undefined) data.internalNotes = input.internalNotes ?? null;

  // Traits par référentiel : la liste fournie REMPLACE la liste du type
  const traitPlans: { fieldKey: ProfileFieldKey; refType: string; ids: string[] }[] = [];
  const traitInputs: [ProfileFieldKey, string[] | undefined][] = [
    ["clans", input.clanIds],
    ["chakraNatures", input.chakraNatureIds],
    ["kekkeiGenkai", input.kekkeiGenkaiIds],
    ["clanTechniques", input.clanTechniqueIds],
    ["signatureTechniques", input.signatureTechniqueIds],
    ["combatStyles", input.combatStyleIds],
    ["kenjutsuStyles", input.kenjutsuStyleIds],
    ["artifacts", input.artifactIds],
  ];
  for (const [fieldKey, ids] of traitInputs) {
    if (ids === undefined) continue;
    const refType = TRAIT_FIELD_TO_TYPE[fieldKey]!;
    const currentIds = profile.traits
      .filter((t) => t.option.type === refType)
      .map((t) => t.optionId)
      .sort();
    const nextIds = [...new Set(ids)].sort();
    if (JSON.stringify(currentIds) !== JSON.stringify(nextIds)) {
      traitPlans.push({ fieldKey, refType, ids: nextIds });
      revisions.push({
        profileId: profile.id,
        fieldKey,
        oldValue: currentIds,
        newValue: nextIds,
        changedById: current.session.userId,
        sourceMissionId: input.sourceMissionId ?? null,
        confidence: input.confidence ?? null,
        justification: input.justification ?? null,
      });
      if (!input.fieldStates?.[fieldKey]) {
        intelUpserts.push({ fieldKey, state: nextIds.length > 0 ? "KNOWN" : "UNKNOWN" });
      }
    }
  }

  // États explicites choisis par le modérateur (Inconnu / Connue / Aucun /
  // Contradictoire). Un champ dont le conflit vient d'être arbitré garde la
  // décision d'arbitrage — elle est plus récente que l'état affiché.
  for (const [fieldKey, state] of Object.entries(input.fieldStates ?? {})) {
    if (conflictResolved.has(fieldKey)) continue;
    intelUpserts.push({ fieldKey, state: state as ProfileKnowledgeState });
    if (state === "UNKNOWN" || state === "NONE_CONFIRMED") {
      // Une absence confirmée ou une inconnue ne conserve pas de valeur
      const traitField = TRAIT_FIELD_TO_TYPE[fieldKey as ProfileFieldKey];
      if (traitField) traitPlans.push({ fieldKey: fieldKey as ProfileFieldKey, refType: traitField, ids: [] });
      if (fieldKey === "lastName") data.characterLastName = null;
      if (fieldKey === "sex") data.sexCode = null;
      if (fieldKey === "height") { data.heightMinCm = null; data.heightMaxCm = null; }
      if (fieldKey === "hairColor") data.hairColorId = null;
      if (fieldKey === "skinTone") data.skinToneId = null;
      if (fieldKey === "eyeColor") { data.eyeColorId = null; data.eyeColorSecondaryId = null; }
      if (fieldKey === "ninjaClass") data.ninjaClassId = null;
      if (fieldKey === "faction") data.factionId = null;
      if (fieldKey === "rank") data.rankId = null;
      if (fieldKey === "lifeStatus") data.lifeStatus = null;
    }
  }

  try {
  await prisma.$transaction(async (tx) => {
    // Garde atomique du verrouillage optimiste : l'écriture n'a lieu que si la
    // version n'a pas bougé entre la lecture plus haut et cet instant. Le test
    // précoce ne suffit pas — un autre enregistrement peut tomber entre les
    // deux, et c'est précisément la course que ce verrou doit couvrir.
    const applied = await tx.characterProfile.updateMany({
      where: {
        id: profile.id,
        ...(input.version !== undefined ? { version: input.version } : {}),
      },
      data,
    });
    if (applied.count !== 1) throw new Error("STALE_VERSION");
    for (const plan of traitPlans) {
      await tx.characterProfileTrait.deleteMany({
        where: { profileId: profile.id, option: { type: plan.refType } },
      });
      if (plan.ids.length > 0) {
        await tx.characterProfileTrait.createMany({
          data: plan.ids.map((optionId) => ({
            profileId: profile.id,
            optionId,
            addedById: current.session.userId,
          })),
          skipDuplicates: true,
        });
      }
    }
    for (const upsert of dedupeIntel(intelUpserts)) {
      await tx.characterFieldIntel.upsert({
        where: { profileId_fieldKey: { profileId: profile.id, fieldKey: upsert.fieldKey } },
        update: {
          knowledgeState: upsert.state,
          confidence: input.confidence ?? undefined,
          sourceMissionId: input.sourceMissionId !== undefined ? input.sourceMissionId : undefined,
          sourceNote: input.justification ?? undefined,
          observedAtRp: input.observedAtRp ?? undefined,
          updatedById: current.session.userId,
        },
        create: {
          profileId: profile.id,
          fieldKey: upsert.fieldKey,
          knowledgeState: upsert.state,
          confidence: input.confidence ?? null,
          sourceMissionId: input.sourceMissionId ?? null,
          sourceNote: input.justification ?? null,
          observedAtRp: input.observedAtRp ?? null,
          updatedById: current.session.userId,
        },
      });
    }
    if (revisions.length > 0) {
      await tx.characterProfileRevision.createMany({ data: revisions });
    }
  });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_VERSION") {
      // La transaction est annulée : rien n'a été écrit, le travail de
      // l'autre modérateur est intact.
      return {
        ok: false,
        staleVersion: true,
        error:
          "Ce dossier vient d'être enregistré par quelqu'un d'autre. " +
          "Rechargez pour repartir de la version à jour — votre saisie n'a pas été appliquée.",
      };
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.updated",
    resourceType: "characterProfile",
    resourceId: profile.id,
    newValues: { fields: revisions.map((r) => r.fieldKey), strategy },
    reason: input.justification,
    ...meta,
  });

  revalidatePath(`/profils/${profile.id}`);
  revalidatePath("/profils");
  return { ok: true, profileId: profile.id, warnings: warnings.length ? warnings : undefined };
}

function dedupeIntel(rows: { fieldKey: string; state: ProfileKnowledgeState }[]) {
  const map = new Map<string, ProfileKnowledgeState>();
  for (const row of rows) map.set(row.fieldKey, row.state);
  return [...map.entries()].map(([fieldKey, state]) => ({ fieldKey, state }));
}

// ─────────────────────────────────────────────────────────────
// Techniques propres
// ─────────────────────────────────────────────────────────────

export async function addTechniqueAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };
  const parsed = techniqueCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };

  const technique = await prisma.characterSignatureTechnique.create({
    data: {
      profileId: parsed.data.profileId,
      name: parsed.data.name,
      shortDescription: parsed.data.shortDescription ?? null,
      jutsuTypeId: parsed.data.jutsuTypeId ?? null,
      rank: parsed.data.rank ?? null,
      confidence: parsed.data.confidence ?? null,
      sourceMissionId: parsed.data.sourceMissionId ?? null,
      createdById: current.session.userId,
    },
  });
  await prisma.characterFieldIntel.upsert({
    where: { profileId_fieldKey: { profileId: parsed.data.profileId, fieldKey: "techniques" } },
    update: { knowledgeState: "KNOWN", updatedById: current.session.userId },
    create: { profileId: parsed.data.profileId, fieldKey: "techniques", knowledgeState: "KNOWN", updatedById: current.session.userId },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.technique_added",
    resourceType: "characterProfile",
    resourceId: parsed.data.profileId,
    newValues: { techniqueId: technique.id, name: parsed.data.name },
    ...meta,
  });
  revalidatePath(`/profils/${parsed.data.profileId}`);
  return { ok: true };
}

export async function deleteTechniqueAction(techniqueId: string): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };
  const technique = await prisma.characterSignatureTechnique.delete({ where: { id: techniqueId } });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.technique_removed",
    resourceType: "characterProfile",
    resourceId: technique.profileId,
    oldValues: { name: technique.name },
    ...meta,
  });
  revalidatePath(`/profils/${technique.profileId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Relations (forme canonique, inverses dérivées à la lecture)
// ─────────────────────────────────────────────────────────────

export async function addRelationAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };
  const parsed = relationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };
  const input = parsed.data;

  let relatedId = input.relatedProfileId ?? null;
  try {
    await prisma.$transaction(async (tx) => {
      if (!relatedId && input.newRelatedFirstName) {
        // Création rapide d'un dossier minimal lié (prénom seul). Il hérite du
        // groupe propriétaire du dossier d'origine : un proche ouvert depuis
        // la fiche des Crocs de Fer est un dossier des Crocs de Fer.
        const parent = await tx.characterProfile.findUnique({
          where: { id: input.profileId },
          select: { createdByGroupId: true },
        });
        const firstName = input.newRelatedFirstName.replace(/\s+/g, " ");
        const minimal = await createProfileRecord(tx, {
          characterFirstName: firstName,
          firstNameNorm: normalizeRefLabel(firstName),
          title: formatDossierTitle(firstName),
          createdById: current.session.userId,
          createdByGroupId: parent?.createdByGroupId ?? null,
        });
        if (parent?.createdByGroupId) {
          await tx.profileAccessGrant.create({
            data: {
              profileId: minimal.id,
              groupId: parent.createdByGroupId,
              grantedById: current.session.userId,
              sourceType: "CREATED_BY_GROUP",
            },
          });
        }
        relatedId = minimal.id;
      }
      if (!relatedId) throw new Error("NO_TARGET");
      if (relatedId === input.profileId) throw new Error("SELF");

      // Canonisation : PARENT/CREATOR gardent le sens ; CHILD/CREATION
      // inversent ; SIBLING est ordonné (petit id d'abord) pour l'unicité.
      let fromId = input.profileId;
      let toId = relatedId;
      let type: "PARENT_OF" | "CREATOR_OF" | "SIBLING_OF";
      switch (input.uiType) {
        case "PARENT_OF": type = "PARENT_OF"; break;
        case "CHILD_OF": type = "PARENT_OF"; [fromId, toId] = [toId, fromId]; break;
        case "CREATOR_OF": type = "CREATOR_OF"; break;
        case "CREATION_OF": type = "CREATOR_OF"; [fromId, toId] = [toId, fromId]; break;
        case "SIBLING_OF":
          type = "SIBLING_OF";
          if (fromId > toId) [fromId, toId] = [toId, fromId];
          break;
      }
      const existing = await tx.characterRelationship.findUnique({
        where: { fromProfileId_toProfileId_type: { fromProfileId: fromId, toProfileId: toId, type } },
      });
      if (existing) throw new Error("DUPLICATE");
      await tx.characterRelationship.create({
        data: {
          fromProfileId: fromId,
          toProfileId: toId,
          type,
          note: input.note ?? null,
          createdById: current.session.userId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "SELF") {
        return { ok: false, error: "Un profil ne peut pas être lié à lui-même." };
      }
      if (error.message === "DUPLICATE") {
        return { ok: false, error: "Cette relation existe déjà." };
      }
      if (error.message === "NO_TARGET") {
        return { ok: false, error: "Choisissez un profil existant ou saisissez un prénom." };
      }
    }
    throw error;
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.relation_added",
    resourceType: "characterProfile",
    resourceId: input.profileId,
    newValues: { uiType: input.uiType, relatedId },
    ...meta,
  });

  revalidatePath(`/profils/${input.profileId}`);
  return { ok: true };
}

export async function deleteRelationAction(relationId: string): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };
  const relation = await prisma.characterRelationship.delete({ where: { id: relationId } });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.relation_removed",
    resourceType: "characterProfile",
    resourceId: relation.fromProfileId,
    oldValues: { type: relation.type, toProfileId: relation.toProfileId },
    ...meta,
  });
  revalidatePath(`/profils/${relation.fromProfileId}`);
  revalidatePath(`/profils/${relation.toProfileId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Demandes d'achat et octrois d'accès
// ─────────────────────────────────────────────────────────────

export async function requestProfileAccessAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_REQUEST_CREATE)) {
    return { ok: false, error: "Seuls les chefs de groupe peuvent demander un accès." };
  }
  const parsed = purchaseRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const input = parsed.data;

  // Le chef ne demande que pour un groupe QU'IL dirige
  const viewer = await getProfileViewer(current);
  if (!viewer.ledGroupIds.includes(input.groupId)) {
    return { ok: false, error: "Vous ne dirigez pas ce groupe." };
  }
  const activeGrant = await prisma.profileAccessGrant.findFirst({
    where: { profileId: input.profileId, groupId: input.groupId, revokedAt: null },
  });
  if (activeGrant) return { ok: false, error: "Votre groupe possède déjà ce dossier." };

  const profile = await prisma.characterProfile.findUnique({
    where: { id: input.profileId },
    select: { id: true, code: true, characterFirstName: true, archivedAt: true, createdByGroupId: true },
  });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };
  if (profile.createdByGroupId === input.groupId) {
    return { ok: false, error: "Votre groupe a ouvert ce dossier : il le possède déjà." };
  }

  try {
    await prisma.profilePurchaseRequest.create({
      data: {
        profileId: input.profileId,
        groupId: input.groupId,
        requestedById: current.session.userId,
        message: input.message ?? null,
      },
    });
  } catch {
    // index partiel : une demande PENDING existe déjà
    return { ok: false, error: "Une demande est déjà en attente pour ce groupe." };
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.request_created",
    resourceType: "characterProfile",
    resourceId: input.profileId,
    newValues: { groupId: input.groupId },
    ...meta,
  });
  const group = await prisma.group.findUnique({ where: { id: input.groupId }, select: { name: true } });
  const moderators = await userIdsWithPermission(PERMISSIONS.PROFILE_PURCHASE_REVIEW);
  await enqueueNotifications({
    userIds: moderators.filter((id) => id !== current.session.userId),
    event: "PROFILE_REQUEST_CREATED",
    payload: {
      code: profile.code,
      title: profile.characterFirstName,
      groupName: group?.name ?? "",
      requester: current.session.user.displayName,
    },
    batchKey: `profile-req:${profile.id}`,
  });

  revalidatePath(`/profils/${input.profileId}`);
  revalidatePath("/profils/demandes");
  return { ok: true };
}

export async function decidePurchaseAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_PURCHASE_REVIEW)) {
    return { ok: false, error: "Permission refusée." };
  }
  const parsed = purchaseDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const { requestId, decision, priceRyos, moderatorResponse } = parsed.data;

  const request = await prisma.profilePurchaseRequest.findUnique({
    where: { id: requestId },
    include: {
      profile: { select: { id: true, code: true, characterFirstName: true } },
      group: { select: { id: true, name: true, isActive: true } },
    },
  });
  if (!request || request.status !== "PENDING") {
    return { ok: false, error: "Demande introuvable ou déjà traitée." };
  }
  if (decision === "APPROVED" && !request.group.isActive) {
    return { ok: false, error: "Ce groupe n'est plus actif." };
  }

  // Transaction : décision + octroi. L'index partiel interdit un double octroi.
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.profilePurchaseRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: {
          status: decision,
          priceRyos: priceRyos ?? null,
          moderatorResponse: moderatorResponse ?? null,
          reviewedById: current.session.userId,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) throw new Error("CONCURRENT");
      if (decision === "APPROVED") {
        await tx.profileAccessGrant.create({
          data: {
            profileId: request.profileId,
            groupId: request.groupId,
            grantedById: current.session.userId,
            requestId,
            priceRyos: priceRyos ?? null,
            sourceType: "PURCHASED",
            sourceId: requestId,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT") {
      return { ok: false, error: "La demande vient d'être traitée par quelqu'un d'autre." };
    }
    return { ok: false, error: "Un accès actif existe déjà pour ce groupe." };
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: decision === "APPROVED" ? "profile.access_granted" : "profile.request_refused",
    resourceType: "characterProfile",
    resourceId: request.profileId,
    newValues: { groupId: request.groupId, priceRyos: priceRyos ?? null },
    reason: moderatorResponse,
    ...meta,
  });
  await enqueueNotifications({
    userIds: [request.requestedById],
    event: decision === "APPROVED" ? "PROFILE_REQUEST_APPROVED" : "PROFILE_REQUEST_REFUSED",
    payload: {
      code: request.profile.code,
      title: request.profile.characterFirstName,
      note: moderatorResponse ?? null,
      priceRyos: priceRyos ?? null,
    },
  });

  revalidatePath("/profils/demandes");
  revalidatePath(`/profils/${request.profileId}`);
  revalidatePath("/profils");
  return { ok: true };
}

export async function revokeGrantAction(grantId: string): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_PURCHASE_REVIEW)) {
    return { ok: false, error: "Permission refusée." };
  }
  const grant = await prisma.profileAccessGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date(), revokedById: current.session.userId },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.access_revoked",
    resourceType: "characterProfile",
    resourceId: grant.profileId,
    oldValues: { groupId: grant.groupId },
    ...meta,
  });
  revalidatePath(`/profils/${grant.profileId}`);
  revalidatePath("/profils");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Suggestions de référentiel
// ─────────────────────────────────────────────────────────────

export async function suggestReferenceAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };
  const parsed = referenceSuggestionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };

  await prisma.profileReferenceSuggestion.create({
    data: {
      type: parsed.data.type,
      proposedLabel: parsed.data.proposedLabel,
      description: parsed.data.description ?? null,
      sourceUrl: parsed.data.sourceUrl || null,
      sourceScope: parsed.data.sourceScope,
      reason: parsed.data.reason ?? null,
      createdById: current.session.userId,
    },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.reference_suggested",
    newValues: { type: parsed.data.type, label: parsed.data.proposedLabel },
    ...meta,
  });
  revalidatePath("/admin/referentiels");
  return { ok: true };
}

export async function reviewSuggestionAction(input: {
  suggestionId: string;
  decision: "APPROVED" | "REJECTED" | "MERGED";
  mergedIntoId?: string;
  reviewNote?: string;
}): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE)) {
    return { ok: false, error: "Réservé aux super-modérateurs." };
  }
  const suggestion = await prisma.profileReferenceSuggestion.findUnique({
    where: { id: input.suggestionId },
  });
  if (!suggestion || suggestion.status !== "PENDING") {
    return { ok: false, error: "Suggestion introuvable ou déjà traitée." };
  }

  if (input.decision === "APPROVED") {
    const normalized = normalizeRefLabel(suggestion.proposedLabel);
    const duplicate = await prisma.profileReferenceOption.findUnique({
      where: { type_normalizedLabel: { type: suggestion.type, normalizedLabel: normalized } },
    });
    if (duplicate) {
      return { ok: false, error: `« ${duplicate.label} » existe déjà — utilisez la fusion.` };
    }
    await prisma.profileReferenceOption.create({
      data: {
        type: suggestion.type,
        code: normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40) || `OPT_${Date.now()}`,
        label: suggestion.proposedLabel,
        normalizedLabel: normalized,
        descriptionShort: suggestion.description,
        sourceUrl: suggestion.sourceUrl,
        sourceScope: suggestion.sourceScope,
        createdById: suggestion.createdById,
        approvedById: current.session.userId,
      },
    });
  }
  if (input.decision === "MERGED" && input.mergedIntoId) {
    // La proposition devient un alias de l'option existante
    const target = await prisma.profileReferenceOption.findUnique({ where: { id: input.mergedIntoId } });
    if (target && !target.aliases.includes(suggestion.proposedLabel)) {
      await prisma.profileReferenceOption.update({
        where: { id: target.id },
        data: { aliases: [...target.aliases, suggestion.proposedLabel] },
      });
    }
  }
  await prisma.profileReferenceSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: input.decision,
      reviewedById: current.session.userId,
      reviewNote: input.reviewNote ?? null,
      mergedIntoId: input.mergedIntoId ?? null,
      reviewedAt: new Date(),
    },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.reference_reviewed",
    newValues: { suggestionId: suggestion.id, decision: input.decision },
    ...meta,
  });
  revalidatePath("/admin/referentiels");
  return { ok: true };
}

/** Super-modérateurs : activer/désactiver une option de référentiel. */
export async function toggleReferenceOptionAction(input: {
  optionId: string;
  isActive: boolean;
}): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE)) {
    return { ok: false, error: "Réservé aux super-modérateurs." };
  }
  await prisma.profileReferenceOption.update({
    where: { id: input.optionId },
    data: { isActive: input.isActive },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.reference_toggled",
    resourceType: "referenceOption",
    resourceId: input.optionId,
    newValues: { isActive: input.isActive },
    ...meta,
  });
  revalidatePath("/admin/referentiels");
  return { ok: true };
}

/** Super-modérateurs : création directe d'une option. */
export async function createReferenceOptionAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE)) {
    return { ok: false, error: "Réservé aux super-modérateurs." };
  }
  const parsed = referenceSuggestionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };
  const normalized = normalizeRefLabel(parsed.data.proposedLabel);
  const duplicate = await prisma.profileReferenceOption.findUnique({
    where: { type_normalizedLabel: { type: parsed.data.type, normalizedLabel: normalized } },
  });
  if (duplicate) return { ok: false, error: `« ${duplicate.label} » existe déjà.` };

  await prisma.profileReferenceOption.create({
    data: {
      type: parsed.data.type,
      code: normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40) || `OPT_${Date.now()}`,
      label: parsed.data.proposedLabel,
      normalizedLabel: normalized,
      descriptionShort: parsed.data.description ?? null,
      sourceUrl: parsed.data.sourceUrl || null,
      sourceScope: parsed.data.sourceScope,
      createdById: current.session.userId,
      approvedById: current.session.userId,
    },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.reference_created",
    newValues: { type: parsed.data.type, label: parsed.data.proposedLabel },
    ...meta,
  });
  revalidatePath("/admin/referentiels");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Portrait
// ─────────────────────────────────────────────────────────────

/**
 * Téléversement du portrait : UNE seule voie d'écriture, la galerie. Le
 * fichier devient le portrait principal (type PORTRAIT). L'ancienne colonne
 * `imageData` n'est plus écrite — elle reste lue tant que des dossiers
 * antérieurs à la galerie n'ont pas de ProfileImage.
 */
export async function uploadProfileImageAction(formData: FormData): Promise<ProfileActionResult> {
  formData.set("type", "PORTRAIT");
  formData.set("primary", "true");
  const res = await uploadProfileGalleryImageAction(formData);
  return res.ok ? { ok: true, profileId: String(formData.get("profileId") ?? "") } : { ok: false, error: res.error };
}

// ─────────────────────────────────────────────────────────────
// Archivage et fusion (super-modérateurs)
// ─────────────────────────────────────────────────────────────

export async function archiveProfileAction(profileId: string): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MERGE)) {
    return { ok: false, error: "Réservé aux super-modérateurs." };
  }
  await prisma.characterProfile.update({
    where: { id: profileId },
    data: { archivedAt: new Date(), updatedById: current.session.userId },
  });
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.archived",
    resourceType: "characterProfile",
    resourceId: profileId,
    ...meta,
  });
  revalidatePath("/profils");
  return { ok: true };
}

/**
 * Suppression définitive d'un dossier — super-modérateurs uniquement.
 *
 * L'archivage reste la voie normale : il conserve l'historique et la
 * redirection des doublons. La suppression sert aux dossiers ouverts par
 * erreur. Les dépendances (renseignements, traits, techniques, relations,
 * révisions, demandes, accès) tombent en cascade ; seuls les doublons qui
 * redirigeaient ICI doivent être détachés d'abord, leur clé étrangère étant
 * restrictive — sinon la suppression échouerait.
 */
export async function deleteProfileAction(profileId: string): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MERGE)) {
    return { ok: false, error: "Seul un super-modérateur peut supprimer un dossier." };
  }
  const profile = await prisma.characterProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      code: true,
      characterFirstName: true,
      characterLastName: true,
      _count: {
        select: {
          // Un accès PAYÉ est une dette de la Toile envers un groupe : on ne
          // l'efface pas d'un clic. Idem pour une mission qui vise ce dossier —
          // la supprimer laisserait une cible fantôme sans nom.
          accessGrants: { where: { revokedAt: null, sourceType: "PURCHASED", priceRyos: { gt: 0 } } },
          targetedBy: true,
          missionsAsTarget: true,
          missionsAsClient: true,
        },
      },
    },
  });
  if (!profile) return { ok: false, error: "Dossier introuvable." };
  if (profile._count.accessGrants > 0) {
    return {
      ok: false,
      error:
        `${profile._count.accessGrants} groupe(s) ont acheté ce dossier. ` +
        "Révoquez ces accès (avec motif) ou archivez le dossier plutôt que de le supprimer.",
    };
  }
  if (profile._count.targetedBy + profile._count.missionsAsTarget + profile._count.missionsAsClient > 0) {
    return {
      ok: false,
      error:
        "Des missions visent ou citent ce dossier. Détachez-les, ou archivez le dossier : " +
        "la suppression laisserait des cibles sans nom.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.characterProfile.updateMany({
      where: { mergedIntoId: profileId },
      data: { mergedIntoId: null },
    });
    await tx.characterProfile.delete({ where: { id: profileId } });
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.deleted",
    resourceType: "characterProfile",
    resourceId: profileId,
    // Trace de ce qui a disparu : la suppression est irréversible
    oldValues: {
      code: profile.code,
      firstName: profile.characterFirstName,
      lastName: profile.characterLastName,
    },
    ...meta,
  });
  revalidatePath("/profils");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Référentiels : création directe
// ─────────────────────────────────────────────────────────────

/**
 * Ajout d'une entrée de référentiel DEPUIS un formulaire de dossier.
 *
 * Distincte de `createReferenceOptionAction` (page d'administration), qui est
 * volontairement stricte et refuse un libellé déjà pris. Ici la saisie est
 * incidente — on complète un dossier, pas un référentiel — donc l'action est
 * idempotente : une entrée existante est renvoyée telle quelle, et une entrée
 * désactivée réactivée. Elle retourne l'option pour que le sélecteur puisse
 * l'afficher sans recharger la page.
 *
 * Réservé à `profile.reference.manage` ; les autres rédacteurs proposent.
 */
export async function createInlineReferenceOptionAction(
  raw: unknown,
): Promise<ProfileActionResult & { option?: { id: string; label: string; colorHex: string | null } }> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE)) {
    return { ok: false, error: "Proposez cette entrée : sa validation revient à un super-modérateur." };
  }
  const parsed = referenceOptionCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Entrée invalide." };
  }
  const { type, label, sourceScope, colorHex } = parsed.data;
  const normalizedLabel = normalizeRefLabel(label);

  const existing = await prisma.profileReferenceOption.findUnique({
    where: { type_normalizedLabel: { type, normalizedLabel } },
    select: { id: true, label: true, colorHex: true, isActive: true },
  });
  if (existing) {
    // Une entrée désactivée est réactivée plutôt que dupliquée
    if (!existing.isActive) {
      await prisma.profileReferenceOption.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return { ok: true, option: { id: existing.id, label: existing.label, colorHex: existing.colorHex } };
  }

  // `code` est unique par type : dérivé du libellé, suffixé si déjà pris
  const base = normalizedLabel.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  let code = base || `OPT_${Date.now()}`;
  if (await prisma.profileReferenceOption.findUnique({ where: { type_code: { type, code } } })) {
    code = `${code}_${Date.now().toString(36).toUpperCase()}`;
  }

  const option = await prisma.profileReferenceOption.create({
    data: {
      type,
      code,
      label: label.replace(/\s+/g, " "),
      normalizedLabel,
      colorHex: colorHex ?? null,
      sourceScope,
      createdById: current.session.userId,
      approvedById: current.session.userId,
      // Après les entrées vérifiées, qui gardent leur ordre d'origine
      sortOrder: 500,
    },
    select: { id: true, label: true, colorHex: true },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.reference_created",
    resourceType: "profileReferenceOption",
    resourceId: option.id,
    newValues: { type, label: option.label, sourceScope },
    ...meta,
  });
  revalidatePath("/admin/referentiels");
  return { ok: true, option };
}

/**
 * Fusion de doublons : tout est déplacé vers le dossier cible (traits,
 * techniques, relations, renseignements, historiques, achats, demandes),
 * l'ancien code redirige, rien n'est perdu silencieusement.
 */
export async function mergeProfilesAction(input: {
  sourceId: string;
  targetId: string;
}): Promise<ProfileActionResult> {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MERGE)) {
    return { ok: false, error: "Réservé aux super-modérateurs." };
  }
  if (input.sourceId === input.targetId) return { ok: false, error: "Choisissez deux dossiers distincts." };

  const [source, target] = await Promise.all([
    prisma.characterProfile.findUnique({ where: { id: input.sourceId }, include: { traits: true, fieldIntel: true } }),
    prisma.characterProfile.findUnique({ where: { id: input.targetId } }),
  ]);
  if (!source || !target || target.archivedAt) return { ok: false, error: "Dossier introuvable." };

  await prisma.$transaction(async (tx) => {
    // Traits absents de la cible
    for (const trait of source.traits) {
      await tx.characterProfileTrait.upsert({
        where: { profileId_optionId: { profileId: target.id, optionId: trait.optionId } },
        update: {},
        create: { profileId: target.id, optionId: trait.optionId, addedById: trait.addedById },
      });
    }
    // Renseignements : ne pas écraser ceux de la cible
    for (const intel of source.fieldIntel) {
      const existing = await tx.characterFieldIntel.findUnique({
        where: { profileId_fieldKey: { profileId: target.id, fieldKey: intel.fieldKey } },
      });
      if (!existing) {
        await tx.characterFieldIntel.create({
          data: { ...intel, id: undefined, profileId: target.id } as never,
        });
      }
    }
    await tx.characterSignatureTechnique.updateMany({
      where: { profileId: source.id },
      data: { profileId: target.id },
    });
    await tx.characterProfileRevision.updateMany({
      where: { profileId: source.id },
      data: { profileId: target.id },
    });
    // Relations : rediriger UNE PAR UNE.
    //
    // Un `updateMany` en bloc violait `@@unique([fromProfileId, toProfileId,
    // type])` dès que la cible portait déjà la même relation (deux doublons
    // ont presque toujours des parents ou des frères communs — c'est même ce
    // qui les fait repérer). La fusion échouait alors sur un P2002 et toute la
    // transaction était perdue.
    const sourceRelations = await tx.characterRelationship.findMany({
      where: { OR: [{ fromProfileId: source.id }, { toProfileId: source.id }] },
    });
    for (const rel of sourceRelations) {
      let from = rel.fromProfileId === source.id ? target.id : rel.fromProfileId;
      let to = rel.toProfileId === source.id ? target.id : rel.toProfileId;

      // La relation liait les deux dossiers fusionnés : elle devient réflexive
      if (from === to) {
        await tx.characterRelationship.delete({ where: { id: rel.id } });
        continue;
      }
      // SIBLING_OF est stockée avec fromProfileId < toProfileId : la
      // redirection peut casser cet ordre, il faut le rétablir sans quoi la
      // même fratrie existerait sous deux formes.
      if (rel.type === "SIBLING_OF" && from > to) [from, to] = [to, from];

      const clash = await tx.characterRelationship.findFirst({
        where: { fromProfileId: from, toProfileId: to, type: rel.type, id: { not: rel.id } },
      });
      if (clash) {
        // La cible possède déjà ce lien : le doublon disparaît avec le dossier
        await tx.characterRelationship.delete({ where: { id: rel.id } });
      } else {
        await tx.characterRelationship.update({
          where: { id: rel.id },
          data: { fromProfileId: from, toProfileId: to },
        });
      }
    }
    // Achats et demandes suivent le dossier fusionné (doublons neutralisés)
    const sourceGrants = await tx.profileAccessGrant.findMany({ where: { profileId: source.id, revokedAt: null } });
    for (const grant of sourceGrants) {
      const dup = await tx.profileAccessGrant.findFirst({
        where: { profileId: target.id, groupId: grant.groupId, revokedAt: null },
      });
      if (dup) {
        await tx.profileAccessGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date(), revokedById: current.session.userId },
        });
      } else {
        await tx.profileAccessGrant.update({ where: { id: grant.id }, data: { profileId: target.id } });
      }
    }
    await tx.profileAccessGrant.updateMany({ where: { profileId: source.id }, data: { profileId: target.id } });
    await tx.profilePurchaseRequest.updateMany({
      where: { profileId: source.id, status: { not: "PENDING" } },
      data: { profileId: target.id },
    });
    const pendingDupes = await tx.profilePurchaseRequest.findMany({ where: { profileId: source.id, status: "PENDING" } });
    for (const pending of pendingDupes) {
      const clash = await tx.profilePurchaseRequest.findFirst({
        where: { profileId: target.id, groupId: pending.groupId, status: "PENDING" },
      });
      if (clash) {
        await tx.profilePurchaseRequest.update({ where: { id: pending.id }, data: { status: "CANCELLED" } });
      } else {
        await tx.profilePurchaseRequest.update({ where: { id: pending.id }, data: { profileId: target.id } });
      }
    }
    // ── Liens de mission ──
    // Les cibles et commanditaires qui désignaient la source doivent suivre :
    // sinon, à la clôture, `applyMissionOutcomeToProfiles` ignore le dossier
    // fusionné (archivé), la mort n'est jamais consignée dans le survivant et
    // les groupes qui ont fait le travail n'obtiennent pas l'accès. C'était un
    // trou silencieux — rien n'alertait.
    const sourceTargets = await tx.missionTarget.findMany({
      where: { profileId: source.id },
      select: { id: true, missionId: true },
    });
    for (const t of sourceTargets) {
      const clash = await tx.missionTarget.findFirst({
        where: { missionId: t.missionId, profileId: target.id, id: { not: t.id } },
        select: { id: true },
      });
      // La même mission visait déjà le survivant : la cible source est un
      // doublon, on la retire plutôt que de violer l'unicité (mission, dossier)
      if (clash) await tx.missionTarget.delete({ where: { id: t.id } });
      else await tx.missionTarget.update({ where: { id: t.id }, data: { profileId: target.id } });
    }
    await tx.mission.updateMany({
      where: { targetProfileId: source.id },
      data: { targetProfileId: target.id },
    });
    await tx.mission.updateMany({
      where: { clientProfileId: source.id },
      data: { clientProfileId: target.id },
    });

    // ── Galerie ──
    // Les images suivent le survivant ; si la cible a déjà un portrait
    // principal, celles de la source perdent ce statut (un seul portrait
    // vivant par dossier — l'index partiel le garantit).
    const targetHasPrimary = await tx.profileImage.count({
      where: { profileId: target.id, isPrimary: true, deletedAt: null },
    });
    const targetImageCount = await tx.profileImage.count({ where: { profileId: target.id, deletedAt: null } });
    if (targetHasPrimary > 0) {
      await tx.profileImage.updateMany({
        where: { profileId: source.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    const sourceImages = await tx.profileImage.findMany({
      where: { profileId: source.id },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    });
    for (const [i, img] of sourceImages.entries()) {
      await tx.profileImage.update({
        where: { id: img.id },
        data: { profileId: target.id, sortOrder: targetImageCount + i },
      });
    }
    // Le portrait d'origine (colonne) de la source n'est jamais perdu : s'il
    // existe et que la cible n'a rien, il devient une image de galerie.
    if (source.imageData && source.imageMime && targetHasPrimary === 0 && targetImageCount === 0 && sourceImages.length === 0) {
      await tx.profileImage.create({
        data: {
          profileId: target.id,
          imageData: source.imageData,
          imageMime: source.imageMime,
          sizeBytes: source.imageData.length,
          type: "PORTRAIT",
          isPrimary: true,
          uploadedById: current.session.userId,
        },
      });
    }

    // Le dossier source devient une redirection archivée
    await tx.characterProfile.update({
      where: { id: source.id },
      data: { mergedIntoId: target.id, archivedAt: new Date(), updatedById: current.session.userId },
    });
    await tx.characterProfileRevision.create({
      data: {
        profileId: target.id,
        fieldKey: "profile",
        newValue: { mergedFrom: source.code },
        changedById: current.session.userId,
        justification: "Fusion de doublons",
      },
    });
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.merged",
    resourceType: "characterProfile",
    resourceId: target.id,
    oldValues: { sourceCode: source.code },
    newValues: { targetCode: target.code },
    ...meta,
  });
  revalidatePath("/profils");
  revalidatePath(`/profils/${target.id}`);
  return { ok: true, profileId: target.id };
}
