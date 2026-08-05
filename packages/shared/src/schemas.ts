import { z } from "zod";

// ── Validation serveur (Zod) — utilisée par les API routes et le bot ──

export const missionCategorySchema = z.enum([
  "COLLECTE_INFORMATIONS",
  "SURVEILLANCE_ESPIONNAGE",
  "ELIMINATION",
  "ENLEVEMENT",
  "INTERROGATOIRE",
  "PROTECTION",
  "ESCORTE",
  "SABOTAGE",
  "MERCENARIAT",
  "SPECIALE",
  "INFILTRATION",
  "TRAQUE",
  "CONTRE_ESPIONNAGE",
  "GUERRE",
]);

export const missionRankSchema = z.enum(["D", "C", "B", "A", "S", "SS"]);

export const missionStatusSchema = z.enum([
  "DRAFT",
  "AVAILABLE",
  "CLAIM_PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "ARCHIVED",
]);

export const eligibilityModeSchema = z.enum([
  "RECOMMENDATION",
  "WARNING",
  "STRICT",
  "MANUAL_REVIEW",
]);

const secondaryObjectiveSchema = z.object({
  label: z.string().min(1).max(300),
  secret: z.boolean().optional(),
  points: z.number().int().min(-1000).max(1000).optional(),
});

export const missionCreateSchema = z
  .object({
    publicTitle: z.string().min(3).max(120),
    internalTitle: z.string().max(120).optional(),
    category: missionCategorySchema,
    rank: missionRankSchema,
    publicSummary: z.string().max(2000).optional(),
    confidentialDescription: z.string().max(10_000).optional(),
    primaryObjective: z.string().max(2000).optional(),
    secondaryObjectives: z.array(secondaryObjectiveSchema).max(20).default([]),
    targetIdentity: z.string().max(500).optional(),
    targetFactionId: z.union([z.string().cuid(), z.literal("")]).optional(),
    location: z.string().max(500).optional(),
    clientName: z.string().max(300).optional(),
    constraints: z.string().max(3000).optional(),
    prohibitions: z.string().max(3000).optional(),
    evidence: z.string().max(3000).optional(),
    moderatorNotes: z.string().max(5000).optional(),
    rewardRyoMin: z.number().int().min(0).max(1_000_000_000),
    rewardRyoMax: z.number().int().min(0).max(1_000_000_000),
    basePoints: z.number().int().min(0).max(100_000),
    targetLevelSlug: z.string().max(50).optional(),
    minRecommendedLevelSlug: z.string().max(50).optional(),
    groupSizeMin: z.number().int().min(1).max(50),
    groupSizeMax: z.number().int().min(1).max(50),
    eligibilityMode: eligibilityModeSchema.default("WARNING"),
    // Délai : soit une date réelle, soit une durée RP, soit aucun
    expiresAt: z.string().datetime().nullable().optional(),
    rpDuration: z
      .object({
        years: z.number().int().min(0).max(100).default(0),
        months: z.number().int().min(0).max(12).default(0),
        weeks: z.number().int().min(0).max(4).default(0),
      })
      .nullable()
      .optional(),
    visibility: z
      .object({
        showCategory: z.boolean().default(true),
        showTargetLevel: z.boolean().default(true),
        showSummary: z.boolean().default(true),
      })
      .default({ showCategory: true, showTargetLevel: true, showSummary: true }),
    publish: z.boolean().default(false),
    notifyLeaders: z.boolean().default(true),
  })
  .refine((d) => d.rewardRyoMax >= d.rewardRyoMin, {
    message: "La récompense maximale doit être supérieure ou égale à la minimale",
    path: ["rewardRyoMax"],
  })
  .refine((d) => d.groupSizeMax >= d.groupSizeMin, {
    message: "La taille maximale du groupe doit être supérieure ou égale à la minimale",
    path: ["groupSizeMax"],
  });

export type MissionCreateInput = z.infer<typeof missionCreateSchema>;

export const missionClaimSchema = z.object({
  missionId: z.string().cuid(),
  groupId: z.string().cuid(),
  publicRoster: z.boolean().default(false),
  // Identifiants d'utilisateurs : pas de contrainte de FORME (les comptes
  // d'amorçage ont des identifiants lisibles). L'existence, l'appartenance au
  // groupe et le statut actif sont vérifiés en base juste après.
  participantIds: z
    .array(z.string().min(1).max(64))
    .min(1, "Sélectionnez au moins un agent.")
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Un agent ne peut être sélectionné qu'une fois."),
  message: z.string().max(2000).optional(),
});

export const claimDecisionSchema = z.object({
  claimId: z.string().cuid(),
  decision: z.enum(["ACCEPTED", "REJECTED", "INFO_REQUESTED"]),
  note: z.string().max(2000).optional(),
});

export const missionMoveSchema = z.object({
  missionId: z.string().cuid(),
  toStatus: missionStatusSchema,
  reason: z.string().max(1000).optional(),
  // Retour vers « À prendre » d'une mission attribuée : true = retirer les
  // attributions et rouvrir, false = les conserver. Absent = demander le choix.
  releaseAssignments: z.boolean().optional(),
  // Montant exact distribué à l'accomplissement (dans la fourchette du contrat).
  awardedRyo: z.number().int().min(0).max(1_000_000_000).optional(),
});

export const scoreAdjustSchema = z.object({
  factionId: z.string().cuid().optional(),
  groupId: z.string().cuid(),
  missionId: z.string().cuid().optional(),
  points: z.number().int().min(-100_000).max(100_000),
  reason: z.enum([
    "MISSION_COMPLETED",
    "MISSION_FAILED",
    "SPEED_BONUS",
    "STEALTH_BONUS",
    "SECONDARY_OBJECTIVES",
    "REPORT_QUALITY",
    "ADMIN_PENALTY",
    "ABANDON",
    "RP_VIOLATION",
    "MANUAL_ADJUSTMENT",
  ]),
  justification: z.string().min(3).max(2000),
});

export const invitationCreateSchema = z.object({
  roleSlug: z.enum(["super_admin", "moderator", "group_leader", "group_member"]),
  factionId: z.string().cuid().optional(),
  groupId: z.string().cuid().optional(),
  // Le grade n'est PLUS choisi par l'inviteur : l'invité le renseigne à sa
  // première connexion. Le champ reste accepté pour ne pas invalider les
  // appels existants, mais le formulaire ne l'envoie plus.
  playerLevelId: z.string().cuid("Niveau invalide.").optional(),
  // Parcours de groupe d'un chef invité :
  // EXISTING_GROUP → rejoint groupId ; CREATE_NEW_GROUP → fondera son groupe
  groupOnboardingMode: z
    .enum(["NONE", "EXISTING_GROUP", "CREATE_NEW_GROUP"])
    .default("NONE"),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  requireApproval: z.boolean().default(true),
  restrictedDiscordId: z
    .string()
    .regex(/^\d{15,21}$/, "Identifiant Discord invalide")
    .optional(),
  note: z.string().max(500).optional(),
});

// ── Onboarding d'identité ──

// Lettres (accents inclus), espaces, apostrophes (droite/typographique), traits d'union
const NAME_PATTERN = /^[\p{L}][\p{L}\s'’-]*$/u;

export const onboardingIdentitySchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Le prénom est obligatoire.")
    .max(60)
    .regex(NAME_PATTERN, "Le prénom contient des caractères non autorisés."),
  lastName: z
    .string()
    .trim()
    .max(60)
    .regex(NAME_PATTERN, "Le nom contient des caractères non autorisés.")
    .optional()
    .or(z.literal("")),
  displayName: z
    .string()
    .trim()
    .min(2, "Le pseudonyme doit compter au moins 2 caractères.")
    .max(60)
    .refine((v) => v.replace(/\s+/g, "").length > 0, "Le pseudonyme ne peut pas être vide."),
  // Grade RP déclaré par le joueur lui-même à sa première connexion
  playerLevelId: z.string().cuid("Sélectionnez votre grade."),
  privacyAcknowledged: z
    .boolean()
    .refine((v) => v === true, "Vous devez confirmer avoir compris la confidentialité."),
});

export type OnboardingIdentityInput = z.infer<typeof onboardingIdentitySchema>;

/**
 * Modification de sa PROPRE identité après l'onboarding. Mêmes règles que la
 * première connexion, sans la case de confidentialité : elle a déjà été
 * acceptée et son horodatage ne doit pas être réécrit.
 */
export const selfIdentityUpdateSchema = onboardingIdentitySchema.omit({
  privacyAcknowledged: true,
});

export type SelfIdentityUpdateInput = z.infer<typeof selfIdentityUpdateSchema>;

// ── Groupes ──

export const groupUpsertSchema = z.object({
  name: z.string().trim().min(2).max(80),
  primaryCountry: z.string().trim().max(80).optional().or(z.literal("")),
  primaryVillage: z.string().trim().max(80).optional().or(z.literal("")),
  specialties: z.array(missionCategorySchema).max(14).default([]),
});

export type GroupUpsertInput = z.infer<typeof groupUpsertSchema>;

// ── Attribution multi-groupes ──

export const missionAssignSchema = z
  .object({
    missionId: z.string().cuid(),
    start: z.boolean().default(true), // passer la mission « en cours »
    reason: z.string().max(1000).optional(),
    assignments: z
      .array(
        z.object({
          groupId: z.string().min(1),
          participantIds: z.array(z.string().min(1).max(64)).min(1, "Sélectionnez au moins un agent.").max(50),
          isLead: z.boolean().default(false),
        }),
      )
      .min(1, "Sélectionnez au moins un groupe."),
  })
  .refine((d) => new Set(d.assignments.map((a) => a.groupId)).size === d.assignments.length, {
    message: "Un même groupe ne peut être sélectionné qu'une fois.",
  })
  .refine((d) => d.assignments.filter((a) => a.isLead).length <= 1, {
    message: "Un seul groupe principal est autorisé.",
  })
  .refine(
    (d) => {
      const ids = d.assignments.flatMap((assignment) => assignment.participantIds);
      return new Set(ids).size === ids.length;
    },
    { message: "Un agent ne peut représenter qu'un seul groupe sur une mission." },
  )
  .refine((d) => d.assignments.every((a) => new Set(a.participantIds).size === a.participantIds.length), {
    message: "Un agent ne peut être sélectionné deux fois dans le même groupe.",
  });

export type MissionAssignInput = z.infer<typeof missionAssignSchema>;

export const missionFiltersSchema = z.object({
  q: z.string().max(200).optional(),
  rank: z.array(missionRankSchema).optional(),
  status: z.array(missionStatusSchema).optional(),
  category: z.array(missionCategorySchema).optional(),
  targetLevel: z.array(z.string().max(50)).optional(),
  factionId: z.string().cuid().optional(),
  groupId: z.string().cuid().optional(),
  publishedAfter: z.string().datetime().optional(),
  expiresBefore: z.string().datetime().optional(),
  ryoMin: z.number().int().min(0).optional(),
  ryoMax: z.number().int().min(0).optional(),
  compatibleWithMyGroup: z.boolean().optional(),
  claimed: z.boolean().optional(),
  noTimeLimit: z.boolean().optional(),
});

export type MissionFilters = z.infer<typeof missionFiltersSchema>;
