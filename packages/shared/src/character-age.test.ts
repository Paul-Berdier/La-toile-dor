import { describe, expect, it } from "vitest";
import {
  computeCharacterAge,
  formatCharacterAge,
  rpYearsBetween,
} from "./character-age";
import { DEFAULT_RP_TIME_CONFIG } from "./rp-time";

const DAY = 86_400_000;
const RP_YEAR_MS = 7 * DAY; // 1 semaine réelle = 1 année RP (année de 7 mois)
const now = new Date("2026-08-04T00:00:00Z");
const realAgo = (ms: number) => new Date(now.getTime() - ms);

describe("rpYearsBetween — années RP entières via le service central", () => {
  it("1 semaine réelle = 1 année RP", () => {
    expect(rpYearsBetween(realAgo(RP_YEAR_MS), now)).toBe(1);
  });
  it("6 jours réels = 0 année RP révolue", () => {
    expect(rpYearsBetween(realAgo(6 * DAY), now)).toBe(0);
  });
  it("ratio configurable", () => {
    const config = { ...DEFAULT_RP_TIME_CONFIG, rpMonthsPerYear: 12 };
    expect(rpYearsBetween(realAgo(12 * DAY), now, config)).toBe(1);
  });
});

describe("computeCharacterAge", () => {
  it("UNKNOWN → âge inconnu", () => {
    expect(computeCharacterAge({ ageMode: "UNKNOWN" }, now)).toEqual({ kind: "unknown" });
    expect(formatCharacterAge({ kind: "unknown" })).toBeNull();
  });

  it("BIRTH_DATE_RP : âge depuis la naissance", () => {
    const age = computeCharacterAge(
      { ageMode: "BIRTH_DATE_RP", birthRealAt: realAgo(24 * RP_YEAR_MS + 3 * DAY) },
      now,
    );
    expect(age).toEqual({ kind: "exact", years: 24, frozen: false });
  });

  it("AGE_AT_REFERENCE : 18 ans observés il y a 2 années RP → 20 ans", () => {
    const age = computeCharacterAge(
      {
        ageMode: "AGE_AT_REFERENCE",
        ageYearsAtRef: 18,
        ageReferenceRealAt: realAgo(2 * RP_YEAR_MS),
      },
      now,
    );
    expect(age).toEqual({ kind: "exact", years: 20, frozen: false });
    expect(formatCharacterAge(age)).toBe("20 ans");
  });

  it("AGE_RANGE_AT_REFERENCE : la plage progresse avec le temps RP", () => {
    const age = computeCharacterAge(
      {
        ageMode: "AGE_RANGE_AT_REFERENCE",
        ageMinAtRef: 18,
        ageMaxAtRef: 21,
        ageReferenceRealAt: realAgo(3 * RP_YEAR_MS),
      },
      now,
    );
    expect(age).toEqual({ kind: "range", minYears: 21, maxYears: 24, frozen: false });
    expect(formatCharacterAge(age)).toBe("Entre 21 et 24 ans");
  });

  it("personnage MORT : âge figé à la date du décès", () => {
    const age = computeCharacterAge(
      {
        ageMode: "AGE_AT_REFERENCE",
        ageYearsAtRef: 30,
        ageReferenceRealAt: realAgo(5 * RP_YEAR_MS),
        lifeStatus: "DEAD",
        deathRealAt: realAgo(2 * RP_YEAR_MS), // mort 3 années RP après l'observation
      },
      now,
    );
    expect(age).toEqual({ kind: "exact", years: 33, frozen: true });
    expect(formatCharacterAge(age)).toBe("33 ans (figé au décès)");
  });

  it("personnage DISPARU : continue de vieillir", () => {
    const age = computeCharacterAge(
      {
        ageMode: "AGE_AT_REFERENCE",
        ageYearsAtRef: 30,
        ageReferenceRealAt: realAgo(5 * RP_YEAR_MS),
        lifeStatus: "MISSING",
        deathRealAt: null,
      },
      now,
    );
    expect(age).toEqual({ kind: "exact", years: 35, frozen: false });
  });

  it("mort SANS date de décès connue : l'âge n'est pas figé", () => {
    const age = computeCharacterAge(
      {
        ageMode: "AGE_AT_REFERENCE",
        ageYearsAtRef: 30,
        ageReferenceRealAt: realAgo(RP_YEAR_MS),
        lifeStatus: "DEAD",
      },
      now,
    );
    expect(age).toEqual({ kind: "exact", years: 31, frozen: false });
  });
});
