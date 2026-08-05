import { describe, expect, it } from "vitest";
import {
  invitationCreateSchema,
  onboardingIdentitySchema,
  selfIdentityUpdateSchema,
} from "./schemas";
import { referenceOptionCreateSchema } from "./profile-schemas";

const CUID = "cm12345678901234567890123";

describe("le grade appartient au joueur, pas à l'inviteur", () => {
  const invitation = { roleSlug: "group_member", expiresInHours: 72, requireApproval: true };

  it("une invitation est valide SANS niveau de personnage", () => {
    expect(invitationCreateSchema.safeParse(invitation).success).toBe(true);
  });

  it("un niveau transmis reste accepté (fils historiques)", () => {
    const parsed = invitationCreateSchema.safeParse({ ...invitation, playerLevelId: CUID });
    expect(parsed.success).toBe(true);
  });

  it("l'onboarding EXIGE que le joueur déclare son grade", () => {
    const identity = {
      firstName: "Akira",
      displayName: "L'assassin de l'ombre",
      privacyAcknowledged: true,
    };
    expect(onboardingIdentitySchema.safeParse(identity).success).toBe(false);
    expect(
      onboardingIdentitySchema.safeParse({ ...identity, playerLevelId: CUID }).success,
    ).toBe(true);
  });

  it("la modification de sa propre fiche ne rejoue pas la confidentialité", () => {
    const parsed = selfIdentityUpdateSchema.safeParse({
      firstName: "Akira",
      displayName: "La Vipère de Kiri",
      playerLevelId: CUID,
    });
    expect(parsed.success).toBe(true);
    // privacyAcknowledged est absent du schéma : l'accord initial garde sa date
    expect(parsed.success && "privacyAcknowledged" in parsed.data).toBe(false);
  });
});

describe("création directe d'une entrée de référentiel", () => {
  it("refuse un référentiel inventé", () => {
    const parsed = referenceOptionCreateSchema.safeParse({ type: "HACK", label: "Truc" });
    expect(parsed.success).toBe(false);
  });

  it("accepte un référentiel connu et une teinte #RRGGBB", () => {
    expect(
      referenceOptionCreateSchema.safeParse({
        type: "HAIR_COLOR",
        label: "Blanc cendré",
        colorHex: "#e8e2d4",
      }).success,
    ).toBe(true);
  });

  it("refuse une couleur mal formée", () => {
    expect(
      referenceOptionCreateSchema.safeParse({
        type: "SKIN_TONE",
        label: "Hâlé",
        colorHex: "blanc",
      }).success,
    ).toBe(false);
  });

  it("refuse un libellé vide", () => {
    expect(
      referenceOptionCreateSchema.safeParse({ type: "CLAN_FAMILY", label: "   " }).success,
    ).toBe(false);
  });
});
