import { describe, expect, it } from "vitest";
import { shareInteger } from "./reward-sharing";

describe("shareInteger", () => {
  it("partage équitablement sans perdre le reste", () => {
    const result = shareInteger(10, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(result).toEqual(new Map([["a", 4], ["b", 3], ["c", 3]]));
  });

  it("répartit proportionnellement aux effectifs des groupes", () => {
    expect(
      shareInteger(100, [
        { key: "groupe-1", weight: 3 },
        { key: "groupe-2", weight: 1 },
      ]),
    ).toEqual(new Map([["groupe-1", 75], ["groupe-2", 25]]));
  });

  it("préserve aussi exactement les pénalités", () => {
    const result = shareInteger(-5, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ]);
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(-5);
  });

  it("refuse les poids invalides et les doublons", () => {
    expect(() => shareInteger(1, [{ key: "a", weight: 0 }])).toThrow();
    expect(() => shareInteger(1, [{ key: "a", weight: 1 }, { key: "a", weight: 1 }])).toThrow();
  });
});
