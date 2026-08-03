import { describe, expect, it } from "vitest";
import { applyEligibilityMode, MANUAL_REVIEW_NOTICE } from "./eligibility";

const gaps = ["Effectif inférieur au minimum.", "Un membre est sous le niveau recommandé."];

describe("applyEligibilityMode", () => {
  it("n'émet aucune alerte en mode recommandation", () => {
    expect(applyEligibilityMode("RECOMMENDATION", gaps)).toEqual({
      allowed: true,
      claimWarnings: [],
      responseWarnings: [],
    });
  });

  it("signale les écarts sans bloquer en mode avertissement", () => {
    expect(applyEligibilityMode("WARNING", gaps)).toEqual({
      allowed: true,
      claimWarnings: gaps,
      responseWarnings: gaps,
    });
  });

  it("bloque uniquement si un critère strict n'est pas rempli", () => {
    expect(applyEligibilityMode("STRICT", gaps).allowed).toBe(false);
    expect(applyEligibilityMode("STRICT", []).allowed).toBe(true);
  });

  it("demande toujours une validation manuelle et conserve les écarts", () => {
    expect(applyEligibilityMode("MANUAL_REVIEW", gaps)).toEqual({
      allowed: true,
      claimWarnings: [MANUAL_REVIEW_NOTICE, ...gaps],
      responseWarnings: [MANUAL_REVIEW_NOTICE],
    });
    expect(applyEligibilityMode("MANUAL_REVIEW", []).claimWarnings).toEqual([
      MANUAL_REVIEW_NOTICE,
    ]);
  });
});
