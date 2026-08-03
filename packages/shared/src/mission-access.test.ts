import { describe, expect, it } from "vitest";
import { resolveMissionViewLevel } from "./mission-access";

const base = {
  isModerator: false,
  viewerGroupIds: new Set<string>(),
  viewerLedGroupIds: new Set<string>(),
  isExplicitParticipant: false,
  assignedGroupIds: ["assigned-group"],
  legacyAssignedGroupId: null,
};

describe("niveau d'accès à une mission", () => {
  it("garde public le chef avant acceptation ou le chef d'un autre groupe", () => {
    expect(
      resolveMissionViewLevel({
        ...base,
        assignedGroupIds: [],
        viewerGroupIds: new Set(["candidate"]),
        viewerLedGroupIds: new Set(["candidate"]),
      }),
    ).toBe("public");
    expect(
      resolveMissionViewLevel({
        ...base,
        viewerGroupIds: new Set(["other-group"]),
        viewerLedGroupIds: new Set(["other-group"]),
      }),
    ).toBe("public");
  });

  it("donne la vue agent à un membre ou participant explicite", () => {
    expect(
      resolveMissionViewLevel({ ...base, viewerGroupIds: new Set(["assigned-group"]) }),
    ).toBe("assigned");
    expect(resolveMissionViewLevel({ ...base, isExplicitParticipant: true })).toBe("assigned");
  });

  it("donne la vue cible au chef du groupe accepté seulement", () => {
    expect(
      resolveMissionViewLevel({
        ...base,
        viewerGroupIds: new Set(["assigned-group"]),
        viewerLedGroupIds: new Set(["assigned-group"]),
      }),
    ).toBe("leader");
  });

  it("donne toujours la vue complète à la modération", () => {
    expect(resolveMissionViewLevel({ ...base, isModerator: true })).toBe("moderator");
  });
});
