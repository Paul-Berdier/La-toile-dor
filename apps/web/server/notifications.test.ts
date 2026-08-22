import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  globalDb: {
    notificationPreference: { findMany: vi.fn() },
    notificationDelivery: { createMany: vi.fn() },
    userRole: { findMany: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@toile/database", () => ({ prisma: mocks.globalDb }));

import {
  enqueueNotificationsTx,
  userIdsWithPermissionTx,
} from "./notifications";

function transactionClient() {
  return {
    notificationPreference: { findMany: vi.fn() },
    notificationDelivery: { createMany: vi.fn() },
    userRole: { findMany: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("helpers transactionnels de notifications", () => {
  it("lit les préférences et met en file exclusivement via la transaction fournie", async () => {
    const tx = transactionClient();
    tx.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "moderator-2",
        enabled: false,
        mutedUntil: null,
        rankFilter: [],
        categoryFilter: [],
      },
    ]);
    tx.notificationDelivery.createMany.mockResolvedValue({ count: 1 });

    const count = await enqueueNotificationsTx(tx as never, {
      userIds: ["moderator-1", "moderator-2", "moderator-1"],
      event: "USER_LEVEL_CHANGE_REQUESTED",
      payload: { title: "La Vipère", note: "Genin → Chunin" },
      batchKey: "user-level:request-1",
    });

    expect(count).toBe(1);
    expect(tx.notificationPreference.findMany).toHaveBeenCalledOnce();
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "moderator-1",
          event: "USER_LEVEL_CHANGE_REQUESTED",
          batchKey: "user-level:request-1",
        }),
      ],
    });
    expect(mocks.globalDb.notificationPreference.findMany).not.toHaveBeenCalled();
    expect(mocks.globalDb.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it("résout et déduplique les détenteurs de permission dans la transaction", async () => {
    const tx = transactionClient();
    tx.userRole.findMany.mockResolvedValue([
      { userId: "moderator-1" },
      { userId: "moderator-1" },
      { userId: "moderator-2" },
    ]);

    await expect(
      userIdsWithPermissionTx(tx as never, "user.level.manage"),
    ).resolves.toEqual(["moderator-1", "moderator-2"]);
    expect(tx.userRole.findMany).toHaveBeenCalledOnce();
    expect(mocks.globalDb.userRole.findMany).not.toHaveBeenCalled();
  });
});
