import "server-only";
import { prisma } from "@toile/database";
import { REFERENCE_TYPES, SOURCE_SCOPE_LABELS } from "@toile/shared";
import type { RefOption, EditFormData } from "@/components/profils/edit-form";

async function loadRef(type: string): Promise<RefOption[]> {
  const rows = await prisma.profileReferenceOption.findMany({
    where: { type, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    category: r.category,
    colorHex: r.colorHex,
    sourceScopeLabel: SOURCE_SCOPE_LABELS[r.sourceScope] ?? r.sourceScope,
    // Alimentent la recherche tolérante du sélecteur (alias + romanisation)
    aliases: r.aliases,
    kanji: r.kanji,
  }));
}

export async function loadProfileRefs() {
  const [
    hairColors, skinTones, clans, chakraNatures, kekkeiGenkai, clanTechniques,
    combatStyles, kenjutsuStyles, artifacts, jutsuTypes, factions, ranks,
  ] = await Promise.all([
    loadRef(REFERENCE_TYPES.HAIR_COLOR),
    loadRef(REFERENCE_TYPES.SKIN_TONE),
    loadRef(REFERENCE_TYPES.CLAN_FAMILY),
    loadRef(REFERENCE_TYPES.CHAKRA_NATURE),
    loadRef(REFERENCE_TYPES.KEKKEI_GENKAI),
    loadRef(REFERENCE_TYPES.CLAN_TECHNIQUE),
    loadRef(REFERENCE_TYPES.COMBAT_STYLE),
    loadRef(REFERENCE_TYPES.KENJUTSU_STYLE),
    loadRef(REFERENCE_TYPES.LEGENDARY_ARTIFACT),
    loadRef(REFERENCE_TYPES.JUTSU_TYPE),
    prisma.faction.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.playerLevel.findMany({ select: { id: true, label: true }, orderBy: { order: "asc" } }),
  ]);
  return { hairColors, skinTones, clans, chakraNatures, kekkeiGenkai, clanTechniques, combatStyles, kenjutsuStyles, artifacts, jutsuTypes, factions, ranks };
}

export async function loadEditData(profileId: string): Promise<EditFormData | null> {
  const profile = await prisma.characterProfile.findUnique({
    where: { id: profileId },
    include: {
      traits: { include: { option: { select: { id: true, type: true } } } },
      fieldIntel: { select: { fieldKey: true, knowledgeState: true } },
      // Sert à déduire l'état des Subjutsu sur les dossiers antérieurs au suivi
      techniques: { select: { id: true } },
    },
  });
  if (!profile || profile.archivedAt) return null;
  const traitIds = (type: string) =>
    profile.traits.filter((t) => t.option.type === type).map((t) => t.optionId);

  // État de connaissance courant de chaque champ ; l'absence de ligne vaut
  // UNKNOWN, sauf si une valeur existe déjà (dossiers antérieurs au suivi).
  const fieldStates: EditFormData["fieldStates"] = {};
  for (const row of profile.fieldIntel) {
    fieldStates[row.fieldKey as keyof EditFormData["fieldStates"]] =
      row.knowledgeState as never;
  }
  const inferKnown = (key: keyof EditFormData["fieldStates"], hasValue: boolean) => {
    if (!fieldStates[key] && hasValue) fieldStates[key] = "KNOWN";
  };
  inferKnown("lastName", profile.characterLastName != null);
  inferKnown("sex", profile.sexCode != null);
  inferKnown("height", profile.heightMinCm != null || profile.heightMaxCm != null);
  inferKnown("hairColor", profile.hairColorId != null);
  inferKnown("skinTone", profile.skinToneId != null);
  inferKnown("faction", profile.factionId != null);
  inferKnown("rank", profile.rankId != null);
  inferKnown("lifeStatus", profile.lifeStatus != null);
  inferKnown("age", profile.ageMode !== "UNKNOWN");
  inferKnown("clans", traitIds(REFERENCE_TYPES.CLAN_FAMILY).length > 0);
  inferKnown("chakraNatures", traitIds(REFERENCE_TYPES.CHAKRA_NATURE).length > 0);
  inferKnown("kekkeiGenkai", traitIds(REFERENCE_TYPES.KEKKEI_GENKAI).length > 0);
  inferKnown("clanTechniques", traitIds(REFERENCE_TYPES.CLAN_TECHNIQUE).length > 0);
  inferKnown("techniques", profile.techniques.length > 0);
  inferKnown("combatStyles", traitIds(REFERENCE_TYPES.COMBAT_STYLE).length > 0);
  inferKnown("kenjutsuStyles", traitIds(REFERENCE_TYPES.KENJUTSU_STYLE).length > 0);
  inferKnown("artifacts", traitIds(REFERENCE_TYPES.LEGENDARY_ARTIFACT).length > 0);
  inferKnown("details", profile.details != null);
  inferKnown("strengths", profile.strengths != null);
  inferKnown("weaknesses", profile.weaknesses != null);
  return {
    profileId: profile.id,
    // Sert au verrouillage optimiste lors de l'enregistrement
    version: profile.version,
    firstName: profile.characterFirstName,
    lastName: profile.characterLastName ?? "",
    sexCode: profile.sexCode ?? "",
    heightMinCm: profile.heightMinCm,
    heightMaxCm: profile.heightMaxCm,
    hairColorId: profile.hairColorId ?? "",
    skinToneId: profile.skinToneId ?? "",
    factionId: profile.factionId ?? "",
    rankId: profile.rankId ?? "",
    lifeStatus: profile.lifeStatus ?? "",
    ageMode: profile.ageMode,
    ageYearsNow: profile.ageYearsAtRef,
    ageMinNow: profile.ageMinAtRef,
    ageMaxNow: profile.ageMaxAtRef,
    clanIds: traitIds(REFERENCE_TYPES.CLAN_FAMILY),
    chakraNatureIds: traitIds(REFERENCE_TYPES.CHAKRA_NATURE),
    kekkeiGenkaiIds: traitIds(REFERENCE_TYPES.KEKKEI_GENKAI),
    clanTechniqueIds: traitIds(REFERENCE_TYPES.CLAN_TECHNIQUE),
    combatStyleIds: traitIds(REFERENCE_TYPES.COMBAT_STYLE),
    kenjutsuStyleIds: traitIds(REFERENCE_TYPES.KENJUTSU_STYLE),
    artifactIds: traitIds(REFERENCE_TYPES.LEGENDARY_ARTIFACT),
    details: profile.details ?? "",
    strengths: profile.strengths ?? "",
    weaknesses: profile.weaknesses ?? "",
    internalNotes: profile.internalNotes ?? "",
    fieldStates,
  };
}
