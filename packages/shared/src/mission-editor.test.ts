import { describe, expect, it } from "vitest";
import {
  checkMissionForPublication,
  missionBlockingErrors,
  missionDeadlineSchema,
  missionEditorSchema,
  missionTemplate,
  rankLooksLow,
  suggestMissionRank,
  type MissionEditorInput,
} from "./mission-editor";

const base: MissionEditorInput = missionEditorSchema.parse({
  category: "ELIMINATION",
  rank: "B",
  rewardRyoMin: 10_000,
  rewardRyoMax: 50_000,
  basePoints: 40,
});

describe("missionEditorSchema — ce qui est exigé, et ce qui ne l'est pas", () => {
  it("accepte une mission minimale : type, rang, récompense", () => {
    expect(base.links).toEqual([]);
    expect(base.deadline.mode).toBe("NONE");
    expect(base.visibility.showCategory).toBe(true);
  });

  it("refuse une récompense maximale inférieure à la minimale", () => {
    const result = missionEditorSchema.safeParse({ ...base, rewardRyoMin: 100, rewardRyoMax: 10 });
    expect(result.success).toBe(false);
  });

  it("refuse deux fois le même dossier dans le même rôle", () => {
    const result = missionEditorSchema.safeParse({
      ...base,
      links: [
        { profileId: "cknqk1k3z0000abcd1234efgh", role: "TARGET", isPrimary: true },
        { profileId: "cknqk1k3z0000abcd1234efgh", role: "TARGET", isPrimary: false },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("ACCEPTE le même dossier en cible ET en commanditaire (trahison RP)", () => {
    const result = missionEditorSchema.safeParse({
      ...base,
      links: [
        { profileId: "cknqk1k3z0000abcd1234efgh", role: "TARGET", isPrimary: true },
        { profileId: "cknqk1k3z0000abcd1234efgh", role: "CLIENT", isPrimary: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("refuse deux cibles principales", () => {
    const result = missionEditorSchema.safeParse({
      ...base,
      links: [
        { profileId: "cknqk1k3z0000abcd1234efgh", role: "TARGET", isPrimary: true },
        { profileId: "cknqk1k3z0000abcd1234efgi", role: "TARGET", isPrimary: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("exige une justification pour un titre imposé", () => {
    const result = missionEditorSchema.safeParse({ ...base, titleOverride: "Opération Serpent" });
    expect(result.success).toBe(false);
  });
});

describe("délai — une intention, une seule", () => {
  it("« aucun délai » n'exige rien", () => {
    expect(missionDeadlineSchema.safeParse({ mode: "NONE" }).success).toBe(true);
  });
  it("une durée réelle sans heures est refusée", () => {
    expect(missionDeadlineSchema.safeParse({ mode: "REAL" }).success).toBe(false);
  });
  it("une durée RP vide est refusée", () => {
    expect(
      missionDeadlineSchema.safeParse({ mode: "RP", rp: { years: 0, months: 0, weeks: 0 } }).success,
    ).toBe(false);
  });
  it("une date sans valeur est refusée", () => {
    expect(missionDeadlineSchema.safeParse({ mode: "DATE" }).success).toBe(false);
  });
});

describe("vérification avant publication — tout d'un coup", () => {
  it("seule une récompense nulle bloque", () => {
    const checks = checkMissionForPublication(
      { ...base, rewardRyoMin: 0, rewardRyoMax: 0 },
      { targetCount: 0, clientCount: 0 },
    );
    const blocking = missionBlockingErrors(checks);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.field).toBe("rewardRyoMin");
  });

  it("l'absence de cible, d'objectif et de délai avertit sans bloquer", () => {
    const checks = checkMissionForPublication(base, { targetCount: 0, clientCount: 0 });
    expect(missionBlockingErrors(checks)).toHaveLength(0);
    const warnings = checks.filter((c) => c.level === "warning").map((c) => c.field);
    expect(warnings).toContain("links");
    expect(warnings).toContain("primaryObjective");
    expect(warnings).toContain("deadline");
  });

  it("une mission complète ne signale rien", () => {
    const checks = checkMissionForPublication(
      { ...base, primaryObjective: "Éliminer la cible.", deadline: { mode: "REAL", realHours: 48 } },
      { targetCount: 2, clientCount: 1 },
    );
    expect(checks.every((c) => c.level === "ok")).toBe(true);
  });
});

describe("suggestion de rang — une aide, pas une règle", () => {
  it("aucune cible : aucune suggestion", () => {
    expect(suggestMissionRank([], "ELIMINATION")).toBeNull();
  });

  it("un Jonin visé par une élimination appelle un rang élevé", () => {
    const suggested = suggestMissionRank([{ gradeOrder: 7 }], "ELIMINATION");
    expect(suggested).toBe("S");
  });

  it("le même Jonin pour une escorte reste un cran plus bas", () => {
    expect(suggestMissionRank([{ gradeOrder: 7 }], "ESCORTE")).toBe("A");
  });

  it("le grade le plus élevé décide", () => {
    expect(suggestMissionRank([{ gradeOrder: 1 }, { gradeOrder: 7 }], "ESCORTE")).toBe("A");
  });

  it("un rang très inférieur à la suggestion est signalé", () => {
    expect(rankLooksLow("C", "S")).toBe(true);
    expect(rankLooksLow("A", "S")).toBe(false); // un cran d'écart : le RP décide
    expect(rankLooksLow("S", null)).toBe(false);
  });
});

describe("modèles par type — ils changent l'affichage, jamais les règles", () => {
  it("une prise d'information met le renseignement en avant", () => {
    const template = missionTemplate("COLLECTE_INFORMATIONS");
    expect(template.intelFocused).toBe(true);
    expect(template.emphasizeRoles).toContain("SUBJECT");
    expect(template.objectiveLabel).toBe("Ce qu'il faut apprendre");
  });

  it("un type inconnu retombe sur le modèle par défaut", () => {
    const template = missionTemplate("TYPE_INEXISTANT");
    expect(template.intelFocused).toBe(false);
    expect(template.emphasizeRoles).toEqual(["TARGET", "CLIENT"]);
  });
});
