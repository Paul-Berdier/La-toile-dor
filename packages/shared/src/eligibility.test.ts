import { describe, expect, it } from "vitest";
import {
  applyEligibilityMode,
  evaluateTeamEligibility,
  MANUAL_REVIEW_NOTICE,
  type EligibilityIssue,
} from "./eligibility";

const blockingIssue: EligibilityIssue = {
  code: "below_level",
  count: 1,
  blocksStrict: true,
  message: "Un membre est sous le niveau minimal.",
};
const collaborationIssue: EligibilityIssue = {
  code: "below_min",
  count: 1,
  blocksStrict: false,
  message: "Une collaboration est nécessaire.",
};

describe("evaluateTeamEligibility", () => {
  const base = {
    groupSizeMin: 2,
    groupSizeMax: 4,
    minLevel: { order: 4, label: "Chunin" },
  } as const;

  it("accepte exactement les bornes avec des niveaux suffisants", () => {
    expect(evaluateTeamEligibility({ ...base, participantLevels: [4, 7] })).toEqual([]);
    expect(evaluateTeamEligibility({ ...base, participantLevels: [4, 5, 6, 7] })).toEqual([]);
  });

  it("distingue un minimum incomplet, complétable par collaboration", () => {
    expect(evaluateTeamEligibility({ ...base, participantLevels: [4] })).toMatchObject([
      { code: "below_min", count: 1, blocksStrict: false },
    ]);
  });

  it("distingue le dépassement du maximum", () => {
    expect(evaluateTeamEligibility({ ...base, participantLevels: [4, 4, 4, 4, 4] })).toMatchObject([
      { code: "above_max", count: 1, blocksStrict: true },
    ]);
  });

  it("sépare les niveaux manquants des niveaux insuffisants", () => {
    expect(evaluateTeamEligibility({ ...base, participantLevels: [null, undefined, 3, 4] })).toMatchObject([
      { code: "missing_level", count: 2, blocksStrict: true },
      { code: "below_level", count: 1, blocksStrict: true },
    ]);
  });

  it("ignore les niveaux absents lorsqu'aucun minimum n'est configuré", () => {
    expect(
      evaluateTeamEligibility({
        ...base,
        minLevel: null,
        participantLevels: [null, undefined],
      }),
    ).toEqual([]);
  });
});

describe("applyEligibilityMode", () => {
  const issues = [collaborationIssue, blockingIssue];
  const warnings = issues.map((issue) => issue.message);

  it("n'émet aucune alerte en mode recommandation", () => {
    expect(applyEligibilityMode("RECOMMENDATION", issues)).toEqual({
      allowed: true,
      claimWarnings: [],
      responseWarnings: [],
    });
  });

  it("signale tous les écarts sans bloquer en mode avertissement", () => {
    expect(applyEligibilityMode("WARNING", issues)).toEqual({
      allowed: true,
      claimWarnings: warnings,
      responseWarnings: warnings,
    });
  });

  it("ne bloque pas un minimum incomplet pouvant être complété par collaboration", () => {
    expect(applyEligibilityMode("STRICT", [collaborationIssue])).toEqual({
      allowed: true,
      claimWarnings: [collaborationIssue.message],
      responseWarnings: [collaborationIssue.message],
    });
  });

  it("bloque les autres écarts en mode strict", () => {
    expect(applyEligibilityMode("STRICT", issues)).toEqual({
      allowed: false,
      claimWarnings: warnings,
      responseWarnings: warnings,
    });
    expect(applyEligibilityMode("STRICT", []).allowed).toBe(true);
  });

  it("conserve le comportement des missions MANUAL_REVIEW historiques", () => {
    expect(applyEligibilityMode("MANUAL_REVIEW", issues)).toEqual({
      allowed: true,
      claimWarnings: [MANUAL_REVIEW_NOTICE, ...warnings],
      responseWarnings: [MANUAL_REVIEW_NOTICE],
    });
    expect(applyEligibilityMode("MANUAL_REVIEW", []).claimWarnings).toEqual([
      MANUAL_REVIEW_NOTICE,
    ]);
  });
});
