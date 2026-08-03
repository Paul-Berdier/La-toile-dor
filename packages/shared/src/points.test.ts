import { describe, expect, it } from "vitest";
import { computeMissionScore } from "./points";

describe("computeMissionScore", () => {
  it("mission accomplie : points de base du rang", () => {
    const { total, breakdown } = computeMissionScore("A", "COMPLETED");
    expect(total).toBe(140);
    expect(breakdown).toEqual([{ reason: "MISSION_COMPLETED", points: 140 }]);
  });

  it("mission échouée : pénalité de la moitié des points", () => {
    expect(computeMissionScore("S", "FAILED").total).toBe(-150);
  });

  it("bonus cumulés : rapidité + discrétion + objectifs + rapport", () => {
    const { total, breakdown } = computeMissionScore("B", "COMPLETED", {
      speedBonus: true, // +12 (20 %)
      stealthBonus: true, // +9 (15 %)
      secondaryObjectivePoints: 25,
      reportQualityPct: 10, // +6
    });
    expect(breakdown).toHaveLength(5);
    expect(total).toBe(60 + 12 + 9 + 25 + 6);
  });

  it("le bonus de rapport est plafonné à 20 %", () => {
    const { breakdown } = computeMissionScore("B", "COMPLETED", { reportQualityPct: 90 });
    const report = breakdown.find((line) => line.reason === "REPORT_QUALITY");
    expect(report?.points).toBe(12); // 20 % de 60
  });

  it("points de base configurables (override admin)", () => {
    expect(computeMissionScore("D", "COMPLETED", {}, 999).total).toBe(999);
  });
});
