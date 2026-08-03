import { describe, expect, it } from "vitest";
import {
  canViewRealIdentity,
  formatRealName,
  normalizeDisplayName,
  serializeUserIdentity,
  isRealUserView,
  type IdentityViewer,
} from "./identity";
import { PERMISSIONS } from "./permissions";

const viewer = (overrides: Partial<IdentityViewer> = {}): IdentityViewer => ({
  userId: "viewer",
  permissions: new Set(),
  groupIds: new Set(),
  ...overrides,
});

const target = { id: "cible", groupIds: ["groupe-a"] };

describe("canViewRealIdentity — matrice de visibilité", () => {
  it("un utilisateur extérieur ne voit PAS l'identité réelle", () => {
    expect(canViewRealIdentity(viewer(), target)).toBe(false);
    expect(canViewRealIdentity(viewer({ groupIds: new Set(["groupe-b"]) }), target)).toBe(false);
  });

  it("un membre du même groupe voit l'identité réelle", () => {
    expect(canViewRealIdentity(viewer({ groupIds: new Set(["groupe-a"]) }), target)).toBe(true);
  });

  it("la modération (identity.view.real) voit l'identité réelle", () => {
    expect(
      canViewRealIdentity(viewer({ permissions: new Set([PERMISSIONS.IDENTITY_VIEW_REAL]) }), target),
    ).toBe(true);
  });

  it("chacun voit sa propre identité", () => {
    expect(canViewRealIdentity(viewer({ userId: "cible" }), target)).toBe(true);
  });

  it("une cible sans groupe n'est visible que de la modération et d'elle-même", () => {
    const isole = { id: "isole", groupIds: [] };
    expect(canViewRealIdentity(viewer({ groupIds: new Set(["groupe-a"]) }), isole)).toBe(false);
  });
});

describe("serializeUserIdentity — DTO à deux niveaux", () => {
  const record = {
    id: "cible",
    displayName: "Araignée Rouge",
    firstName: "Akira",
    lastName: null,
    groupIds: ["groupe-a"],
  };

  it("non autorisé : les clés firstName/lastName N'EXISTENT PAS", () => {
    const view = serializeUserIdentity(viewer(), record) as unknown as Record<string, unknown>;
    expect(view).toEqual({ id: "cible", displayName: "Araignée Rouge" });
    expect(view).not.toHaveProperty("firstName");
    expect(view).not.toHaveProperty("lastName");
    expect(JSON.stringify(view)).not.toContain("Akira");
  });

  it("autorisé : identité réelle formatée, jamais « undefined »", () => {
    const view = serializeUserIdentity(viewer({ groupIds: new Set(["groupe-a"]) }), record);
    expect(isRealUserView(view)).toBe(true);
    if (isRealUserView(view)) {
      expect(view.realName).toBe("Akira"); // sans nom de famille : prénom seul
      expect(view.realName).not.toContain("undefined");
      expect(view.realName).not.toContain("Inconnu");
    }
  });
});

describe("formatRealName", () => {
  it("prénom seul quand le nom est absent", () => {
    expect(formatRealName("Akira", null)).toBe("Akira");
    expect(formatRealName("Akira", "")).toBe("Akira");
    expect(formatRealName("Akira", "  ")).toBe("Akira");
  });
  it("prénom + nom quand les deux existent", () => {
    expect(formatRealName("Akira", "Uzumori")).toBe("Akira Uzumori");
  });
});

describe("normalizeDisplayName — unicité insensible à la casse", () => {
  it("minuscules + espaces normalisés", () => {
    expect(normalizeDisplayName("  Araignée   ROUGE ")).toBe("araignée rouge");
    expect(normalizeDisplayName("araignée rouge")).toBe(
      normalizeDisplayName("ARAIGNÉE  ROUGE"),
    );
  });
});
