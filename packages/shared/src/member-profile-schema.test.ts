import { describe, expect, it } from "vitest";
import { selfIdentityUpdateSchema } from "./schemas";

const PLAYER_LEVEL_ID = "cm12345678901234567890123";

const identity = {
  firstName: "Akira",
  lastName: "",
  displayName: "La Vipère de Kiri",
  playerLevelId: PLAYER_LEVEL_ID,
  identityVisibility: "MY_GROUPS" as const,
};

describe("informations personnelles", () => {
  it("accepte une bio et des spécialités du référentiel mission", () => {
    const parsed = selfIdentityUpdateSchema.parse({
      ...identity,
      publicBio: "  Messagère et pisteuse.  ",
      specialties: ["TRAQUE", "INFILTRATION"],
    });

    expect(parsed.publicBio).toBe("Messagère et pisteuse.");
    expect(parsed.specialties).toEqual(["TRAQUE", "INFILTRATION"]);
  });

  it("refuse une bio trop longue et une spécialité inventée", () => {
    expect(
      selfIdentityUpdateSchema.safeParse({ ...identity, publicBio: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(
      selfIdentityUpdateSchema.safeParse({
        ...identity,
        specialties: ["ADMINISTRATION_SECRETE"],
      }).success,
    ).toBe(false);
    expect(
      selfIdentityUpdateSchema.safeParse({
        ...identity,
        specialties: ["TRAQUE", "TRAQUE"],
      }).success,
    ).toBe(false);
  });

  it("reste compatible avec un ancien formulaire sans présentation", () => {
    const parsed = selfIdentityUpdateSchema.parse(identity);

    expect(parsed.publicBio).toBeUndefined();
    expect(parsed.specialties).toBeUndefined();
  });
});
