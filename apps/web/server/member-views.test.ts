import { describe, expect, it } from "vitest";
import {
  aggregateMemberMissionStats,
  visibleMemberGroups,
  type MemberGroupRecord,
} from "./member-views";

const groups: MemberGroupRecord[] = [
  {
    groupId: "group-a",
    isLeader: true,
    group: { id: "group-a", name: "A", faction: { id: "faction-a", name: "Faction A" } },
  },
  {
    groupId: "group-b",
    isLeader: false,
    group: { id: "group-b", name: "B", faction: null },
  },
];

describe("fiches membres", () => {
  it("ne révèle à un tiers que les appartenances partagées", () => {
    const visible = visibleMemberGroups({
      viewerUserId: "viewer",
      viewerGroupIds: new Set(["group-a"]),
      canViewAllGroups: false,
      targetUserId: "target",
      groups,
    });
    expect(visible.map((membership) => membership.groupId)).toEqual(["group-a"]);
  });

  it("sert toutes les appartenances à l'intéressé et à la modération", () => {
    expect(
      visibleMemberGroups({
        viewerUserId: "target",
        viewerGroupIds: new Set(),
        canViewAllGroups: false,
        targetUserId: "target",
        groups,
      }),
    ).toHaveLength(2);
    expect(
      visibleMemberGroups({
        viewerUserId: "moderator",
        viewerGroupIds: new Set(),
        canViewAllGroups: true,
        targetUserId: "target",
        groups,
      }),
    ).toHaveLength(2);
  });

  it("agrège les récompenses sans inclure de notion de mission active", () => {
    const stats = aggregateMemberMissionStats([
      {
        userId: "target",
        pointsAwarded: 20,
        ryoAwarded: 500,
        mission: { status: "COMPLETED" },
      },
      {
        userId: "target",
        pointsAwarded: 0,
        ryoAwarded: 0,
        mission: { status: "FAILED" },
      },
    ]).get("target");

    expect(stats).toEqual({ resolved: 2, completed: 1, failed: 1, points: 20, ryos: 500 });
  });
});
