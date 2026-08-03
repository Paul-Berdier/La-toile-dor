import { describe, expect, it } from "vitest";
import { canViewAssignmentRoster, toPublicRosterAgent } from "./assignment-visibility";

describe("visibilité du roster d'une mission", () => {
  const groupId = "group-a";

  it("reste invisible pour un autre joueur par défaut", () => {
    expect(
      canViewAssignmentRoster({
        isModerator: false,
        viewerGroupIds: new Set(["group-b"]),
        assignmentGroupId: groupId,
        publicRoster: false,
      }),
    ).toBe(false);
  });

  it("est toujours visible par la modération et par son propre groupe", () => {
    expect(
      canViewAssignmentRoster({
        isModerator: true,
        viewerGroupIds: new Set(),
        assignmentGroupId: groupId,
        publicRoster: false,
      }),
    ).toBe(true);
    expect(
      canViewAssignmentRoster({
        isModerator: false,
        viewerGroupIds: new Set([groupId]),
        assignmentGroupId: groupId,
        publicRoster: false,
      }),
    ).toBe(true);
  });

  it("devient visible aux autres lorsque le chef l'autorise", () => {
    expect(
      canViewAssignmentRoster({
        isModerator: false,
        viewerGroupIds: new Set(),
        assignmentGroupId: groupId,
        publicRoster: true,
      }),
    ).toBe(true);
  });

  it("ne sérialise que le pseudonyme public", () => {
    const publicAgent = toPublicRosterAgent({
      displayName: "Le Tisseur d'or",
      firstName: "Secret",
      lastName: "Masqué",
    } as { displayName: string });

    expect(publicAgent).toEqual({ displayName: "Le Tisseur d'or" });
    expect(publicAgent).not.toHaveProperty("firstName");
    expect(publicAgent).not.toHaveProperty("lastName");
  });
});
