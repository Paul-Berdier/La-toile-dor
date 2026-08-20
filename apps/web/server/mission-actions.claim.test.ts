import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    groupMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    mission: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    missionClaim: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    missionClaimParticipant: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    missionStatusHistory: { create: vi.fn() },
  };

  return {
    tx,
    transaction: vi.fn(),
    requireUser: vi.fn(),
    requestMeta: vi.fn(),
    getAccessContext: vi.fn(),
    findMembers: vi.fn(),
    findMission: vi.fn(),
    findClaim: vi.fn(),
    audit: vi.fn(),
    enqueueNotifications: vi.fn(),
    userIdsWithPermission: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: {
    groupMember: { findMany: mocks.findMembers },
    mission: { findUnique: mocks.findMission },
    missionClaim: { findUnique: mocks.findClaim },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@toile/auth", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/notifications", () => ({
  enqueueNotifications: mocks.enqueueNotifications,
  groupMemberIds: vi.fn(),
  userIdsWithPermission: mocks.userIdsWithPermission,
}));
vi.mock("@/server/mission-lifecycle", () => ({ canMoveMissionManually: vi.fn() }));
vi.mock("@/server/missions", () => ({ getAccessContext: mocks.getAccessContext }));
vi.mock("@/server/missions/target-intel", () => ({ applyMissionOutcomeToProfiles: vi.fn() }));
vi.mock("@/server/missions/target-requirements", () => ({ checkTargetIntel: vi.fn() }));
vi.mock("@/server/image-validation", () => ({
  isFileLike: vi.fn(() => false),
  sniffImageMime: vi.fn(),
}));

import { claimMissionAction } from "./mission-actions";

const missionId = "cm12345678901234567890123";
const groupId = "cm22345678901234567890123";
const agentId = "cm32345678901234567890123";

const input = {
  missionId,
  groupId,
  participantIds: [agentId],
  publicRoster: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId: "moderator-leader", user: { displayName: "Modo-chef" } },
    // Cas volontairement désynchronisé : rôle modérateur, sans mission.claim.
    permissions: new Set(["mission.view.all", "mission.view.confidential", "claim.review"]),
  });
  mocks.requestMeta.mockResolvedValue({});
  mocks.getAccessContext.mockResolvedValue({
    userId: "moderator-leader",
    isModerator: true,
    groupIds: new Set([groupId]),
    ledGroups: [{ id: groupId, name: "Cellule Or", members: [] }],
    participantMissionIds: new Set(),
  });
  mocks.findMembers.mockResolvedValue([{ userId: agentId }]);
  mocks.findMission.mockResolvedValue({
    id: missionId,
    code: "MIS-000001",
    rank: "B",
    category: "ESCORT",
    publicTitle: "Fil de test",
    status: "AVAILABLE",
    groupSizeMin: 1,
    groupSizeMax: 3,
    eligibilityMode: "STRICT",
    minRecommendedLevel: null,
  });
  mocks.findClaim.mockResolvedValue(null);
  mocks.tx.groupMember.findFirst.mockResolvedValue({ userId: "moderator-leader" });
  mocks.tx.groupMember.findMany.mockResolvedValue([
    { userId: agentId, user: { playerLevel: { order: 1 } } },
  ]);
  mocks.tx.mission.findUnique.mockResolvedValue({
    status: "AVAILABLE",
    groupSizeMin: 1,
    groupSizeMax: 3,
    eligibilityMode: "STRICT",
    minRecommendedLevel: null,
  });
  mocks.tx.missionClaim.findUnique.mockResolvedValue(null);
  mocks.tx.missionClaim.create.mockResolvedValue({ id: "claim-1" });
  mocks.tx.missionClaimParticipant.createMany.mockResolvedValue({ count: 1 });
  mocks.tx.mission.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.missionStatusHistory.create.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) =>
    callback(mocks.tx),
  );
  mocks.userIdsWithPermission.mockResolvedValue([]);
});

describe("claimMissionAction — autorité concrète du groupe", () => {
  it("autorise un modérateur qui dirige réellement le groupe même sans permission mission.claim", async () => {
    const result = await claimMissionAction(input);

    expect(result.ok).toBe(true);
    expect(mocks.tx.groupMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          groupId,
          userId: "moderator-leader",
          isLeader: true,
          group: { isActive: true },
        }),
      }),
    );
    expect(mocks.tx.missionClaim.create).toHaveBeenCalledOnce();
  });

  it("refuse un modérateur qui ne dirige pas le groupe", async () => {
    mocks.getAccessContext.mockResolvedValueOnce({
      userId: "moderator-only",
      isModerator: true,
      groupIds: new Set([groupId]),
      ledGroups: [],
      participantMissionIds: new Set(),
    });

    const result = await claimMissionAction(input);

    expect(result).toEqual({ ok: false, error: "Vous ne dirigez pas ce groupe." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
