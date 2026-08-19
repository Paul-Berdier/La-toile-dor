import { describe, expect, it } from "vitest";
import {
  EMPTY_REPORT_PAYLOAD,
  missionReportFinalizeSchema,
  missionReportPayloadSchema,
  untreatedDossiers,
} from "./mission-report";

const ID = "clzzzzzzzzzzzzzzzzzzzzzzz";
const ID2 = "clyyyyyyyyyyyyyyyyyyyyyyy";
const OPT = "clxxxxxxxxxxxxxxxxxxxxxxx";

describe("rapport de fin de mission — brouillon et finalisation", () => {
  it("un brouillon vide est valide, une finalisation vide ne l'est pas", () => {
    expect(missionReportPayloadSchema.safeParse(EMPTY_REPORT_PAYLOAD).success).toBe(true);
    expect(missionReportFinalizeSchema.safeParse({ ...EMPTY_REPORT_PAYLOAD, missionId: ID }).success).toBe(false);
    expect(
      missionReportFinalizeSchema.safeParse({ ...EMPTY_REPORT_PAYLOAD, missionId: ID, summary: "Cible observée au marché." }).success,
    ).toBe(true);
  });

  it("valide chaque renseignement selon la forme de son champ", () => {
    const ok = missionReportPayloadSchema.safeParse({
      ...EMPTY_REPORT_PAYLOAD,
      dossiers: [{ profileId: ID, noNewInfo: false, entries: [{ fieldKey: "faction", value: OPT }] }],
    });
    expect(ok.success).toBe(true);
    const bad = missionReportPayloadSchema.safeParse({
      ...EMPTY_REPORT_PAYLOAD,
      dossiers: [{ profileId: ID, noNewInfo: false, entries: [{ fieldKey: "faction", value: "Suna" }] }],
    });
    expect(bad.success).toBe(false);
  });

  it("un ninja découvert a besoin d'un prénom", () => {
    const res = missionReportPayloadSchema.safeParse({
      ...EMPTY_REPORT_PAYLOAD,
      discovered: [{ localId: "n1", firstName: "  ", outcome: "UNKNOWN", entries: [] }],
    });
    expect(res.success).toBe(false);
  });

  it("chaque dossier cible doit être traité — « rien de neuf » suffit", () => {
    const payload = {
      ...EMPTY_REPORT_PAYLOAD,
      dossiers: [
        { profileId: ID, noNewInfo: true, entries: [] },
        { profileId: ID2, noNewInfo: false, entries: [] },
      ],
    };
    expect(untreatedDossiers(payload, [ID, ID2])).toEqual([ID2]);
    expect(untreatedDossiers(payload, [ID])).toEqual([]);
    expect(untreatedDossiers(EMPTY_REPORT_PAYLOAD, [ID])).toEqual([ID]);
  });
});
