import { describe, expect, it } from "vitest";
import {
  resolveFieldDisplay,
  normalizeRefLabel,
  formatHeight,
  formatProfileCode,
} from "./profile-fields";

describe("resolveFieldDisplay — Inconnu vs ???", () => {
  it("UNKNOWN → « Inconnu » pour TOUT le monde (même non autorisé)", () => {
    expect(resolveFieldDisplay("UNKNOWN", false)).toEqual({
      displayState: "UNKNOWN",
      displayValue: "Inconnu",
    });
    expect(resolveFieldDisplay("UNKNOWN", true).displayValue).toBe("Inconnu");
  });

  it("KNOWN + non autorisé → « ??? » sans valeur", () => {
    expect(resolveFieldDisplay("KNOWN", false)).toEqual({
      displayState: "REDACTED",
      displayValue: "???",
    });
  });

  it("KNOWN + autorisé → VISIBLE (valeur fournie par le sérialiseur)", () => {
    expect(resolveFieldDisplay("KNOWN", true).displayState).toBe("VISIBLE");
  });

  it("NONE_CONFIRMED : « Aucun » pour l'autorisé, « ??? » sinon (c'est un acquis)", () => {
    expect(resolveFieldDisplay("NONE_CONFIRMED", true).displayValue).toBe("Aucun");
    expect(resolveFieldDisplay("NONE_CONFIRMED", false).displayValue).toBe("???");
  });

  it("CONFLICTING : « Information contradictoire » / « ??? »", () => {
    expect(resolveFieldDisplay("CONFLICTING", true).displayValue).toBe(
      "Information contradictoire",
    );
    expect(resolveFieldDisplay("CONFLICTING", false).displayValue).toBe("???");
  });
});

describe("normalizeRefLabel — anti-doublons de référentiel", () => {
  it("Uchiha / UCHIWA / Uchïha ne varient plus", () => {
    expect(normalizeRefLabel("  Uchïha ")).toBe("uchiha");
    expect(normalizeRefLabel("UCHIHA")).toBe("uchiha");
    expect(normalizeRefLabel("Clan   Uchiha")).toBe("clan uchiha");
  });
});

describe("formatHeight — plage en cm, jamais une chaîne stockée", () => {
  it("exacte, plage, bornes ouvertes, inconnue", () => {
    expect(formatHeight(185, 185)).toBe("185 cm");
    expect(formatHeight(180, 190)).toBe("Entre 180 et 190 cm");
    expect(formatHeight(180, null)).toBe("Plus de 180 cm");
    expect(formatHeight(null, 190)).toBe("Moins de 190 cm");
    expect(formatHeight(null, null)).toBeNull();
  });
});

describe("formatProfileCode", () => {
  it("PRF-000142", () => {
    expect(formatProfileCode(142)).toBe("PRF-000142");
  });
});
