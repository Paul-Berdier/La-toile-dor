import { describe, expect, it } from "vitest";
import { missionAssignSchema, missionClaimSchema } from "./schemas";

const missionId = "cm12345678901234567890123";
const groupId = "cm22345678901234567890123";
const agent1 = "cm32345678901234567890123";
const agent2 = "cm42345678901234567890123";

describe("équipes nominatives de mission", () => {
  it("exige au moins un agent dans une revendication", () => {
    expect(missionClaimSchema.safeParse({ missionId, groupId, participantIds: [] }).success).toBe(false);
    expect(
      missionClaimSchema.safeParse({ missionId, groupId, participantIds: [agent1] }).success,
    ).toBe(true);
  });

  it("refuse un agent dupliqué dans une revendication", () => {
    expect(
      missionClaimSchema.safeParse({ missionId, groupId, participantIds: [agent1, agent1] }).success,
    ).toBe(false);
  });

  it("garde le roster privé par défaut et accepte le choix public explicite", () => {
    const hidden = missionClaimSchema.parse({ missionId, groupId, participantIds: [agent1] });
    const visible = missionClaimSchema.parse({
      missionId,
      groupId,
      participantIds: [agent1],
      publicRoster: true,
    });

    expect(hidden.publicRoster).toBe(false);
    expect(visible.publicRoster).toBe(true);
  });

  it("accepte plusieurs groupes avec des agents distincts", () => {
    expect(
      missionAssignSchema.safeParse({
        missionId,
        start: true,
        assignments: [
          { groupId, participantIds: [agent1], isLead: true },
          { groupId: "cm52345678901234567890123", participantIds: [agent2], isLead: false },
        ],
      }).success,
    ).toBe(true);
  });

  it("refuse qu'un agent représente deux groupes sur la même mission", () => {
    expect(
      missionAssignSchema.safeParse({
        missionId,
        start: true,
        assignments: [
          { groupId, participantIds: [agent1], isLead: true },
          { groupId: "cm52345678901234567890123", participantIds: [agent1], isLead: false },
        ],
      }).success,
    ).toBe(false);
  });
});
