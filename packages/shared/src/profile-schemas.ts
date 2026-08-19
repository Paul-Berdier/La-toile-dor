import { z } from "zod";
import { PROFILE_FIELD_KEYS, REFERENCE_TYPES, type ReferenceType } from "./profile-fields";

// ── Validation serveur des dossiers de renseignement ──

const NAME_PATTERN = /^[\p{L}][\p{L}\s'’-]*$/u;

const firstNameSchema = z
  .string()
  .trim()
  .min(1, "Le prénom est obligatoire.")
  .max(80)
  .regex(NAME_PATTERN, "Le prénom contient des caractères non autorisés.")
  .refine((v) => v.replace(/\s+/g, "").length > 0, "Le prénom ne peut pas être vide.");

export const profileQuickCreateSchema = z.object({
  firstName: firstNameSchema,
  sourceMissionId: z.string().cuid().optional(),
  /** true = ignorer l'avertissement de doublons et créer quand même */
  confirmDespiteDuplicates: z.boolean().default(false),
});

export const knowledgeStateSchema = z.enum([
  "UNKNOWN",
  "KNOWN",
  "NONE_CONFIRMED",
  "CONFLICTING",
]);

export const confidenceSchema = z.enum(["RUMOR", "UNCONFIRMED", "PROBABLE", "CONFIRMED"]);

export const conflictStrategySchema = z.enum([
  "REPLACE", // remplacer l'ancienne valeur
  "KEEP", // conserver l'ancienne valeur (nouvelle consignée en historique)
  "MARK_CONFLICTING", // marquer les informations comme contradictoires
]);

/**
 * Mise à jour d'un dossier (modération). Tous les blocs sont optionnels :
 * un modérateur enregistre un renseignement partiel à tout moment.
 * `fieldStates` pilote l'état de connaissance des champs touchés.
 */
export const profileUpdateSchema = z
  .object({
    profileId: z.string().cuid(),
    // Verrouillage optimiste : version du dossier au moment de son ouverture.
    // Facultative pour ne pas casser un appel existant, mais le formulaire la
    // transmet toujours — sans elle, deux rédacteurs simultanés s'écrasent.
    version: z.number().int().nonnegative().optional(),
    // Provenance commune du lot de renseignements
    sourceMissionId: z.string().cuid().nullable().optional(),
    confidence: confidenceSchema.optional(),
    justification: z.string().max(2000).optional(),
    observedAtRp: z.string().max(120).optional(),
    // Résolution de conflit (exigée quand le serveur en détecte un)
    conflictStrategy: conflictStrategySchema.optional(),

    // États de connaissance par champ
    fieldStates: z
      .record(z.enum(PROFILE_FIELD_KEYS), knowledgeStateSchema)
      .optional(),

    // ── Identité ──
    firstName: firstNameSchema.optional(),
    lastName: z.string().trim().max(80).regex(NAME_PATTERN).nullable().optional(),
    sexCode: z.enum(["MALE", "FEMALE", "OTHER"]).nullable().optional(),

    // ── Apparence ──
    heightMinCm: z.number().int().min(30).max(400).nullable().optional(),
    heightMaxCm: z.number().int().min(30).max(400).nullable().optional(),
    hairColorId: z.string().cuid().nullable().optional(),
    skinToneId: z.string().cuid().nullable().optional(),

    // ── Affiliation ──
    factionId: z.string().cuid().nullable().optional(),
    rankId: z.string().cuid().nullable().optional(),

    // ── État vital & âge ──
    lifeStatus: z.enum(["ALIVE", "DEAD", "MISSING"]).nullable().optional(),
    ageMode: z
      .enum(["UNKNOWN", "BIRTH_DATE_RP", "AGE_AT_REFERENCE", "AGE_RANGE_AT_REFERENCE"])
      .optional(),
    /** Âge observé aujourd'hui (le serveur enregistre la référence temporelle) */
    ageYearsNow: z.number().int().min(0).max(500).nullable().optional(),
    ageMinNow: z.number().int().min(0).max(500).nullable().optional(),
    ageMaxNow: z.number().int().min(0).max(500).nullable().optional(),
    deathNow: z.boolean().optional(), // décès constaté maintenant
    missingNow: z.boolean().optional(),

    // ── Traits (référentiels, listes complètes par type) ──
    clanIds: z.array(z.string().cuid()).max(10).optional(),
    chakraNatureIds: z.array(z.string().cuid()).max(20).optional(),
    kekkeiGenkaiIds: z.array(z.string().cuid()).max(20).optional(),
    clanTechniqueIds: z.array(z.string().cuid()).max(30).optional(),
    signatureTechniqueIds: z.array(z.string().cuid()).max(30).optional(),
    combatStyleIds: z.array(z.string().cuid()).max(20).optional(),
    kenjutsuStyleIds: z.array(z.string().cuid()).max(10).optional(),
    artifactIds: z.array(z.string().cuid()).max(10).optional(),

    // ── Analyse ──
    details: z.string().max(10_000).nullable().optional(),
    strengths: z.string().max(10_000).nullable().optional(),
    weaknesses: z.string().max(10_000).nullable().optional(),
    internalNotes: z.string().max(10_000).nullable().optional(),
  })
  .refine(
    (d) =>
      d.heightMinCm == null || d.heightMaxCm == null || d.heightMinCm <= d.heightMaxCm,
    { message: "La taille minimale ne peut pas dépasser la maximale.", path: ["heightMaxCm"] },
  )
  .refine(
    (d) => d.ageMinNow == null || d.ageMaxNow == null || d.ageMinNow <= d.ageMaxNow,
    { message: "L'âge minimal ne peut pas dépasser le maximal.", path: ["ageMaxNow"] },
  );

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const techniqueCreateSchema = z.object({
  profileId: z.string().cuid(),
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(120),
  shortDescription: z.string().max(1000).optional(),
  jutsuTypeId: z.string().cuid().nullable().optional(),
  rank: z.enum(["D", "C", "B", "A", "S", "SS"]).nullable().optional(),
  confidence: confidenceSchema.optional(),
  sourceMissionId: z.string().cuid().optional(),
});

/** Relations proposées à l'interface (les inverses sont dérivées). */
export const relationUiTypeSchema = z.enum([
  "PARENT_OF", // est parent de
  "CHILD_OF", // est enfant de → inverse de PARENT_OF
  "CREATOR_OF",
  "CREATION_OF",
  "SIBLING_OF",
]);

export const relationCreateSchema = z
  .object({
    profileId: z.string().cuid(),
    uiType: relationUiTypeSchema,
    relatedProfileId: z.string().cuid().optional(),
    /** Création rapide d'un profil minimal lié (prénom seul) */
    newRelatedFirstName: firstNameSchema.optional(),
    note: z.string().max(300).optional(),
  })
  .refine((d) => d.relatedProfileId || d.newRelatedFirstName, {
    message: "Choisissez un profil existant ou saisissez un prénom.",
  });

export const purchaseRequestSchema = z.object({
  profileId: z.string().cuid(),
  groupId: z.string().cuid(),
  message: z.string().max(2000).optional(),
});

export const purchaseDecisionSchema = z.object({
  requestId: z.string().cuid(),
  decision: z.enum(["APPROVED", "REFUSED"]),
  priceRyos: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  moderatorResponse: z.string().max(2000).optional(),
});

export const referenceSuggestionSchema = z.object({
  type: z.string().min(2).max(40),
  proposedLabel: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  sourceUrl: z.string().url().max(300).optional().or(z.literal("")),
  sourceScope: z
    .enum(["MANGA_CANON", "ANIME", "FILM", "GAME", "SERVER_CUSTOM"])
    .default("SERVER_CUSTOM"),
  reason: z.string().max(1000).optional(),
});

/**
 * Création directe d'une entrée de référentiel, depuis le formulaire de
 * dossier. Réservée aux détenteurs de `profile.reference.manage` : les autres
 * passent par une proposition soumise à validation, afin d'éviter les
 * variantes (Uchiha / UCHIWA / Uchïha).
 */
export const referenceOptionCreateSchema = z.object({
  // Liste blanche, contrairement aux propositions : cette création est
  // immédiate et sans relecture. Un type inventé produirait des entrées
  // invisibles dans l'administration et impossibles à sélectionner.
  type: z.enum(
    Object.values(REFERENCE_TYPES) as [ReferenceType, ...ReferenceType[]],
    { errorMap: () => ({ message: "Référentiel inconnu." }) },
  ),
  label: z.string().trim().min(1).max(120),
  sourceScope: z
    .enum(["MANGA_CANON", "ANIME", "FILM", "GAME", "SERVER_CUSTOM"])
    .default("SERVER_CUSTOM"),
  /** Pastille de couleur — couleurs de cheveux et de peau uniquement */
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur attendue au format #RRGGBB")
    .optional(),
});
