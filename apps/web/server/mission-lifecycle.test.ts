import { describe, expect, it } from "vitest";
import {
  canMoveMissionManually,
  canReusePublicRosterConsent,
} from "./mission-lifecycle";

describe("cycle de vie manuel d'une mission", () => {
  it("interdit de créditer une mission qui n'est pas en cours", () => {
    expect(canMoveMissionManually("AVAILABLE", "COMPLETED")).toBe(false);
    expect(canMoveMissionManually("ASSIGNED", "COMPLETED")).toBe(false);
    expect(canMoveMissionManually("ASSIGNED", "FAILED")).toBe(false);
  });

  it("autorise la résolution depuis une mission en cours", () => {
    expect(canMoveMissionManually("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canMoveMissionManually("IN_PROGRESS", "FAILED")).toBe(true);
  });

  it("garde une mission accomplie immuable", () => {
    expect(canMoveMissionManually("COMPLETED", "AVAILABLE")).toBe(false);
  });
});

describe("consentement à publier un roster", () => {
  it("accepte le même roster indépendamment de l'ordre", () => {
    expect(canReusePublicRosterConsent(true, ["a", "b"], ["b", "a"])).toBe(true);
  });

  it("refuse un roster modifié ou un consentement absent", () => {
    expect(canReusePublicRosterConsent(true, ["a", "b"], ["a", "c"])).toBe(false);
    expect(canReusePublicRosterConsent(false, ["a"], ["a"])).toBe(false);
  });
});
