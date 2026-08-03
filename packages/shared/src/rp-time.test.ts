import { describe, expect, it } from "vitest";
import {
  computeTimeRemaining,
  formatRealDuration,
  formatRpDuration,
  realToRpDuration,
  realDateToRp,
  rpToRealMs,
  DEFAULT_RP_TIME_CONFIG,
} from "./rp-time";

const DAY = 24 * 3600 * 1000;

describe("conversions temps RP (1 jour réel = 1 mois RP)", () => {
  it("1 jour réel → 1 mois RP", () => {
    expect(realToRpDuration(DAY)).toEqual({ years: 0, months: 1, weeks: 0 });
  });

  it("7 jours réels → 7 mois RP ; 12 jours → 1 an", () => {
    expect(realToRpDuration(7 * DAY).months).toBe(7);
    expect(realToRpDuration(12 * DAY)).toEqual({ years: 1, months: 0, weeks: 0 });
  });

  it("aller-retour durée RP → ms → RP", () => {
    const ms = rpToRealMs({ years: 1, months: 2 });
    expect(realToRpDuration(ms)).toEqual({ years: 1, months: 2, weeks: 0 });
  });

  it("2 jours et 7 heures → ≈ 2 mois et 1 semaine (exemple du cahier des charges)", () => {
    const ms = 2 * DAY + 7 * 3600 * 1000;
    expect(formatRealDuration(ms)).toBe("2 jours et 7 heures");
    expect(formatRpDuration(ms)).toBe("≈ 2 mois et 1 semaine en temps RP");
  });

  it("ratio configurable : 12 h réelles par mois RP", () => {
    const config = { ...DEFAULT_RP_TIME_CONFIG, realMsPerRpMonth: 12 * 3600 * 1000 };
    expect(realToRpDuration(DAY, config).months).toBe(2);
  });

  it("date réelle → date RP absolue", () => {
    const { year, month } = realDateToRp(new Date("2026-01-13T00:00:00Z"));
    expect(year).toBe(2); // 12 mois écoulés depuis l'époque
    expect(month).toBe(1);
  });
});

describe("computeTimeRemaining", () => {
  const now = new Date("2026-08-01T00:00:00Z");

  it("mission sans limite", () => {
    const result = computeTimeRemaining({ expiresAt: null }, now);
    expect(result.realMs).toBeNull();
    expect(result.realLabel).toBe("Sans limite de temps");
    expect(result.expired).toBe(false);
  });

  it("mission expirée", () => {
    const result = computeTimeRemaining({ expiresAt: new Date("2026-07-31T00:00:00Z") }, now);
    expect(result.expired).toBe(true);
    expect(result.realMs).toBe(0);
  });

  it("délai suspendu : affiche la réserve", () => {
    const result = computeTimeRemaining(
      {
        expiresAt: new Date("2026-08-05T00:00:00Z"),
        timerSuspendedAt: now,
        timerRemainingMs: BigInt(3 * DAY),
      },
      now,
    );
    expect(result.suspended).toBe(true);
    expect(result.realMs).toBe(3 * DAY);
    expect(result.realLabel).toContain("suspendu");
  });

  it("délai actif : libellés réels et RP", () => {
    const result = computeTimeRemaining({ expiresAt: new Date("2026-08-03T07:00:00Z") }, now);
    expect(result.realLabel).toBe("Expire dans 2 jours et 7 heures");
    expect(result.rpLabel).toBe("≈ 2 mois et 1 semaine en temps RP");
  });
});
