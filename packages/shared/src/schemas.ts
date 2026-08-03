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
});

export const scoreAdjustSchema = z.object({
  factionId: z.string().cuid(),
  groupId: z.string().cuid().optional(),
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
  roleSlug: z.enum(["super_admin", "moderator", "faction_leader", "faction_member"]),
  factionId: z.string().cuid().optional(),
  groupId: z.string().cuid().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  requireApproval: z.boolean().default(true),
  restrictedDiscordId: z
    .string()
    .regex(/^\d{15,21}$/, "Identifiant Discord invalide")
    .optional(),
  note: z.string().max(500).optional(),
});

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
