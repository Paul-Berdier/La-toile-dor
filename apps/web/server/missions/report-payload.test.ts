import { describe, expect, it } from "vitest";
import type { MissionReportFinalizeInput } from "@toile/shared";
import { toStoredMissionReportPayload } from "./report-payload";

const MISSION_ID = "clzzzzzzzzzzzzzzzzzzzzzzz";
const TARGET_ID = "clyyyyyyyyyyyyyyyyyyyyyyy";
const PROFILE_ID = "clxxxxxxxxxxxxxxxxxxxxxxx";

describe("payload immuable d'un rapport final", () => {
  it("conserve les observations structurées sans dupliquer la mission", () => {
    const input: MissionReportFinalizeInput = {
      missionId: MISSION_ID,
      outcomes: [{ targetId: TARGET_ID, outcome: "ESCAPED", note: "Par les toits" }],
      summary: "La cible a pris la fuite.",
      dossiers: [{ profileId: PROFILE_ID, noNewInfo: true, entries: [] }],
      discovered: [
        {
          localId: "ninja-1",
          firstName: "Hiro",
          outcome: "UNKNOWN",
          entries: [{ fieldKey: "details", knowledgeState: "KNOWN", value: "Complice aperçu" }],
        },
      ],
      step: 2,
    };

    const stored = toStoredMissionReportPayload(input);

    expect("missionId" in stored).toBe(false);
    expect(stored).toEqual({
      outcomes: input.outcomes,
      summary: input.summary,
      dossiers: input.dossiers,
      discovered: input.discovered,
      step: 2,
    });
  });
});
