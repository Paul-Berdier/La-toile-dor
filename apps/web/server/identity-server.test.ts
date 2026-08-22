import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupMemberFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock("@toile/database", () => ({
  prisma: {
    groupMember: { findMany: mocks.groupMemberFindMany },
    user: { findMany: mocks.userFindMany },
  },
}));

import { getIdentityViewer, serializeUsersForViewer } from "./identity-server";

const current = {
  session: { userId: "viewer" },
  permissions: new Set<string>(),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groupMemberFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([
    {
      id: "target",
      displayName: "L'Ombre",
      firstName: "Secret",
      lastName: "Interdit",
      identityVisibility: "MY_GROUPS",
      groupMemberships: [],
    },
  ]);
});

describe("identités et groupes actifs", () => {
  it("ne construit le lecteur qu'avec ses appartenances actives", async () => {
    await getIdentityViewer(current);

    expect(mocks.groupMemberFindMany).toHaveBeenCalledWith({
      where: { userId: "viewer", group: { isActive: true } },
      select: { groupId: true },
    });
  });

  it("retire aussi les groupes inactifs des cibles avant sérialisation", async () => {
    const views = await serializeUsersForViewer(current, ["target"]);

    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          groupMemberships: {
            where: { group: { isActive: true } },
            select: { groupId: true },
          },
        }),
      }),
    );
    expect(views.get("target")).toEqual({ id: "target", displayName: "L'Ombre" });
  });
});
