/**
 * Contributions de renseignement — contrat partagé.
 *
 * Un lecteur qui VOIT un dossier sans pouvoir le modifier propose une valeur
 * pour UN champ. La forme de la valeur dépend du champ : c'est
 * `CONTRIBUTION_VALUE_SCHEMAS` qui la valide, côté serveur comme côté client.
 *
 * RÈGLE DE NON-FUITE : une contribution en attente ne renvoie JAMAIS au
 * contributeur la valeur actuellement en place — ni en clair, ni par un
 * message du type « votre valeur diffère ». Il apprend qu'elle est enregistrée,
 * puis son sort (acceptée, refusée…). Le conflit reste côté modération.
 */
import { z } from "zod";
import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from "./profile-fields";
import { confidenceSchema } from "./profile-schemas";

export const CONTRIBUTION_STATUSES = [
  "PENDING_REVIEW",
  "APPLIED",
  "ACCEPTED",
  "MERGED",
  "REJECTED",
  "CONTRADICTORY",
] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const CONTRIBUTION_STATUS_LABELS: Record<ContributionStatus, string> = {
  PENDING_REVIEW: "En attente de validation",
  APPLIED: "Enregistrée",
  ACCEPTED: "Acceptée",
  MERGED: "Fusionnée",
  REJECTED: "Refusée",
  CONTRADICTORY: "Marquée contradictoire",
};

export const CONTRIBUTION_SOURCES = ["GROUP", "USER", "MISSION"] as const;
export type ContributionSource = (typeof CONTRIBUTION_SOURCES)[number];

export const CONTRIBUTION_SOURCE_LABELS: Record<ContributionSource, string> = {
  GROUP: "Groupe",
  USER: "Membre",
  MISSION: "Mission",
};

/** Décisions possibles de la modération sur une contribution en attente. */
export const CONTRIBUTION_DECISIONS = ["ACCEPT", "REJECT", "MARK_CONTRADICTORY", "MERGE"] as const;
export type ContributionDecision = (typeof CONTRIBUTION_DECISIONS)[number];

export const CONTRIBUTION_DECISION_LABELS: Record<ContributionDecision, string> = {
  ACCEPT: "Accepter",
  REJECT: "Refuser",
  MARK_CONTRADICTORY: "Marquer contradictoire",
  MERGE: "Fusionner",
};

const cuid = z.string().cuid();
const text = z.string().trim().min(1).max(10_000);
const idList = z.array(cuid).min(1).max(30);

/**
 * Forme attendue de `proposedValue` pour chaque champ. Un champ absent de ce
 * tableau n'accepte pas de contribution (image → galerie).
 */
export const CONTRIBUTION_VALUE_SCHEMAS: Partial<Record<ProfileFieldKey, z.ZodTypeAny>> = {
  lastName: z.string().trim().min(1).max(80),
  sex: z.enum(["MALE", "FEMALE", "OTHER"]),
  height: z
    .object({
      minCm: z.number().int().min(30).max(400).nullable(),
      maxCm: z.number().int().min(30).max(400).nullable(),
    })
    .refine((h) => h.minCm != null || h.maxCm != null, "Indiquez au moins une borne.")
    .refine((h) => h.minCm == null || h.maxCm == null || h.minCm <= h.maxCm, "Bornes inversées."),
  hairColor: cuid,
  skinTone: cuid,
  eyeColor: z
    .object({ primaryId: cuid, secondaryId: cuid.nullable().optional() })
    .refine((e) => !e.secondaryId || e.secondaryId !== e.primaryId, "Deux fois la même couleur."),
  ninjaClass: cuid,
  faction: cuid,
  rank: cuid,
  lifeStatus: z.enum(["ALIVE", "DEAD", "MISSING"]),
  age: z
    .object({
      mode: z.enum(["AGE_AT_REFERENCE", "AGE_RANGE_AT_REFERENCE"]),
      years: z.number().int().min(0).max(500).nullable().optional(),
      min: z.number().int().min(0).max(500).nullable().optional(),
      max: z.number().int().min(0).max(500).nullable().optional(),
    })
    .refine(
      (a) => (a.mode === "AGE_AT_REFERENCE" ? a.years != null : a.min != null && a.max != null && a.min <= a.max),
      "Âge incomplet.",
    ),
  clans: idList,
  chakraNatures: idList,
  kekkeiGenkai: idList,
  clanTechniques: idList,
  signatureTechniques: idList,
  combatStyles: idList,
  kenjutsuStyles: idList,
  artifacts: idList,
  techniques: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        shortDescription: z.string().trim().max(1000).optional(),
        jutsuTypeId: cuid.nullable().optional(),
        rank: z.enum(["D", "C", "B", "A", "S", "SS"]).nullable().optional(),
      }),
    )
    .min(1)
    .max(10),
  details: text,
  strengths: text,
  weaknesses: text,
};

/** Champs ouverts aux contributions — dérivé du tableau, jamais recopié. */
export const CONTRIBUTABLE_FIELD_KEYS = PROFILE_FIELD_KEYS.filter(
  (key): key is ProfileFieldKey => key in CONTRIBUTION_VALUE_SCHEMAS,
);

/** Champs « liste » : un ACCEPT ajoute, un MERGE aussi — on ne retire rien. */
export const LIST_FIELD_KEYS: readonly ProfileFieldKey[] = [
  "clans", "chakraNatures", "kekkeiGenkai", "clanTechniques",
  "signatureTechniques", "combatStyles", "kenjutsuStyles", "artifacts", "techniques",
];
/** Champs texte : un MERGE concatène, un ACCEPT remplace. */
export const TEXT_FIELD_KEYS: readonly ProfileFieldKey[] = ["details", "strengths", "weaknesses"];

/** La fusion n'a de sens que pour les listes et les textes. */
export function canMergeField(key: ProfileFieldKey): boolean {
  return LIST_FIELD_KEYS.includes(key) || TEXT_FIELD_KEYS.includes(key);
}

export const intelContributionSchema = z
  .object({
    profileId: cuid,
    fieldKey: z.enum(PROFILE_FIELD_KEYS),
    /** KNOWN avec une valeur, ou NONE_CONFIRMED sans valeur (« vérifié : il n'y en a pas ») */
    knowledgeState: z.enum(["KNOWN", "NONE_CONFIRMED"]).default("KNOWN"),
    value: z.unknown().optional(),
    confidence: confidenceSchema.optional(),
    note: z.string().trim().max(2000).optional(),
    /** Groupe au nom duquel on contribue (déduit s'il n'y en a qu'un) */
    groupId: cuid.optional(),
    sourceMissionId: cuid.optional(),
  })
  .superRefine((input, ctx) => {
    const schema = CONTRIBUTION_VALUE_SCHEMAS[input.fieldKey];
    if (!schema) {
      ctx.addIssue({ code: "custom", path: ["fieldKey"], message: "Ce champ ne reçoit pas de contribution." });
      return;
    }
    if (input.knowledgeState === "NONE_CONFIRMED") return; // pas de valeur à valider
    const result = schema.safeParse(input.value);
    if (!result.success) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: result.error.errors[0]?.message ?? "Valeur invalide pour ce champ.",
      });
    }
  });

export type IntelContributionInput = z.infer<typeof intelContributionSchema>;

export const contributionDecisionSchema = z.object({
  contributionId: cuid,
  decision: z.enum(CONTRIBUTION_DECISIONS),
  reviewNote: z.string().trim().max(2000).optional(),
});
