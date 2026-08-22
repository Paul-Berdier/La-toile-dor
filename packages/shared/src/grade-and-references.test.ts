import { describe, expect, it } from "vitest";
import {
  invitationCreateSchema,
  onboardingIdentitySchema,
  selfIdentityUpdateSchema,
  userLevelChangeDecisionSchema,
  userLevelChangeRequestCreateSchema,
} from "./schemas";
import { referenceOptionCreateSchema } from "./profile-schemas";

const CUID = "cm12345678901234567890123";

describe("le grade du personnage", () => {
  const invitation = { roleSlug: "group_member", expiresInHours: 72 };

  it("une invitation exige un niveau de personnage", () => {
    expect(invitationCreateSchema.safeParse(invitation).success).toBe(false);
  });

  it("accepte le grade fixé par l'inviteur", () => {
    const parsed = invitationCreateSchema.safeParse({ ...invitation, playerLevelId: CUID });
    expect(parsed.success).toBe(true);
  });

  it("ignore une ancienne demande d'approbation manuelle", () => {
    const parsed = invitationCreateSchema.safeParse({
      ...invitation,
      playerLevelId: CUID,
      requireApproval: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "requireApproval" in parsed.data).toBe(false);
  });

  it("l'onboarding exige un identifiant de grade, contrôlé ensuite côté serveur", () => {
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

  it("la modification de sa propre fiche accepte le grade sans rejouer la confidentialité", () => {
    const parsed = selfIdentityUpdateSchema.safeParse({
      firstName: "Akira",
      displayName: "La Vipère de Kiri",
      playerLevelId: CUID,
    });
    expect(parsed.success).toBe(true);
    // privacyAcknowledged est absent du schéma : l'accord initial garde sa date
    expect(parsed.success && "privacyAcknowledged" in parsed.data).toBe(false);
    expect(parsed.success && parsed.data.playerLevelId).toBe(CUID);
  });
});

describe("workflow motivé d'évolution du grade", () => {
  it("accepte les identifiants lisibles des comptes et groupes de démonstration", () => {
    expect(
      userLevelChangeRequestCreateSchema.safeParse({
        targetUserId: "demo-member-1",
        requestedLevelId: CUID,
        groupId: "demo-group-1",
        reason: "Évolution validée en RP.",
      }).success,
    ).toBe(true);
  });

  it("exige un motif pour la demande et pour la décision", () => {
    expect(
      userLevelChangeRequestCreateSchema.safeParse({
        targetUserId: "demo-member-1",
        requestedLevelId: CUID,
        reason: "",
      }).success,
    ).toBe(false);
    expect(
      userLevelChangeDecisionSchema.safeParse({
        requestId: CUID,
        decision: "APPROVED",
        reviewNote: "",
      }).success,
    ).toBe(false);
  });

  it("limite la décision à approuver ou refuser", () => {
    expect(
      userLevelChangeDecisionSchema.safeParse({
        requestId: CUID,
        decision: "CANCELLED",
        reviewNote: "Décision motivée.",
      }).success,
    ).toBe(false);
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
