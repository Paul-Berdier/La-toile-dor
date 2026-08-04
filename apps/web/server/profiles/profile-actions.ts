"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { Prisma, ProfileKnowledgeState } from "@toile/database";
import { audit } from "@toile/auth";
import {
  PERMISSIONS,
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
import { getProfileViewer } from "./access";
import { findSimilarProfiles } from "./queries";

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
}

async function guardManage() {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MANAGE)) return null;
  return current;
}

/** Création d'un profil avec code PRF-XXXXXX dérivé du compteur. */
async function createProfileRecord(
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

// ─────────────────────────────────────────────────────────────
// Création rapide (prénom seul)
// ─────────────────────────────────────────────────────────────

export async function quickCreateProfileAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Seule la modération peut créer un dossier." };

  const parsed = profileQuickCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Prénom invalide." };
  }
  const firstName = parsed.data.firstName.replace(/\s+/g, " ");

  // Doublons potentiels : avertir sans bloquer
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

  const profile = await prisma.$transaction((tx) =>
    createProfileRecord(tx, {
      characterFirstName: firstName,
      firstNameNorm: normalizeRefLabel(firstName),
      createdById: current.session.userId,
    }),
  );
  await prisma.characterProfileRevision.create({
    data: {
      profileId: profile.id,
      fieldKey: "profile",
      newValue: { created: true, firstName },
      changedById: current.session.userId,
      sourceMissionId: parsed.data.sourceMissionId ?? null,
    },
  });

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.created",
    resourceType: "characterProfile",
    resourceId: profile.id,
    newValues: { code: profile.code },
    ...meta,
  });

  revalidatePath("/profils");
  return { ok: true, profileId: profile.id };
}

// ─────────────────────────────────────────────────────────────
// Mise à jour d'un dossier (avec états de connaissance et conflits)
// ─────────────────────────────────────────────────────────────

const SCALAR_CONFLICT_FIELDS: ProfileFieldKey[] = [
  "lastName", "sex", "height", "hairColor", "skinTone", "faction", "rank", "lifeStatus",
];

export async function updateProfileAction(raw: unknown): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Seule la modération peut modifier un dossier." };

  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Données invalides." };
  }
  const input = parsed.data;

  const profile = await prisma.characterProfile.findUnique({
    where: { id: input.profileId },
    include: {
      fieldIntel: true,
      traits: { include: { option: true } },
      hairColor: true,
      skinTone: true,
      faction: { select: { name: true } },
      rank: { select: { label: true } },
    },
  });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };

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
      if (fieldKey === "faction") data.factionId = null;
      if (fieldKey === "rank") data.rankId = null;
      if (fieldKey === "lifeStatus") data.lifeStatus = null;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.characterProfile.update({ where: { id: profile.id }, data });
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
        // Création rapide d'un dossier minimal lié (prénom seul)
        const minimal = await createProfileRecord(tx, {
          characterFirstName: input.newRelatedFirstName.replace(/\s+/g, " "),
          firstNameNorm: normalizeRefLabel(input.newRelatedFirstName),
          createdById: current.session.userId,
        });
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
    select: { id: true, code: true, characterFirstName: true, archivedAt: true },
  });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };

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

const IMAGE_MAX_BYTES = 500 * 1024;
const IMAGE_SIGNATURES: { mime: string; check: (b: Buffer) => boolean }[] = [
  { mime: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", check: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

export async function uploadProfileImageAction(formData: FormData): Promise<ProfileActionResult> {
  const current = await guardManage();
  if (!current) return { ok: false, error: "Permission refusée." };

  const profileId = String(formData.get("profileId") ?? "");
  const file = formData.get("image");
  const profile = await prisma.characterProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.archivedAt) return { ok: false, error: "Dossier introuvable." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Aucun fichier reçu." };
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, error: "Portrait trop lourd : 500 Ko maximum." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = IMAGE_SIGNATURES.find((s) => s.check(bytes));
  if (!signature) return { ok: false, error: "Format refusé : PNG, JPG/JPEG ou WEBP uniquement." };

  await prisma.$transaction([
    prisma.characterProfile.update({
      where: { id: profileId },
      data: { imageData: bytes, imageMime: signature.mime, updatedById: current.session.userId },
    }),
    prisma.characterFieldIntel.upsert({
      where: { profileId_fieldKey: { profileId, fieldKey: "image" } },
      update: { knowledgeState: "KNOWN", updatedById: current.session.userId },
      create: { profileId, fieldKey: "image", knowledgeState: "KNOWN", updatedById: current.session.userId },
    }),
  ]);
  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.image_changed",
    resourceType: "characterProfile",
    resourceId: profileId,
    newValues: { mime: signature.mime, sizeBytes: bytes.length },
    ...meta,
  });
  revalidatePath(`/profils/${profileId}`);
  return { ok: true };
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
    select: { id: true, code: true, characterFirstName: true, characterLastName: true },
  });
  if (!profile) return { ok: false, error: "Dossier introuvable." };

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
    // Relations : rediriger, en neutralisant celles devenues réflexives
    await tx.characterRelationship.deleteMany({
      where: {
        OR: [
          { fromProfileId: source.id, toProfileId: target.id },
          { fromProfileId: target.id, toProfileId: source.id },
        ],
      },
    });
    await tx.characterRelationship.updateMany({ where: { fromProfileId: source.id }, data: { fromProfileId: target.id } });
    await tx.characterRelationship.updateMany({ where: { toProfileId: source.id }, data: { toProfileId: target.id } });
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
