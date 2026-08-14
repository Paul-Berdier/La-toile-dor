export type EligibilityModeValue =
  | "RECOMMENDATION"
  | "WARNING"
  | "STRICT"
  | "MANUAL_REVIEW";

/** Modes proposés pour les nouvelles missions. MANUAL_REVIEW reste lisible pour l'historique. */
export type ConfigurableEligibilityModeValue = Exclude<EligibilityModeValue, "MANUAL_REVIEW">;

export const MANUAL_REVIEW_NOTICE =
  "Validation manuelle systématique requise, même si les critères automatiques sont remplis.";

export const ELIGIBILITY_MODE_LABELS: Record<EligibilityModeValue, string> = {
  RECOMMENDATION: "Recommandation",
  WARNING: "Avertissement",
  STRICT: "Blocage strict",
  MANUAL_REVIEW: "Contrôle manuel systématique",
};

export type EligibilityIssueCode =
  | "missing_level"
  | "below_level"
  | "below_min"
  | "above_max";

/** Écart métier structuré : le texte n'est jamais utilisé pour décider du blocage. */
export interface EligibilityIssue {
  code: EligibilityIssueCode;
  message: string;
  /** En mode STRICT, `below_min` reste non bloquant car une collaboration peut compléter l'équipe. */
  blocksStrict: boolean;
  count: number;
}

export interface TeamEligibilityInput {
  /** Un niveau absent est représenté par null/undefined, jamais par un ordre fictif. */
  participantLevels: readonly (number | null | undefined)[];
  groupSizeMin: number;
  groupSizeMax: number;
  minLevel: { order: number; label: string } | null;
}

/**
 * Calcule une seule fois les écarts d'une équipe nommément sélectionnée.
 *
 * La fonction est pure afin que le dépôt, l'acceptation et l'attribution
 * manuelle appliquent exactement les mêmes règles. Le minimum est une cible
 * d'équipe : une revendication trop petite reste recevable pour permettre à
 * plusieurs groupes de collaborer. Le maximum et les niveaux sont individuels
 * à la revendication et bloquent donc le mode STRICT.
 */
export function evaluateTeamEligibility(input: TeamEligibilityInput): EligibilityIssue[] {
  const headcount = input.participantLevels.length;
  const issues: EligibilityIssue[] = [];

  if (headcount < input.groupSizeMin) {
    issues.push({
      code: "below_min",
      count: input.groupSizeMin - headcount,
      blocksStrict: false,
      message:
        `L'effectif proposé est de ${headcount} membre(s) ; minimum demandé : ${input.groupSizeMin}. ` +
        "Une collaboration avec un autre groupe est nécessaire.",
    });
  }

  if (headcount > input.groupSizeMax) {
    issues.push({
      code: "above_max",
      count: headcount - input.groupSizeMax,
      blocksStrict: true,
      message: `L'effectif proposé est de ${headcount} membre(s) ; maximum demandé : ${input.groupSizeMax}.`,
    });
  }

  const minLevel = input.minLevel;
  if (minLevel) {
    const missingLevelCount = input.participantLevels.filter(
      (level) => typeof level !== "number" || !Number.isFinite(level),
    ).length;
    if (missingLevelCount > 0) {
      issues.push({
        code: "missing_level",
        count: missingLevelCount,
        blocksStrict: true,
        message: `${missingLevelCount} membre(s) sélectionné(s) n'ont aucun niveau renseigné.`,
      });
    }

    const belowLevelCount = input.participantLevels.filter(
      (level) => typeof level === "number" && Number.isFinite(level) && level < minLevel.order,
    ).length;
    if (belowLevelCount > 0) {
      issues.push({
        code: "below_level",
        count: belowLevelCount,
        blocksStrict: true,
        message:
          `${belowLevelCount} membre(s) sélectionné(s) se trouvent sous le niveau minimal ` +
          `(${minLevel.label}).`,
      });
    }
  }

  return issues;
}

export interface EligibilityDecision {
  allowed: boolean;
  /** Messages enregistrés sur la revendication et visibles par la modération. */
  claimWarnings: string[];
  /** Messages retournés au chef qui tente la revendication. */
  responseWarnings: string[];
}

/** Applique le mode choisi aux écarts structurés calculés pour l'équipe. */
export function applyEligibilityMode(
  mode: EligibilityModeValue,
  issues: readonly EligibilityIssue[],
): EligibilityDecision {
  const warnings = issues.map((issue) => issue.message);

  switch (mode) {
    case "RECOMMENDATION":
      return { allowed: true, claimWarnings: [], responseWarnings: [] };
    case "WARNING":
      return { allowed: true, claimWarnings: warnings, responseWarnings: warnings };
    case "STRICT":
      return {
        allowed: !issues.some((issue) => issue.blocksStrict),
        claimWarnings: warnings,
        responseWarnings: warnings,
      };
    case "MANUAL_REVIEW": {
      const reviewWarnings = [MANUAL_REVIEW_NOTICE, ...warnings];
      return {
        allowed: true,
        claimWarnings: reviewWarnings,
        // Compatibilité avec les missions historiques : le chef reçoit le
        // signalement manuel, tandis que la modération conserve tous les écarts.
        responseWarnings: [MANUAL_REVIEW_NOTICE],
      };
    }
  }
}
