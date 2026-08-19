import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@toile/database", () => ({
  prisma: { $transaction: databaseMocks.transaction },
}));

import {
  claimPendingContribution,
  lockContributionProfile,
  runContributionTransaction,
} from "./contribution-transactions";

beforeEach(() => {
  databaseMocks.transaction.mockReset();
});

describe("transactions de contributions", () => {
  it("reprend une transaction sérialisable annulée pour conflit", async () => {
    const conflict = Object.assign(new Error("write conflict"), { code: "P2034" });
    databaseMocks.transaction
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (work: (tx: object) => Promise<string>) => work({}));

    await expect(runContributionTransaction(async () => "ok")).resolves.toBe("ok");
    expect(databaseMocks.transaction).toHaveBeenCalledTimes(3);
    expect(databaseMocks.transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it("ne masque pas une erreur qui n'est pas un conflit sérialisable", async () => {
    const failure = new Error("database unavailable");
    databaseMocks.transaction.mockRejectedValue(failure);

    await expect(runContributionTransaction(async () => "never")).rejects.toBe(failure);
    expect(databaseMocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("verrouille le dossier et refuse une source déjà fusionnée", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "profile-1", version: 4, archivedAt: null, mergedIntoId: null }])
      .mockResolvedValueOnce([{ id: "profile-1", version: 4, archivedAt: new Date(), mergedIntoId: "profile-2" }]);
    const tx = { $queryRaw: queryRaw } as never;

    await expect(lockContributionProfile(tx, "profile-1")).resolves.toMatchObject({
      id: "profile-1",
      version: 4,
    });
    await expect(lockContributionProfile(tx, "profile-1")).rejects.toThrow("PROFILE_UNAVAILABLE");
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("lie le claim atomique au dossier d'origine", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { profileIntelContribution: { updateMany } } as never;
    const reviewedAt = new Date("2026-08-19T12:00:00.000Z");

    await expect(
      claimPendingContribution(tx, {
        contributionId: "contribution-1",
        profileId: "profile-1",
        status: "ACCEPTED",
        reviewerId: "reviewer-1",
        reviewNote: "Vérifié",
        reviewedAt,
      }),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "contribution-1",
        profileId: "profile-1",
        status: "PENDING_REVIEW",
      },
      data: {
        status: "ACCEPTED",
        reviewedById: "reviewer-1",
        reviewedAt,
        reviewNote: "Vérifié",
      },
    });
  });
});
