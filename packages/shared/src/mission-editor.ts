/**
 * Contrat de l'éditeur de mission — UNE page, un seul objet.
 *
 * L'ancien parcours demandait dix écrans et neuf clics « Suivant » pour une
 * mission qui tient en quatre champs, et faisait ressaisir à la main ce que
 * les dossiers de renseignement savaient déjà : le nom de la cible, sa
 * faction, son grade. Ici :
 *
 *  · les cibles et les commanditaires SONT des dossiers (`profileId`), jamais
 *    du texte libre — le texte libre subsiste en lecture seule pour les
 *    missions déjà saisies (`legacyTargetIdentity`) ;
 *  · le titre public, le niveau de cible et la faction cible se DÉDUISENT de
 *    ces dossiers (voir `mission-title.ts`) : aucun champ à remplir ;
 *  · le délai s'exprime d'UNE façon au choix, le serveur calcule le reste ;
 *  · tout le reste est facultatif et replié.
 */

import { z } from "zod";
import {
  eligibilityModeSchema,
  missionCategorySchema,
  missionRankSchema,
} from "./schemas";
import { MISSION_ORIGIN_VISIBILITIES, MISSION_RANK_MODIFIERS } from "./mission-title";
import { PROFILE_FIELD_KEYS } from "./profile-fields";

/** Rôles d'un dossier dans une mission (miroir de l'enum Prisma). */
export const MISSION_PROFILE_ROLES = [
  "TARGET",
  "CLIENT",
  "CONTACT",
  "SUBJECT",
  "PERSON_OF_INTEREST",
  "OTHER",
] as const;
export type MissionProfileRole = (typeof MISSION_PROFILE_ROLES)[number];

export const MISSION_PROFILE_ROLE_LABELS: Record<MissionProfileRole, string> = {
  TARGET: "Cible",
  CLIENT: "Commanditaire",
  CONTACT: "Contact",
  SUBJECT: "Sujet",
  PERSON_OF_INTEREST: "Personne d'intérêt",
  OTHER: "Autre",
};

const cuid = z.string().cuid();

/** Un dossier rattaché à la mission, avec son rôle. */
export const missionProfileLinkSchema = z.object({
  profileId: cuid,
  role: z.enum(MISSION_PROFILE_ROLES).default("TARGET"),
  /** Au plus un principal par rôle — vérifié plus bas */
  isPrimary: z.boolean().default(false),
});
export type MissionProfileLinkInput = z.infer<typeof missionProfileLinkSchema>;

const secondaryObjectiveSchema = z.object({
  label: z.string().trim().min(1).max(300),
  secret: z.boolean().optional(),
  points: z.number().int().min(-1000).max(1000).optional(),
});

/**
 * Délai : UNE intention, exprimée d'une seule façon.
 *  · NONE     — sans limite
 *  · REAL     — une durée réelle en heures
 *  · RP       — une durée de temps RP (convertie par le service central)
 *  · DATE     — une date et une heure précises
 */
export const MISSION_DEADLINE_MODES = ["NONE", "REAL", "RP", "DATE"] as const;
export type MissionDeadlineMode = (typeof MISSION_DEADLINE_MODES)[number];

export const missionDeadlineSchema = z
  .object({
    mode: z.enum(MISSION_DEADLINE_MODES).default("NONE"),
    /** mode REAL : durée en heures */
    realHours: z.number().int().min(1).max(24 * 365).nullable().optional(),
    /** mode RP */
    rp: z
      .object({
        years: z.number().int().min(0).max(100).default(0),
        months: z.number().int().min(0).max(12).default(0),
        weeks: z.number().int().min(0).max(4).default(0),
      })
      .nullable()
      .optional(),
    /** mode DATE : instant ISO */
    at: z.string().datetime().nullable().optional(),
  })
  .superRefine((deadline, ctx) => {
    if (deadline.mode === "REAL" && !deadline.realHours) {
      ctx.addIssue({ code: "custom", path: ["realHours"], message: "Indiquez une durée." });
    }
    if (deadline.mode === "RP") {
      const rp = deadline.rp;
      const total = (rp?.years ?? 0) + (rp?.months ?? 0) + (rp?.weeks ?? 0);
      if (total <= 0) {
        ctx.addIssue({ code: "custom", path: ["rp"], message: "Indiquez une durée RP." });
      }
    }
    if (deadline.mode === "DATE" && !deadline.at) {
      ctx.addIssue({ code: "custom", path: ["at"], message: "Indiquez une date." });
    }
  });
export type MissionDeadlineInput = z.infer<typeof missionDeadlineSchema>;

export const EMPTY_DEADLINE: MissionDeadlineInput = { mode: "NONE" };

/**
 * Le formulaire complet. Seuls `category`, `rank` et la récompense sont
 * réellement exigés pour publier — un brouillon accepte tout état.
 */
export const missionEditorSchema = z
  .object({
    // ── Essentiel ──
    category: missionCategorySchema,
    rank: missionRankSchema,
    rankModifier: z.enum(MISSION_RANK_MODIFIERS).default("NONE"),
    rewardRyoMin: z.number().int().min(0).max(1_000_000_000),
    rewardRyoMax: z.number().int().min(0).max(1_000_000_000),
    basePoints: z.number().int().min(0).max(100_000),
    deadline: missionDeadlineSchema.default(EMPTY_DEADLINE),

    // ── Personnes (dossiers) ──
    links: z.array(missionProfileLinkSchema).max(40).default([]),

    // ── Objectif ──
    primaryObjective: z.string().trim().max(2000).optional(),
    secondaryObjectives: z.array(secondaryObjectiveSchema).max(20).default([]),

    // ── Informations opérationnelles ──
    publicSummary: z.string().trim().max(2000).optional(),
    confidentialDescription: z.string().trim().max(10_000).optional(),
    location: z.string().trim().max(500).optional(),
    constraints: z.string().trim().max(3000).optional(),
    prohibitions: z.string().trim().max(3000).optional(),
    evidence: z.string().trim().max(3000).optional(),
    /** Prise d'information : ce que la Toile cherche à apprendre */
    soughtFieldKeys: z.array(z.enum(PROFILE_FIELD_KEYS)).max(30).default([]),

    // ── Options avancées ──
    internalTitle: z.string().trim().max(120).optional(),
    moderatorNotes: z.string().trim().max(5000).optional(),
    minRecommendedLevelSlug: z.string().max(50).optional(),
    groupSizeMin: z.number().int().min(1).max(50).default(1),
    groupSizeMax: z.number().int().min(1).max(50).default(4),
    eligibilityMode: eligibilityModeSchema.default("WARNING"),
    requiresEnhancedReview: z.boolean().default(false),
    originVisibility: z.enum(MISSION_ORIGIN_VISIBILITIES).default("SHOW"),
    visibility: z
      .object({
        showCategory: z.boolean().default(true),
        showTargetLevel: z.boolean().default(true),
        showSummary: z.boolean().default(true),
      })
      .default({ showCategory: true, showTargetLevel: true, showSummary: true }),
    notifyLeaders: z.boolean().default(true),
    /**
     * Dérogation de super-modérateur : titre écrit à la main. Exige une
     * justification — un titre manuel échappe aux garde-fous du générateur.
     */
    titleOverride: z.string().trim().max(120).optional(),
    titleOverrideReason: z.string().trim().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rewardRyoMax < data.rewardRyoMin) {
      ctx.addIssue({
        code: "custom",
        path: ["rewardRyoMax"],
        message: "La récompense maximale doit être supérieure ou égale à la minimale.",
      });
    }
    if (data.groupSizeMax < data.groupSizeMin) {
      ctx.addIssue({
        code: "custom",
        path: ["groupSizeMax"],
        message: "L'effectif maximal doit être supérieur ou égal au minimal.",
      });
    }
    // Un dossier ne se rattache qu'une fois par rôle
    const seen = new Set<string>();
    data.links.forEach((link, index) => {
      const key = `${link.profileId}:${link.role}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["links", index], message: "Ce dossier est déjà rattaché avec ce rôle." });
      }
      seen.add(key);
    });
    // Au plus un principal par rôle
    for (const role of MISSION_PROFILE_ROLES) {
      const primaries = data.links.filter((l) => l.role === role && l.isPrimary);
      if (primaries.length > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["links"],
          message: `Une seule ${MISSION_PROFILE_ROLE_LABELS[role].toLowerCase()} principale.`,
        });
      }
    }
    if (data.titleOverride && !data.titleOverrideReason) {
      ctx.addIssue({
        code: "custom",
        path: ["titleOverrideReason"],
        message: "Un titre manuel doit être justifié.",
      });
    }
  });
export type MissionEditorInput = z.infer<typeof missionEditorSchema>;

/**
 * Contrôles de PUBLICATION, séparés du schéma pour que le brouillon accepte
 * un formulaire à moitié rempli. Retourne toutes les erreurs d'un coup :
 * on ne fait pas découvrir les manques un par un.
 */
export interface MissionCheck {
  /** champ concerné — sert d'ancre « aller au champ » */
  field: string;
  label: string;
  level: "error" | "warning" | "ok";
  message: string;
}

export function checkMissionForPublication(
  data: MissionEditorInput,
  context: { targetCount: number; clientCount: number },
): MissionCheck[] {
  const checks: MissionCheck[] = [];
  const push = (field: string, label: string, level: MissionCheck["level"], message: string) =>
    checks.push({ field, label, level, message });

  push("category", "Type", "ok", "Type de mission choisi.");
  push("rank", "Rang", "ok", "Rang choisi.");

  if (data.rewardRyoMax <= 0) {
    push("rewardRyoMin", "Récompense", "error", "La récompense doit être positive.");
  } else {
    push("rewardRyoMin", "Récompense", "ok", "Récompense renseignée.");
  }

  if (context.targetCount === 0) {
    // Certaines missions n'ont légitimement personne à viser (escorte d'un
    // convoi, garde d'un lieu) : c'est un avertissement, pas un refus.
    push("links", "Cibles", "warning", "Aucune cible rattachée à un dossier.");
  } else {
    push("links", "Cibles", "ok", `${context.targetCount} cible${context.targetCount > 1 ? "s" : ""}.`);
  }

  if (context.clientCount > 0) {
    push("links", "Commanditaires", "ok", `${context.clientCount} commanditaire${context.clientCount > 1 ? "s" : ""}.`);
  }

  if (!data.primaryObjective?.trim()) {
    push("primaryObjective", "Objectif principal", "warning", "Aucun objectif principal.");
  } else {
    push("primaryObjective", "Objectif principal", "ok", "Objectif renseigné.");
  }

  if (data.deadline.mode === "NONE") {
    push("deadline", "Délai", "warning", "Sans limite de temps.");
  } else {
    push("deadline", "Délai", "ok", "Délai renseigné.");
  }

  return checks;
}

/** Les seules erreurs bloquantes — le reste n'est qu'un signalement. */
export function missionBlockingErrors(checks: readonly MissionCheck[]): MissionCheck[] {
  return checks.filter((c) => c.level === "error");
}

// ── Suggestions (informatives, jamais bloquantes) ───────────────────────

/**
 * Rang conseillé d'après le grade le plus élevé des cibles.
 *
 * Ce n'est PAS une règle canonique de l'univers : c'est le barème du serveur,
 * et il ne fait qu'aiguiller. Un Genin protégé par une armée mérite un rang A ;
 * un Jonin ivre mort, un rang C. Le modérateur tranche.
 */
const GRADE_ORDER_TO_RANK: { minOrder: number; rank: string }[] = [
  { minOrder: 9, rank: "SS" },
  { minOrder: 8, rank: "S" },
  { minOrder: 7, rank: "A" },
  { minOrder: 5, rank: "B" },
  { minOrder: 3, rank: "C" },
  { minOrder: 0, rank: "D" },
];

/** Catégories qui rehaussent d'un cran : le contact est direct et violent. */
const HARD_CATEGORIES = new Set(["ELIMINATION", "ENLEVEMENT", "GUERRE", "TRAQUE"]);
const RANK_LADDER = ["D", "C", "B", "A", "S", "SS"] as const;

export function suggestMissionRank(
  targets: readonly { gradeOrder: number | null }[],
  category: string,
): string | null {
  const orders = targets.map((t) => t.gradeOrder).filter((o): o is number => o != null);
  if (orders.length === 0) return null;
  const highest = Math.max(...orders);
  const base = GRADE_ORDER_TO_RANK.find((row) => highest >= row.minOrder)?.rank ?? "D";
  if (!HARD_CATEGORIES.has(category)) return base;
  const index = RANK_LADDER.indexOf(base as (typeof RANK_LADDER)[number]);
  return RANK_LADDER[Math.min(index + 1, RANK_LADDER.length - 1)]!;
}

/**
 * Le rang choisi paraît-il faible au regard des cibles ? Un avertissement
 * s'affiche alors dans l'éditeur — sans rien empêcher.
 */
export function rankLooksLow(chosen: string, suggested: string | null): boolean {
  if (!suggested) return false;
  const a = RANK_LADDER.indexOf(chosen as (typeof RANK_LADDER)[number]);
  const b = RANK_LADDER.indexOf(suggested as (typeof RANK_LADDER)[number]);
  return a >= 0 && b >= 0 && a < b - 1;
}

// ── Modèles par type de mission ─────────────────────────────────────────

/**
 * Ce qu'un type de mission met en avant. Les modèles ne changent QUE les
 * champs visibles et leurs libellés : jamais le nombre d'écrans (il n'y en a
 * qu'un), jamais les règles de validation.
 */
export interface MissionTemplate {
  /** Rôles proposés en tête de la section « Personnes » */
  emphasizeRoles: MissionProfileRole[];
  /** Champs opérationnels mis en avant (les autres restent accessibles) */
  emphasizeFields: string[];
  /** Libellé sur mesure de l'objectif principal */
  objectiveLabel: string;
  objectivePlaceholder: string;
  /** La mission cherche-t-elle des renseignements (section dédiée) ? */
  intelFocused: boolean;
}

const DEFAULT_TEMPLATE: MissionTemplate = {
  emphasizeRoles: ["TARGET", "CLIENT"],
  emphasizeFields: ["location", "constraints"],
  objectiveLabel: "Objectif principal",
  objectivePlaceholder: "Ce que le contrat exige, en une phrase.",
  intelFocused: false,
};

const TEMPLATES: Partial<Record<string, Partial<MissionTemplate>>> = {
  ELIMINATION: {
    emphasizeFields: ["location", "constraints", "evidence"],
    objectiveLabel: "Objectif principal",
    objectivePlaceholder: "Éliminer la cible avant son départ de Konoha.",
  },
  COLLECTE_INFORMATIONS: {
    emphasizeRoles: ["SUBJECT", "TARGET", "CONTACT"],
    emphasizeFields: ["location", "constraints"],
    objectiveLabel: "Ce qu'il faut apprendre",
    objectivePlaceholder: "Établir l'appartenance de clan et les appuis du sujet.",
    intelFocused: true,
  },
  SURVEILLANCE_ESPIONNAGE: {
    emphasizeRoles: ["SUBJECT", "PERSON_OF_INTEREST"],
    objectiveLabel: "Ce qu'il faut observer",
    objectivePlaceholder: "Relever les allées et venues, sans être vu.",
    intelFocused: true,
  },
  ENLEVEMENT: {
    emphasizeFields: ["location", "constraints", "prohibitions"],
    objectiveLabel: "Conditions de capture",
    objectivePlaceholder: "Amener la cible vivante au relais du col Nord.",
  },
  MERCENARIAT: {
    emphasizeRoles: ["CLIENT", "TARGET"],
    emphasizeFields: ["location", "constraints"],
    objectiveLabel: "Engagement",
    objectivePlaceholder: "Tenir le pont pendant l'affrontement.",
  },
  PROTECTION: {
    emphasizeRoles: ["CLIENT", "PERSON_OF_INTEREST"],
    objectiveLabel: "Ce qu'il faut protéger",
    objectivePlaceholder: "Assurer la protection discrète du témoin jusqu'à son audition.",
  },
  ESCORTE: {
    emphasizeRoles: ["CLIENT", "PERSON_OF_INTEREST"],
    objectiveLabel: "Trajet et remise",
    objectivePlaceholder: "Escorter le marchand jusqu'au col des Brumes.",
  },
  INTERROGATOIRE: {
    emphasizeRoles: ["SUBJECT", "TARGET"],
    objectiveLabel: "Ce qu'il faut obtenir",
    objectivePlaceholder: "Obtenir le nom du commanditaire avant l'aube.",
    intelFocused: true,
  },
  TRAQUE: {
    objectiveLabel: "Ce qu'il faut retrouver",
    objectivePlaceholder: "Retrouver la piste de la cible et la suivre sans l'alerter.",
    intelFocused: true,
  },
};

export function missionTemplate(category: string): MissionTemplate {
  return { ...DEFAULT_TEMPLATE, ...(TEMPLATES[category] ?? {}) };
}
