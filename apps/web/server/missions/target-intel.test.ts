import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@toile/database";

vi.mock("server-only", () => ({}));

import { applyMissionOutcomeToProfiles } from "./target-intel";

function transactionFor(createdByGroupId: string | null, outcome = "UNKNOWN") {
  const createGrant = vi.fn().mockResolvedValue({ id: "grant" });
  const tx = {
    missionTarget: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "target-1",
          profileId: "profile-1",
          outcome,
          note: null,
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    characterProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: "profile-1",
        code: "PRF-000001",
        lifeStatus: "UNKNOWN",
        archivedAt: null,
        mergedIntoId: null,
        createdByGroupId,
      }),
      update: vi.fn(),
    },
    characterFieldIntel: { upsert: vi.fn() },
    characterProfileRevision: { create: vi.fn().mockResolvedValue({}) },
    profileAccessGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: createGrant,
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    createGrant,
  };
}

const baseInput = {
  missionId: "mission-1",
  missionCode: "MIS-000001",
  actorId: "moderator-1",
  clientProfileId: null,
};

describe("accès gagnés sur les cibles d'une mission", () => {
  it("accorde l'accès à tous les groupes engagés quand un tiers possède déjà le dossier", async () => {
    const { tx, createGrant } = transactionFor("owner-group");

    await applyMissionOutcomeToProfiles(tx, {
      ...baseInput,
      groupIds: ["assigned-a", "assigned-b"],
    });

    expect(createGrant).toHaveBeenCalledTimes(2);
    expect(createGrant).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: "profile-1",
        groupId: "assigned-a",
        sourceType: "MISSION_GRANTED",
        sourceId: "mission-1",
      }),
    });
    expect(createGrant).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: "profile-1",
        groupId: "assigned-b",
        sourceType: "MISSION_GRANTED",
        sourceId: "mission-1",
      }),
    });
  });

  it("ne crée pas de grant redondant pour le groupe propriétaire", async () => {
    const { tx, createGrant } = transactionFor("assigned-a");

    const result = await applyMissionOutcomeToProfiles(tx, {
      ...baseInput,
      groupIds: ["assigned-a", "assigned-b"],
    });

    expect(createGrant).toHaveBeenCalledTimes(1);
    expect(createGrant).toHaveBeenCalledWith({
      data: expect.objectContaining({ groupId: "assigned-b" }),
    });
    expect(result.grantsCreated).toBe(1);
  });
});

describe("mission d'élimination accomplie : la cible est présumée morte", () => {
  it("une cible au sort inconnu passe ELIMINATED et son dossier DEAD", async () => {
    const { tx } = transactionFor("owner-group");

    const result = await applyMissionOutcomeToProfiles(tx, {
      ...baseInput,
      groupIds: [],
      missionCategory: "ELIMINATION",
      missionSucceeded: true,
    });

    const mocked = tx as unknown as {
      missionTarget: { update: ReturnType<typeof vi.fn> };
      characterProfile: { update: ReturnType<typeof vi.fn> };
      characterFieldIntel: { upsert: ReturnType<typeof vi.fn> };
    };
    // Le sort est consigné sur la cible…
    expect(mocked.missionTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: "ELIMINATED" }) }),
    );
    // …et l'état vital du dossier suit, avec sa source
    expect(mocked.characterProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lifeStatus: "DEAD" }) }),
    );
    expect(mocked.characterFieldIntel.upsert).toHaveBeenCalled();
    expect(result.lifeStatusUpdated).toContain("PRF-000001");
  });

  it("un sort explicite (en fuite) n'est jamais écrasé par la présomption", async () => {
    const { tx } = transactionFor("owner-group", "ESCAPED");

    await applyMissionOutcomeToProfiles(tx, {
      ...baseInput,
      groupIds: [],
      missionCategory: "ELIMINATION",
      missionSucceeded: true,
    });

    const mocked = tx as unknown as {
      missionTarget: { update: ReturnType<typeof vi.fn> };
      characterProfile: { update: ReturnType<typeof vi.fn> };
    };
    expect(mocked.missionTarget.update).not.toHaveBeenCalled();
    expect(mocked.characterProfile.update).not.toHaveBeenCalled();
  });

  it("une élimination ÉCHOUÉE ne présume rien", async () => {
    const { tx } = transactionFor("owner-group");

    await applyMissionOutcomeToProfiles(tx, {
      ...baseInput,
      groupIds: [],
      missionCategory: "ELIMINATION",
      missionSucceeded: false,
    });

    const mocked = tx as unknown as { characterProfile: { update: ReturnType<typeof vi.fn> } };
    expect(mocked.characterProfile.update).not.toHaveBeenCalled();
  });
});
