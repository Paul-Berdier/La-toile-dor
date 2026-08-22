import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@toile/shared";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requestMeta: vi.fn(),
  groupFindUnique: vi.fn(),
  groupFindFirst: vi.fn(),
  groupUpdate: vi.fn(),
  groupMemberFindUnique: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: {
    group: {
      findUnique: mocks.groupFindUnique,
      findFirst: mocks.groupFindFirst,
      update: mocks.groupUpdate,
    },
    groupMember: { findUnique: mocks.groupMemberFindUnique },
  },
}));
vi.mock("@toile/auth", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/notifications", () => ({ enqueueNotifications: vi.fn() }));
vi.mock("@/server/image-validation", () => ({
  sniffImageMime: vi.fn(),
  isFileLike: vi.fn(),
}));

import { updateGroupAction } from "./group-actions";

const group = {
  id: "group-gold",
  name: "Les Veilleurs",
  factionId: null,
  isActive: true,
  primaryCountry: "Pays du Feu",
  primaryVillage: "Konoha",
  specialties: ["INFILTRATION"],
};

const renamedValues = {
  name: "Les Tisseurs d'Or",
  primaryCountry: "Pays du Feu",
  primaryVillage: "Konoha",
  specialties: ["INFILTRATION"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId: "leader-multirole" },
    permissions: new Set<string>(),
  });
  mocks.requestMeta.mockResolvedValue({ ipHash: null, userAgent: null });
  mocks.groupFindUnique.mockResolvedValue(group);
  mocks.groupFindFirst.mockResolvedValue(null);
  mocks.groupUpdate.mockResolvedValue({ ...group, name: renamedValues.name });
  mocks.audit.mockResolvedValue(undefined);
});

describe("updateGroupAction — autorité locale du chef", () => {
  it("permet à un vrai chef multi-rôle de renommer le groupe qu'il dirige", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      session: { userId: "leader-multirole" },
      // Plusieurs rôles fonctionnels, sans dépendre du passe-partout modérateur.
      permissions: new Set([
        PERMISSIONS.MISSION_CREATE,
        PERMISSIONS.MISSION_CLAIM,
        PERMISSIONS.CLAIM_REVIEW,
      ]),
    });
    mocks.groupMemberFindUnique.mockResolvedValueOnce({ isLeader: true });

    const result = await updateGroupAction({
      groupId: group.id,
      values: renamedValues,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.groupMemberFindUnique).toHaveBeenCalledWith({
      where: {
        groupId_userId: {
          groupId: group.id,
          userId: "leader-multirole",
        },
      },
      select: { isLeader: true },
    });
    expect(mocks.groupUpdate).toHaveBeenCalledWith({
      where: { id: group.id },
      data: {
        name: renamedValues.name,
        primaryCountry: renamedValues.primaryCountry,
        primaryVillage: renamedValues.primaryVillage,
        specialties: renamedValues.specialties,
      },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "leader-multirole",
        action: "group.updated",
        resourceId: group.id,
        oldValues: expect.objectContaining({ name: group.name }),
        newValues: expect.objectContaining({ name: renamedValues.name }),
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/groupes/${group.id}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/groupes");
  });

  it("refuse un agent même s'il possède ailleurs le rôle global de chef", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      session: { userId: "leader-elsewhere" },
      // Ces permissions viennent du rôle group_leader, mais ne donnent aucune
      // autorité sur un groupe où l'appartenance réelle dit `isLeader=false`.
      permissions: new Set([
        PERMISSIONS.GROUP_MANAGE,
        PERMISSIONS.MISSION_CLAIM,
        PERMISSIONS.MISSION_REPORT_SUBMIT,
      ]),
    });
    mocks.groupMemberFindUnique.mockResolvedValueOnce({ isLeader: false });

    const result = await updateGroupAction({
      groupId: group.id,
      values: renamedValues,
    });

    expect(result).toEqual({
      ok: false,
      error: "Seuls les chefs de ce groupe et la modération peuvent le modifier.",
    });
    expect(mocks.groupUpdate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("conserve l'accès de la modération sans exiger une chefferie locale", async () => {
    mocks.requireUser.mockResolvedValueOnce({
      session: { userId: "moderator-agent" },
      permissions: new Set([PERMISSIONS.GROUP_EDIT_ANY]),
    });

    const result = await updateGroupAction({
      groupId: group.id,
      values: renamedValues,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.groupMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.groupUpdate).toHaveBeenCalledOnce();
  });
});
