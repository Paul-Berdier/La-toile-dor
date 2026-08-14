import { describe, expect, it } from "vitest";
import { hasCompatibleLedGroup } from "./mission-compatibility";

const mission = {
  groupSizeMin: 2,
  groupSizeMax: 4,
  minRecommendedLevel: { label: "Chūnin", order: 20 },
};

describe("filtre de compatibilité des missions", () => {
  it("ne retourne aucune mission quand l'utilisateur ne dirige aucun groupe", () => {
    expect(hasCompatibleLedGroup([], mission)).toBe(false);
  });

  it("accepte un grand groupe capable de former un sous-ensemble conforme", () => {
    expect(
      hasCompatibleLedGroup(
        [
          {
            members: [20, 30, 40, 50, 60, 70, 80, 90].map((levelOrder) => ({ levelOrder })),
          },
        ],
        mission,
      ),
    ).toBe(true);
  });

  it("accepte une contribution sous le minimum qu'un autre groupe peut compléter", () => {
    expect(
      hasCompatibleLedGroup(
        [{ members: [{ levelOrder: 30 }, { levelOrder: 10 }, { levelOrder: null }] }],
        mission,
      ),
    ).toBe(true);
  });

  it("refuse un groupe qui ne peut fournir aucun agent au niveau demandé", () => {
    expect(
      hasCompatibleLedGroup(
        [{ members: [{ levelOrder: 10 }, { levelOrder: null }] }],
        mission,
      ),
    ).toBe(false);
  });
});
