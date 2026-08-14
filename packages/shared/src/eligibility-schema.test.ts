import { describe, expect, it } from "vitest";
import {
  claimDecisionSchema,
  eligibilityModeSchema,
  missionAssignSchema,
  missionCreateSchema,
} from "./schemas";

const cuid = "clx1234567890abcdefghijkl";

describe("schémas d'éligibilité", () => {
  it("réserve MANUAL_REVIEW aux données historiques", () => {
    expect(eligibilityModeSchema.safeParse("RECOMMENDATION").success).toBe(true);
    expect(eligibilityModeSchema.safeParse("WARNING").success).toBe(true);
    expect(eligibilityModeSchema.safeParse("STRICT").success).toBe(true);
    expect(eligibilityModeSchema.safeParse("MANUAL_REVIEW").success).toBe(false);
  });

  it("désactive le contrôle renforcé par défaut sur une nouvelle mission", () => {
    const parsed = missionCreateSchema.parse({
      publicTitle: "Mission de test",
      category: "COLLECTE_INFORMATIONS",
      rank: "D",
      rewardRyoMin: 0,
      rewardRyoMax: 1,
      basePoints: 1,
      groupSizeMin: 1,
      groupSizeMax: 2,
    });

    expect(parsed.requiresEnhancedReview).toBe(false);
    expect(parsed.eligibilityMode).toBe("WARNING");
  });

  it("exige une confirmation explicite par défaut lors d'une décision", () => {
    expect(
      claimDecisionSchema.parse({ claimId: cuid, decision: "ACCEPTED" }).reviewConfirmed,
    ).toBe(false);
    expect(
      claimDecisionSchema.parse({
        claimId: cuid,
        decision: "ACCEPTED",
        reviewConfirmed: true,
      }).reviewConfirmed,
    ).toBe(true);
  });

  it("porte la même confirmation dans l'attribution multi-groupes", () => {
    const parsed = missionAssignSchema.parse({
      missionId: cuid,
      assignments: [{ groupId: "group-1", participantIds: ["agent-1"] }],
    });

    expect(parsed.reviewConfirmed).toBe(false);
  });
});
