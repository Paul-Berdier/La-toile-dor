import { describe, expect, it } from "vitest";
import {
  EMPTY_REPORT_PAYLOAD,
  missionReportFinalizeSchema,
  missionReportPayloadSchema,
  sanitizeMissionReportPayload,
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

  it("accepte une saisie partielle dans le brouillon, mais pas à la finalisation", () => {
    const drafts = [
      {
        ...EMPTY_REPORT_PAYLOAD,
        dossiers: [{ profileId: ID, noNewInfo: false, entries: [{ fieldKey: "faction" as const }] }],
      },
      {
        ...EMPTY_REPORT_PAYLOAD,
        discovered: [{ localId: "n1", firstName: "", outcome: "UNKNOWN" as const, entries: [] }],
      },
    ];

    for (const draft of drafts) {
      expect(missionReportPayloadSchema.safeParse(draft).success).toBe(true);
      expect(
        missionReportFinalizeSchema.safeParse({
          ...draft,
          missionId: ID,
          summary: "Cible observée au marché.",
        }).success,
      ).toBe(false);
    }
  });

  it("valide strictement la forme des renseignements à la finalisation", () => {
    const valid = {
      ...EMPTY_REPORT_PAYLOAD,
      missionId: ID,
      summary: "Cible observée au marché.",
      dossiers: [{ profileId: ID, noNewInfo: false, entries: [{ fieldKey: "faction", value: OPT }] }],
    };
    expect(missionReportFinalizeSchema.safeParse(valid).success).toBe(true);
    expect(
      missionReportFinalizeSchema.safeParse({
        ...valid,
        dossiers: [{ profileId: ID, noNewInfo: false, entries: [{ fieldKey: "faction", value: "Suna" }] }],
      }).success,
    ).toBe(false);
  });

  it("nettoie les valeurs valides avant de stocker le brouillon", () => {
    const parsed = missionReportPayloadSchema.parse({
      ...EMPTY_REPORT_PAYLOAD,
      summary: "  Observation nocturne.  ",
      dossiers: [
        {
          profileId: ID,
          noNewInfo: false,
          entries: [
            { fieldKey: "details", value: "  Traces sur les toits.  ", note: "  témoin direct  " },
            { fieldKey: "eyeColor", value: { primaryId: OPT, secondaryId: null, injected: "à retirer" } },
            { fieldKey: "kekkeiGenkai", knowledgeState: "NONE_CONFIRMED", value: { injected: "à retirer" } },
          ],
        },
      ],
    });

    const sanitized = sanitizeMissionReportPayload(parsed);
    const [details, eyes, none] = sanitized.dossiers[0]!.entries;
    expect(sanitized.summary).toBe("Observation nocturne.");
    expect(details).toMatchObject({ value: "Traces sur les toits.", note: "témoin direct" });
    expect(eyes?.value).toEqual({ primaryId: OPT, secondaryId: null });
    expect(none?.value).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain("injected");
  });

  it("borne chaque valeur et la taille totale du brouillon", () => {
    const oversizedEntry = missionReportPayloadSchema.safeParse({
      ...EMPTY_REPORT_PAYLOAD,
      dossiers: [
        {
          profileId: ID,
          noNewInfo: false,
          entries: [{ fieldKey: "details", value: "x".repeat(20_001) }],
        },
      ],
    });
    expect(oversizedEntry.success).toBe(false);
    if (!oversizedEntry.success) {
      expect(oversizedEntry.error.issues.some((issue) => issue.message === "Valeur trop volumineuse.")).toBe(true);
    }

    const oversizedDraft = missionReportPayloadSchema.safeParse({
      ...EMPTY_REPORT_PAYLOAD,
      dossiers: Array.from({ length: 14 }, (_, index) => ({
        profileId: `c${index.toString(36).padStart(24, "0")}`,
        noNewInfo: false,
        entries: [{ fieldKey: "details", value: "x".repeat(19_000) }],
      })),
    });
    expect(oversizedDraft.success).toBe(false);
    if (!oversizedDraft.success) {
      expect(oversizedDraft.error.issues.some((issue) => issue.message === "Le brouillon est trop volumineux.")).toBe(true);
    }
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
