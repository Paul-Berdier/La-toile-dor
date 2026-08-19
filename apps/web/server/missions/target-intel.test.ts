import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@toile/database";

vi.mock("server-only", () => ({}));

import { applyMissionOutcomeToProfiles } from "./target-intel";

function transactionFor(createdByGroupId: string | null) {
  const createGrant = vi.fn().mockResolvedValue({ id: "grant" });
  const tx = {
    missionTarget: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "target-1",
          profileId: "profile-1",
          outcome: "UNKNOWN",
          note: null,
        },
      ]),
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
