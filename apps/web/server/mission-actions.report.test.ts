import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requestMeta: vi.fn(),
  findMission: vi.fn(),
  createReport: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
  getAccessContext: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: {
    mission: { findUnique: mocks.findMission },
    missionReport: { create: mocks.createReport },
  },
}));
vi.mock("@toile/auth", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/notifications", () => ({
  enqueueNotifications: vi.fn(),
  groupMemberIds: vi.fn(),
  userIdsWithPermission: vi.fn(),
}));
vi.mock("@/server/mission-lifecycle", () => ({
  canMoveMissionManually: vi.fn(),
}));
vi.mock("@/server/missions", () => ({
  getAccessContext: mocks.getAccessContext,
}));
vi.mock("@/server/missions/target-intel", () => ({
  applyMissionOutcomeToProfiles: vi.fn(),
}));
vi.mock("@/server/missions/target-requirements", () => ({
  checkTargetIntel: vi.fn(),
}));
vi.mock("@/server/image-validation", () => ({
  isFileLike: vi.fn(() => false),
  sniffImageMime: vi.fn(),
}));

import { submitReportAction } from "./mission-actions";

function reportForm() {
  const formData = new FormData();
  formData.set("missionId", "mission-1");
  formData.set("content", "Point d'étape suffisamment détaillé.");
  return formData;
}

function missionFixture(input: {
  assignedGroupId: string | null;
  activeGroupIds: string[];
}) {
  return {
    id: "mission-1",
    code: "MIS-000001",
    rank: "B",
    category: "ESCORT",
    publicTitle: "Mission de test",
    assignedGroupId: input.assignedGroupId,
    assignments: input.activeGroupIds.map((groupId) => ({ groupId })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId: "leader-1" },
    permissions: new Set(),
  });
  mocks.requestMeta.mockResolvedValue({});
  mocks.createReport.mockResolvedValue({ id: "report-1" });
});

describe("autorisation d'un point d'étape de mission", () => {
  it("refuse l'ancien groupe quand une affectation active normalisée existe", async () => {
    mocks.findMission.mockResolvedValue(
      missionFixture({ assignedGroupId: "legacy-group", activeGroupIds: ["active-group"] }),
    );
    mocks.getAccessContext.mockResolvedValue({
      isModerator: false,
      groupIds: new Set(["legacy-group"]),
    });

    await expect(submitReportAction(reportForm())).resolves.toEqual({
      ok: false,
      error: "Vous n'êtes pas affecté à cette mission.",
    });
    expect(mocks.createReport).not.toHaveBeenCalled();
  });

  it("autorise un groupe présent dans les affectations actives", async () => {
    mocks.findMission.mockResolvedValue(
      missionFixture({ assignedGroupId: "legacy-group", activeGroupIds: ["active-group"] }),
    );
    mocks.getAccessContext.mockResolvedValue({
      isModerator: false,
      groupIds: new Set(["active-group"]),
    });

    await expect(submitReportAction(reportForm())).resolves.toEqual({ ok: true });
    expect(mocks.createReport).toHaveBeenCalledWith({
      data: expect.objectContaining({ missionId: "mission-1", authorId: "leader-1" }),
    });
  });

  it("utilise le champ historique uniquement sans affectation active", async () => {
    mocks.findMission.mockResolvedValue(
      missionFixture({ assignedGroupId: "legacy-group", activeGroupIds: [] }),
    );
    mocks.getAccessContext.mockResolvedValue({
      isModerator: false,
      groupIds: new Set(["legacy-group"]),
    });

    await expect(submitReportAction(reportForm())).resolves.toEqual({ ok: true });
    expect(mocks.findMission).toHaveBeenCalledWith({
      where: { id: "mission-1" },
      include: {
        assignments: { where: { active: true }, select: { groupId: true } },
      },
    });
  });
});
