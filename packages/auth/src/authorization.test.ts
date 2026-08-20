import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@toile/shared";
import { getUserPermissions } from "./authorization";

const databaseMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@toile/database", () => ({
  prisma: { userRole: { findMany: databaseMocks.findMany } },
}));

beforeEach(() => {
  databaseMocks.findMany.mockReset();
});

function role(slug: string, permissions: string[]) {
  return {
    role: {
      slug,
      permissions: permissions.map((key) => ({ permission: { key } })),
    },
  };
}

describe("getUserPermissions — cumul des rôles", () => {
  it("cumule sans priorité les capacités de modérateur et de chef", async () => {
    databaseMocks.findMany.mockResolvedValue([
      role("moderator", [
        PERMISSIONS.MISSION_CREATE,
        PERMISSIONS.MISSION_ASSIGN,
        PERMISSIONS.CLAIM_REVIEW,
      ]),
      role("group_leader", [
        PERMISSIONS.MISSION_CLAIM,
        PERMISSIONS.MISSION_REPORT_SUBMIT,
        PERMISSIONS.GROUP_MANAGE,
      ]),
    ]);

    const permissions = await getUserPermissions("modo-chef");

    expect(permissions).toEqual(
      new Set([
        PERMISSIONS.MISSION_CREATE,
        PERMISSIONS.MISSION_ASSIGN,
        PERMISSIONS.CLAIM_REVIEW,
        PERMISSIONS.MISSION_CLAIM,
        PERMISSIONS.MISSION_REPORT_SUBMIT,
        PERMISSIONS.GROUP_MANAGE,
      ]),
    );
  });

  it("déduplique une permission partagée par plusieurs rôles", async () => {
    databaseMocks.findMany.mockResolvedValue([
      role("moderator", [PERMISSIONS.LEADERBOARD_VIEW]),
      role("group_leader", [PERMISSIONS.LEADERBOARD_VIEW]),
    ]);

    const permissions = await getUserPermissions("modo-chef");

    expect([...permissions]).toEqual([PERMISSIONS.LEADERBOARD_VIEW]);
  });
});
