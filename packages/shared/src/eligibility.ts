export type EligibilityModeValue =
  | "RECOMMENDATION"
  | "WARNING"
  | "STRICT"
  | "MANUAL_REVIEW";

export const MANUAL_REVIEW_NOTICE =
  "Validation manuelle systématique requise, même si les critères automatiques sont remplis.";

export const ELIGIBILITY_MODE_LABELS: Record<EligibilityModeValue, string> = {
  RECOMMENDATION: "Recommandation",
  WARNING: "Avertissement",
  STRICT: "Blocage strict",
  MANUAL_REVIEW: "Contrôle manuel systématique",
};

export interface EligibilityDecision {
  allowed: boolean;
  /** Messages enregistrés sur la revendication et visibles par la modération. */
  claimWarnings: string[];
  /** Messages retournés au chef qui tente la revendication. */
  responseWarnings: string[];
}

/**
 * Applique la politique choisie aux écarts calculés pour une revendication.
 * Le calcul des critères reste indépendant de leur mode d'application.
 */
export function applyEligibilityMode(
  mode: EligibilityModeValue,
  criteriaWarnings: readonly string[],
): EligibilityDecision {
  const warnings = [...criteriaWarnings];

  switch (mode) {
    case "RECOMMENDATION":
      return { allowed: true, claimWarnings: [], responseWarnings: [] };
    case "WARNING":
      return { allowed: true, claimWarnings: warnings, responseWarnings: warnings };
    case "STRICT":
      return {
        allowed: warnings.length === 0,
        claimWarnings: warnings,
        responseWarnings: warnings,
      };
    case "MANUAL_REVIEW": {
      const reviewWarnings = [MANUAL_REVIEW_NOTICE, ...warnings];
      return {
        allowed: true,
        claimWarnings: reviewWarnings,
        responseWarnings: [MANUAL_REVIEW_NOTICE],
      };
    }
  }
}
