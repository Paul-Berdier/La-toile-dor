import { describe, expect, it } from "vitest";
import {
  serializeMission,
  toPublicView,
  toAssignedView,
  toModeratorView,
  type MissionRecord,
} from "./mission-views";
import { computeTimeRemaining } from "./rp-time";

const CONFIDENTIAL_KEYS = [
  "confidentialDescription",
  "primaryObjective",
  "targetIdentity",
  "location",
  "clientName",
  "constraints",
  "prohibitions",
  "evidence",
] as const;

const MODERATOR_KEYS = ["internalTitle", "moderatorNotes"] as const;

function mission(overrides: Partial<MissionRecord> = {}): MissionRecord {
  return {
    id: "m1",
    code: "TO-S-0001",
    status: "AVAILABLE",
    rank: "S",
    category: "ELIMINATION",
    publicTitle: "Titre public",
    publicSummary: "Résumé public",
    rewardRyoMin: 1000,
    rewardRyoMax: 2000,
    basePoints: 300,
    targetLevelId: "lvl-kage",
    minRecommendedLevelId: "lvl-jonin",
    groupSizeMin: 2,
    groupSizeMax: 4,
    confidentialDescription: "SECRET briefing",
    primaryObjective: "SECRET objectif",
    secondaryObjectives: [
      { label: "objectif visible", points: 10 },
      { label: "objectif SECRET", secret: true, points: 25 },
    ],
    targetIdentity: "SECRET cible",
    location: "SECRET lieu",
    clientName: "SECRET commanditaire",
    constraints: "SECRET contraintes",
    prohibitions: "SECRET interdits",
    evidence: "SECRET preuves",
    internalTitle: "SECRET interne",
    moderatorNotes: "SECRET notes",
    eligibilityMode: "WARNING",
    createdAt: new Date("2026-01-01"),
    publishedAt: new Date("2026-01-02"),
    expiresAt: null,
    assignedFactionId: null,
    assignedGroupId: null,
    assignedAt: null,
    resolvedAt: null,
    failureReason: null,
    cancellationReason: null,
    visibility: { showCategory: true, showTargetLevel: true, showSummary: true },
    ...overrides,
  };
}

const ctx = {
  timeRemaining: computeTimeRemaining({ expiresAt: null }, new Date()),
  claimCount: 2,
};

describe("vue publique (chef avant attribution)", () => {
  it("n'expose AUCUNE clé confidentielle, même vide", () => {
    const view = toPublicView(mission(), ctx) as unknown as Record<string, unknown>;
    for (const key of [...CONFIDENTIAL_KEYS, ...MODERATOR_KEYS, "secondaryObjectives"]) {
      expect(view, `la clé ${key} ne doit pas exister`).not.toHaveProperty(key);
    }
    expect(JSON.stringify(view)).not.toContain("SECRET");
  });

  it("respecte les drapeaux de visibilité", () => {
    const hidden = toPublicView(
      mission({ visibility: { showCategory: false, showTargetLevel: false, showSummary: false } }),
      ctx,
    );
    expect(hidden.category).toBeNull();
    expect(hidden.targetLevelId).toBeNull();
    expect(hidden.publicSummary).toBeNull();
  });

  it("signale l'existence d'un volet confidentiel sans le contenu", () => {
    expect(toPublicView(mission(), ctx).hasConfidential).toBe(true);
    expect(
      toPublicView(
        mission({
          confidentialDescription: null,
          targetIdentity: null,
          location: null,
          clientName: null,
        }),
        ctx,
      ).hasConfidential,
    ).toBe(false);
  });
});

describe("vue attribuée (groupe en mission)", () => {
  it("révèle le dossier mais JAMAIS les notes de modération", () => {
    const view = toAssignedView(mission(), ctx) as unknown as Record<string, unknown>;
    expect(view.targetIdentity).toBe("SECRET cible");
    expect(view.location).toBe("SECRET lieu");
    for (const key of MODERATOR_KEYS) {
      expect(view, `la clé ${key} ne doit pas exister`).not.toHaveProperty(key);
    }
  });

  it("exclut les objectifs secondaires marqués secrets", () => {
    const view = toAssignedView(mission(), ctx);
    expect(view.secondaryObjectives).toHaveLength(1);
    expect(JSON.stringify(view.secondaryObjectives)).not.toContain("SECRET");
    expect(JSON.stringify(view.secondaryObjectives)).not.toContain("secret");
  });
});

describe("vue modérateur", () => {
  it("contient tout, y compris les objectifs secrets et les notes", () => {
    const view = toModeratorView(mission(), ctx);
    expect(view.internalTitle).toBe("SECRET interne");
    expect(view.moderatorNotes).toBe("SECRET notes");
    expect(view.secondaryObjectives).toHaveLength(2);
  });
});

describe("serializeMission", () => {
  it("route vers le bon niveau", () => {
    expect(serializeMission(mission(), "public", ctx).level).toBe("public");
    expect(serializeMission(mission(), "assigned", ctx).level).toBe("assigned");
    expect(serializeMission(mission(), "moderator", ctx).level).toBe("moderator");
  });
});
