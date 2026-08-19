import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyContributionValue, isContributableField } from "./contributions";

function profileFixture() {
  return {
    characterLastName: "Uchiha",
    sexCode: "OTHER",
    heightMinCm: 175,
    heightMaxCm: 182,
    hairColorId: "hair-old",
    skinToneId: "skin-old",
    eyeColorId: "eye-primary-old",
    eyeColorSecondaryId: "eye-secondary-old",
    ninjaClassId: "class-old",
    factionId: "faction-old",
    rankId: "rank-old",
    lifeStatus: "MISSING",
    details: "Ancien détail",
    strengths: "Ancienne force",
    weaknesses: "Ancienne faiblesse",
    ageMode: "UNKNOWN",
    ageYearsAtRef: null,
    ageMinAtRef: null,
    ageMaxAtRef: null,
    deathRealAt: null,
    missingSinceRealAt: null,
    traits: [
      { optionId: "clan-old-1", option: { type: "CLAN_FAMILY" } },
      { optionId: "nature-old-1", option: { type: "CHAKRA_NATURE" } },
      { optionId: "clan-old-2", option: { type: "CLAN_FAMILY" } },
    ],
  };
}

function transactionFixture(profile = profileFixture()) {
  return {
    characterProfile: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(profile),
      update: vi.fn().mockResolvedValue({}),
    },
    characterProfileTrait: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    characterFieldIntel: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    characterProfileRevision: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

const scalarNoneCases = [
  ["lastName", "Uchiha", { characterLastName: null }],
  ["hairColor", "hair-old", { hairColorId: null }],
  ["ninjaClass", "class-old", { ninjaClassId: null }],
  ["faction", "faction-old", { factionId: null }],
  ["rank", "rank-old", { rankId: null }],
] as const;

describe("application d'une absence vérifiée", () => {
  it.each(scalarNoneCases)("historise puis vide %s", async (fieldKey, expectedOldValue, clearedData) => {
    const tx = transactionFixture();

    await applyContributionValue(tx as never, "profile-1", fieldKey, null, "NONE_CONFIRMED", {
      actorId: "reviewer-1",
    });

    expect(tx.characterProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: expect.objectContaining({
        ...clearedData,
        updatedById: "reviewer-1",
        version: { increment: 1 },
      }),
    });
    expect(tx.characterProfileRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: "profile-1",
        fieldKey,
        oldValue: expectedOldValue,
        newValue: { noneConfirmed: true },
      }),
    });
  });

  it("historise les identifiants du bon type avant de supprimer une liste de traits", async () => {
    const tx = transactionFixture();

    await applyContributionValue(tx as never, "profile-1", "clans", null, "NONE_CONFIRMED", {
      actorId: "reviewer-1",
    });

    expect(tx.characterProfileTrait.deleteMany).toHaveBeenCalledWith({
      where: { profileId: "profile-1", option: { type: "CLAN_FAMILY" } },
    });
    expect(tx.characterProfileRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValue: ["clan-old-1", "clan-old-2"],
        newValue: { noneConfirmed: true },
      }),
    });
  });

  it("remplace la provenance et la confiance au lieu de conserver celles de l'ancienne valeur", async () => {
    const tx = transactionFixture();

    await applyContributionValue(tx as never, "profile-1", "lastName", null, "NONE_CONFIRMED", {
      actorId: "reviewer-1",
      sourceMissionId: null,
      confidence: null,
    });

    expect(tx.characterFieldIntel.upsert).toHaveBeenCalledWith({
      where: { profileId_fieldKey: { profileId: "profile-1", fieldKey: "lastName" } },
      update: expect.objectContaining({
        knowledgeState: "NONE_CONFIRMED",
        confidence: null,
        sourceMissionId: null,
        sourceNote: null,
        observedAtRp: null,
      }),
      create: expect.objectContaining({
        knowledgeState: "NONE_CONFIRMED",
        confidence: null,
        sourceMissionId: null,
      }),
    });
  });

  it("conserve la nouvelle provenance lorsqu'elle accompagne l'absence vérifiée", async () => {
    const tx = transactionFixture();

    await applyContributionValue(tx as never, "profile-1", "lastName", null, "NONE_CONFIRMED", {
      actorId: "reviewer-1",
      sourceMissionId: "mission-new",
      confidence: "CONFIRMED",
    });

    expect(tx.characterFieldIntel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          confidence: "CONFIRMED",
          sourceMissionId: "mission-new",
        }),
      }),
    );
  });
});

describe("reconnaissance des champs contribuables", () => {
  it("n'accepte pas une propriété héritée de Object comme clé de champ", () => {
    expect(isContributableField("toString")).toBe(false);
  });
});
