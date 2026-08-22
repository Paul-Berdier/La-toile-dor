import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@toile/shared";

const mocks = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    playerLevel: { findUnique: vi.fn() },
    groupMember: { findUnique: vi.fn() },
    userLevelChangeRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(),
    requireUser: vi.fn(),
    requestMeta: vi.fn(),
    enqueueNotificationsTx: vi.fn(),
    userIdsWithPermissionTx: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/notifications", () => ({
  enqueueNotificationsTx: mocks.enqueueNotificationsTx,
  userIdsWithPermissionTx: mocks.userIdsWithPermissionTx,
}));

import {
  decideUserLevelChangeAction,
  requestUserLevelChangeAction,
} from "./user-level-actions";

const requestedLevelId = "cm12345678901234567890123";
const requestId = "cm22345678901234567890123";

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    targetUserId: "member-2",
    requestedById: "leader-1",
    currentLevelId: "level-1",
    requestedLevelId,
    status: "PENDING",
    targetUser: {
      id: "member-2",
      displayName: "La Vipère",
      status: "ACTIVE",
      profileCompleted: true,
      playerLevelId: "level-1",
      playerLevel: { label: "Genin" },
    },
    requestedLevel: { id: requestedLevelId, label: "Chunin" },
    requestedBy: { id: "leader-1" },
    group: { id: "group-1" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId: "member-1" },
    permissions: new Set(),
  });
  mocks.requestMeta.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) =>
    callback(mocks.tx),
  );
  mocks.tx.user.findUnique.mockResolvedValue({
    id: "member-1",
    displayName: "Ombre",
    status: "ACTIVE",
    profileCompleted: true,
    playerLevelId: "level-1",
    playerLevel: { label: "Genin" },
  });
  mocks.tx.playerLevel.findUnique.mockResolvedValue({ id: requestedLevelId, label: "Chunin" });
  mocks.tx.userLevelChangeRequest.findFirst.mockResolvedValue(null);
  mocks.tx.userLevelChangeRequest.create.mockResolvedValue({ id: requestId });
  mocks.tx.userLevelChangeRequest.findUnique.mockResolvedValue(requestRow());
  mocks.tx.userLevelChangeRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
  mocks.userIdsWithPermissionTx.mockResolvedValue(["moderator-1"]);
  mocks.enqueueNotificationsTx.mockResolvedValue(1);
});

describe("requestUserLevelChangeAction", () => {
  it("permet à un membre actif de demander son propre changement avec motif", async () => {
    const result = await requestUserLevelChangeAction({
      targetUserId: "member-1",
      requestedLevelId,
      reason: "Évolution validée en RP.",
    });

    expect(result.ok).toBe(true);
    expect(mocks.tx.userLevelChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: "member-1",
          requestedById: "member-1",
          currentLevelId: "level-1",
          requestedLevelId,
          groupId: null,
        }),
      }),
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "user.level_change_requested",
          resourceId: "member-1",
        }),
      }),
    );
    expect(mocks.userIdsWithPermissionTx).toHaveBeenCalledWith(
      mocks.tx,
      PERMISSIONS.USER_LEVEL_MANAGE,
    );
    expect(mocks.enqueueNotificationsTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ event: "USER_LEVEL_CHANGE_REQUESTED" }),
    );
  });

  it("fait échouer la transaction si la trace d'audit ne peut pas être écrite", async () => {
    mocks.tx.auditLog.create.mockRejectedValueOnce(new Error("audit indisponible"));

    await expect(
      requestUserLevelChangeAction({
        targetUserId: "member-1",
        requestedLevelId,
        reason: "Évolution validée en RP.",
      }),
    ).rejects.toThrow("audit indisponible");
    expect(mocks.enqueueNotificationsTx).not.toHaveBeenCalled();
  });

  it("autorise un chef uniquement pour un membre actif de son groupe actif", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      session: { userId: "leader-1" },
      permissions: new Set(),
    });
    mocks.tx.user.findUnique.mockResolvedValueOnce({
      id: "member-2",
      displayName: "La Vipère",
      status: "ACTIVE",
      profileCompleted: true,
      playerLevelId: "level-1",
      playerLevel: { label: "Genin" },
    });
    mocks.tx.groupMember.findUnique
      .mockResolvedValueOnce({ isLeader: true, group: { isActive: true, name: "Cellule Or" } })
      .mockResolvedValueOnce({ userId: "member-2" });

    const result = await requestUserLevelChangeAction({
      targetUserId: "member-2",
      groupId: "group-1",
      requestedLevelId,
      reason: "Progression constatée par le chef.",
    });

    expect(result.ok).toBe(true);
  });

  it("refuse un membre qui tente de demander un grade pour autrui sans être chef", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      session: { userId: "member-3" },
      permissions: new Set(),
    });
    mocks.tx.user.findUnique.mockResolvedValueOnce({
      id: "member-2",
      displayName: "La Vipère",
      status: "ACTIVE",
      profileCompleted: true,
      playerLevelId: "level-1",
      playerLevel: { label: "Genin" },
    });
    mocks.tx.groupMember.findUnique
      .mockResolvedValueOnce({ isLeader: false, group: { isActive: true, name: "Cellule Or" } })
      .mockResolvedValueOnce({ userId: "member-2" });

    const result = await requestUserLevelChangeAction({
      targetUserId: "member-2",
      groupId: "group-1",
      requestedLevelId,
      reason: "Tentative non autorisée.",
    });

    expect(result).toEqual({ ok: false, error: "Vous ne dirigez pas ce groupe actif." });
    expect(mocks.tx.userLevelChangeRequest.create).not.toHaveBeenCalled();
  });

  it("refuse un profil dont l'onboarding n'est pas terminé", async () => {
    mocks.tx.user.findUnique.mockResolvedValueOnce({
      id: "member-1",
      displayName: "Ombre",
      status: "ACTIVE",
      profileCompleted: false,
      playerLevelId: "level-1",
      playerLevel: { label: "Genin" },
    });

    const result = await requestUserLevelChangeAction({
      targetUserId: "member-1",
      requestedLevelId,
      reason: "Évolution validée en RP.",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/onboarding/i);
  });

  it("traduit la contrainte P2002 en demande déjà en attente", async () => {
    mocks.tx.userLevelChangeRequest.create.mockRejectedValueOnce({ code: "P2002" });

    const result = await requestUserLevelChangeAction({
      targetUserId: "member-1",
      requestedLevelId,
      reason: "Évolution validée en RP.",
    });

    expect(result).toEqual({
      ok: false,
      error: "Une demande de grade est déjà en attente pour ce membre.",
    });
  });
});

describe("decideUserLevelChangeAction", () => {
  beforeEach(() => {
    mocks.requireUser.mockResolvedValue({
      session: { userId: "moderator-1" },
      permissions: new Set([PERMISSIONS.USER_LEVEL_MANAGE]),
    });
  });

  it("refuse qu'un modérateur tranche son propre grade", async () => {
    mocks.tx.userLevelChangeRequest.findUnique.mockResolvedValueOnce(
      requestRow({ targetUserId: "moderator-1" }),
    );

    const result = await decideUserLevelChangeAction({
      requestId,
      decision: "APPROVED",
      reviewNote: "Validation motivée.",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/autre modérateur/i);
    expect(mocks.tx.userLevelChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuse qu'un modérateur-chef approuve une demande qu'il a déposée", async () => {
    mocks.tx.userLevelChangeRequest.findUnique.mockResolvedValueOnce(
      requestRow({ requestedById: "moderator-1" }),
    );

    const result = await decideUserLevelChangeAction({
      requestId,
      decision: "APPROVED",
      reviewNote: "Auto-validation tentée.",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/autre modérateur/i);
    expect(mocks.tx.userLevelChangeRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("approuve par CAS PENDING et modifie le grade attendu", async () => {
    const result = await decideUserLevelChangeAction({
      requestId,
      decision: "APPROVED",
      reviewNote: "Progression RP confirmée.",
    });

    expect(result.ok).toBe(true);
    expect(mocks.tx.userLevelChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: requestId, status: "PENDING" } }),
    );
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "member-2", playerLevelId: "level-1" }),
        data: { playerLevelId: requestedLevelId },
      }),
    );
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "user.level_change_approved",
          resourceId: "member-2",
        }),
      }),
    );
    expect(mocks.enqueueNotificationsTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ event: "USER_LEVEL_CHANGE_APPROVED" }),
    );
  });

  it("fait échouer la transaction si la notification de décision ne peut pas être mise en file", async () => {
    mocks.enqueueNotificationsTx.mockRejectedValueOnce(new Error("file indisponible"));

    await expect(
      decideUserLevelChangeAction({
        requestId,
        decision: "APPROVED",
        reviewNote: "Progression RP confirmée.",
      }),
    ).rejects.toThrow("file indisponible");
    expect(mocks.tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("refuse proprement une seconde décision lorsque le CAS PENDING est perdu", async () => {
    mocks.tx.userLevelChangeRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await decideUserLevelChangeAction({
      requestId,
      decision: "APPROVED",
      reviewNote: "Progression RP confirmée.",
    });

    expect(result).toEqual({
      ok: false,
      error: "Cette demande a déjà été traitée ou n'existe plus.",
    });
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("permet de refuser une demande devenue obsolète sans écraser le grade actuel", async () => {
    mocks.tx.userLevelChangeRequest.findUnique.mockResolvedValueOnce(
      requestRow({
        targetUser: {
          id: "member-2",
          displayName: "La Vipère",
          status: "ACTIVE",
          profileCompleted: true,
          playerLevelId: "level-other",
          playerLevel: { label: "Jonin" },
        },
      }),
    );

    const result = await decideUserLevelChangeAction({
      requestId,
      decision: "REJECTED",
      reviewNote: "Demande obsolète après correction.",
    });

    expect(result.ok).toBe(true);
    expect(mocks.tx.userLevelChangeRequest.updateMany).toHaveBeenCalledOnce();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
  });
});
