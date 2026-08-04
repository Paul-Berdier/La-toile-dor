/**
 * Âge des personnages des dossiers de renseignement.
 *
 * L'âge n'est JAMAIS une valeur statique : on stocke des instants réels UTC
 * de référence et l'âge est dérivé du service central de temps RP
 * (rp-time.ts — 1 jour réel = 1 mois RP, année RP configurable).
 *
 * - BIRTH_DATE_RP : birthRealAt = instant réel où l'âge RP valait 0 ;
 * - AGE_AT_REFERENCE : âge observé à ageReferenceRealAt ;
 * - AGE_RANGE_AT_REFERENCE : plage observée à ageReferenceRealAt ;
 * - un personnage MORT a son âge figé à deathRealAt (si connue) ;
 * - un DISPARU continue de vieillir tant que la mort n'est pas confirmée.
 */

import { DEFAULT_RP_TIME_CONFIG, type RpTimeConfig } from "./rp-time";

export type ProfileAgeModeCode =
  | "UNKNOWN"
  | "BIRTH_DATE_RP"
  | "AGE_AT_REFERENCE"
  | "AGE_RANGE_AT_REFERENCE";

export interface CharacterAgeInput {
  ageMode: ProfileAgeModeCode;
  birthRealAt?: Date | null;
  ageYearsAtRef?: number | null;
  ageMinAtRef?: number | null;
  ageMaxAtRef?: number | null;
  ageReferenceRealAt?: Date | null;
  lifeStatus?: string | null;
  deathRealAt?: Date | null;
}

export type CharacterAge =
  | { kind: "unknown" }
  | { kind: "exact"; years: number; frozen: boolean }
  | { kind: "range"; minYears: number; maxYears: number; frozen: boolean };

/** Années RP entières écoulées entre deux instants réels. */
export function rpYearsBetween(
  from: Date,
  to: Date,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const months = ms / config.realMsPerRpMonth;
  return Math.floor(months / (config.rpMonthsPerYear ?? 7));
}

export function computeCharacterAge(
  input: CharacterAgeInput,
  now: Date,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): CharacterAge {
  // Un mort à la date connue cesse de vieillir ; sinon (mort sans date,
  // disparu, vivant, inconnu) l'âge progresse jusqu'à maintenant.
  const frozen = input.lifeStatus === "DEAD" && input.deathRealAt != null;
  const effectiveNow = frozen ? input.deathRealAt! : now;

  switch (input.ageMode) {
    case "BIRTH_DATE_RP": {
      if (!input.birthRealAt) return { kind: "unknown" };
      return {
        kind: "exact",
        years: rpYearsBetween(input.birthRealAt, effectiveNow, config),
        frozen,
      };
    }
    case "AGE_AT_REFERENCE": {
      if (input.ageYearsAtRef == null || !input.ageReferenceRealAt) return { kind: "unknown" };
      const elapsed = rpYearsBetween(input.ageReferenceRealAt, effectiveNow, config);
      return { kind: "exact", years: input.ageYearsAtRef + elapsed, frozen };
    }
    case "AGE_RANGE_AT_REFERENCE": {
      if (
        input.ageMinAtRef == null ||
        input.ageMaxAtRef == null ||
        !input.ageReferenceRealAt
      ) {
        return { kind: "unknown" };
      }
      const elapsed = rpYearsBetween(input.ageReferenceRealAt, effectiveNow, config);
      return {
        kind: "range",
        minYears: input.ageMinAtRef + elapsed,
        maxYears: input.ageMaxAtRef + elapsed,
        frozen,
      };
    }
    default:
      return { kind: "unknown" };
  }
}

/** « 24 ans », « Entre 18 et 21 ans », suffixe « (figé au décès) ». */
export function formatCharacterAge(age: CharacterAge): string | null {
  if (age.kind === "unknown") return null;
  const suffix = age.frozen ? " (figé au décès)" : "";
  if (age.kind === "exact") {
    return `${age.years} an${age.years > 1 ? "s" : ""}${suffix}`;
  }
  return `Entre ${age.minYears} et ${age.maxYears} ans${suffix}`;
}
