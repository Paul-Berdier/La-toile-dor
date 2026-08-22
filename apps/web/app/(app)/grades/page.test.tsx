import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isStreamerMode: vi.fn(),
  levelFindMany: vi.fn(),
  userFindUniqueOrThrow: vi.fn(),
  membershipFindMany: vi.fn(),
  requestFindMany: vi.fn(),
  requestFindFirst: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/streamer", () => ({ isStreamerMode: mocks.isStreamerMode }));
vi.mock("@toile/database", () => ({
  prisma: {
    playerLevel: { findMany: mocks.levelFindMany },
    user: { findUniqueOrThrow: mocks.userFindUniqueOrThrow },
    groupMember: { findMany: mocks.membershipFindMany },
    userLevelChangeRequest: {
      findMany: mocks.requestFindMany,
      findFirst: mocks.requestFindFirst,
    },
  },
}));
vi.mock("@/components/grades/grade-request-form", () => ({
  GradeRequestForm: () => null,
}));
vi.mock("@/components/grades/grade-decision-card", () => ({
  GradeDecisionCard: () => null,
}));

import GradesPage from "./page";

describe("GradesPage en mode Streamer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.requireUser.mockResolvedValue({
      session: { userId: "moderator-1" },
      permissions: new Set(["user.level.manage"]),
    });
    mocks.isStreamerMode.mockResolvedValue(true);
  });

  it("coupe avant toute lecture de la file et de ses motifs", async () => {
    const view = await GradesPage();
    const html = renderToStaticMarkup(view);

    expect(mocks.levelFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.membershipFindMany).not.toHaveBeenCalled();
    expect(mocks.requestFindMany).not.toHaveBeenCalled();
    expect(mocks.requestFindFirst).not.toHaveBeenCalled();
    expect(html).toContain("File protégée");
    expect(html).toContain("ne sont pas chargés");
  });
});
