import { describe, expect, it } from "vitest";
import {
  formatMissionRank,
  generateMissionPublicTitle,
  type TitleTargetInput,
} from "./mission-title";

const target = (
  gradeLabel: string | null,
  gradeOrder: number | null,
  originLabel: string | null,
): TitleTargetInput => ({ gradeLabel, gradeOrder, originLabel });

describe("formatMissionRank — la nuance est un suffixe", () => {
  it("rend B, B+ et B-", () => {
    expect(formatMissionRank("B")).toBe("B");
    expect(formatMissionRank("B", "PLUS")).toBe("B+");
    expect(formatMissionRank("B", "MINUS")).toBe("B-");
  });
});

describe("generateMissionPublicTitle — une cible", () => {
  it("compose « Assassinat · B+ · Konin · Konoha »", () => {
    const { title, segments } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "B",
      rankModifier: "PLUS",
      targets: [target("Konin", 6, "Konoha")],
    });
    expect(title).toBe("Élimination de cible · B+ · Konin · Konoha");
    expect(segments).toEqual({
      type: "Élimination de cible",
      rank: "B+",
      targetLevel: "Konin",
      origin: "Konoha",
    });
  });

  it("« Collecte d'informations · C · Genin confirmé · Suna »", () => {
    const { title } = generateMissionPublicTitle({
      category: "COLLECTE_INFORMATIONS",
      rank: "C",
      targets: [target("Genin confirmé", 2, "Suna")],
    });
    expect(title).toBe("Collecte d'informations · C · Genin confirmé · Suna");
  });

  it("grade inconnu quand le dossier ne le dit pas", () => {
    const { title } = generateMissionPublicTitle({
      category: "ENLEVEMENT",
      rank: "A",
      targets: [target(null, null, "Kiri")],
    });
    expect(title).toBe("Enlèvement · A · grade inconnu · Kiri");
  });

  it("origine inconnue quand le dossier n'a pas de faction", () => {
    const { title } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "B",
      targets: [target("Chunin", 4, null)],
    });
    expect(title).toBe("Élimination de cible · B · Chunin · origine inconnue");
  });
});

describe("generateMissionPublicTitle — plusieurs cibles", () => {
  it("même grade : « 3 cibles · Chunin »", () => {
    const { title } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "A",
      targets: [
        target("Chunin", 4, "Konoha"),
        target("Chunin", 4, "Konoha"),
        target("Chunin", 4, "Konoha"),
      ],
    });
    expect(title).toBe("Élimination de cible · A · 3 cibles · Chunin · Konoha");
  });

  it("grades différents : le plus élevé, annoncé « max »", () => {
    const { title } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "A",
      targets: [
        target("Genin confirmé", 2, "Konoha"),
        target("Chunin", 4, "Konoha"),
        target("Jonin", 7, "Konoha"),
      ],
    });
    expect(title).toBe("Élimination de cible · A · 3 cibles · max Jonin · Konoha");
  });

  it("villages différents : multi-origine", () => {
    const { title } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "A",
      targets: [target("Chunin", 4, "Konoha"), target("Jonin", 7, "Kiri")],
    });
    expect(title).toBe("Élimination de cible · A · 2 cibles · max Jonin · multi-origine");
  });

  it("un grade manquant parmi d'autres : on annonce quand même le max", () => {
    const { title } = generateMissionPublicTitle({
      category: "TRAQUE",
      rank: "B",
      targets: [target("Chunin", 4, "Kiri"), target(null, null, "Kiri")],
    });
    expect(title).toBe("Traque · B · 2 cibles · max Chunin · Kiri");
  });
});

describe("generateMissionPublicTitle — confidentialité et brouillons", () => {
  it("origine masquée : le segment disparaît entièrement", () => {
    const { title, segments } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "B",
      rankModifier: "PLUS",
      targets: [target("Konin", 6, "Konoha")],
      originVisibility: "HIDE",
    });
    expect(title).toBe("Élimination de cible · B+ · Konin");
    expect(segments.origin).toBeNull();
  });

  it("aucune cible (brouillon) : type et rang suffisent", () => {
    const { title, segments } = generateMissionPublicTitle({
      category: "PROTECTION",
      rank: "D",
      targets: [],
    });
    expect(title).toBe("Protection · D");
    expect(segments.targetLevel).toBeNull();
    expect(segments.origin).toBeNull();
  });

  it("aucun grade connu sur plusieurs cibles", () => {
    const { title } = generateMissionPublicTitle({
      category: "ELIMINATION",
      rank: "S",
      targets: [target(null, null, null), target(null, null, null)],
    });
    expect(title).toBe("Élimination de cible · S · 2 cibles · grade inconnu · origine inconnue");
  });
});
