import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isStreamerMode: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findLevels: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/streamer", () => ({ isStreamerMode: mocks.isStreamerMode }));
vi.mock("@toile/database", () => ({
  prisma: {
    user: { findUniqueOrThrow: mocks.findUniqueOrThrow },
    playerLevel: { findMany: mocks.findLevels },
  },
}));
vi.mock("@/components/compte/identity-edit-form", () => ({
  IdentityEditForm: () => null,
}));

import ComptePage from "./page";

describe("ComptePage en mode Streamer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.requireUser.mockResolvedValue({ session: { userId: "member-1" } });
    mocks.isStreamerMode.mockResolvedValue(true);
  });

  it("s'arrête avant toute lecture de la fiche privée", async () => {
    const view = await ComptePage();
    const html = renderToStaticMarkup(view);

    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.findLevels).not.toHaveBeenCalled();
    expect(html).toContain("Édition protégée");
    expect(html).toContain("ne sont pas chargés");
  });
});

describe("ComptePage pour un chef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    mocks.requireUser.mockResolvedValue({ session: { userId: "leader-1" } });
    mocks.isStreamerMode.mockResolvedValue(false);
    mocks.findLevels.mockResolvedValue([
      { id: "cm12345678901234567890123", label: "Jōnin" },
    ]);
    mocks.findUniqueOrThrow.mockResolvedValue({
      id: "leader-1",
      firstName: "Akira",
      lastName: "",
      displayName: "Le Tisseur",
      publicBio: null,
      specialties: [],
      portraitMime: null,
      playerLevelId: "cm12345678901234567890123",
      identityVisibility: "MY_GROUPS",
      playerLevel: { label: "Jōnin" },
      roles: [{ role: { name: "Chef de groupe" } }],
      groupMemberships: [
        {
          isLeader: true,
          group: { id: "group-gold", name: "Les Tisseurs d'Or" },
        },
      ],
    });
  });

  it("donne accès à la fiche où le chef peut renommer son groupe", async () => {
    const view = await ComptePage();
    const html = renderToStaticMarkup(view);

    expect(html).toContain('href="/groupes/group-gold"');
    expect(html).toContain("Les Tisseurs d&#x27;Or — gérer le groupe");
    expect(html).toContain("ouvrez votre groupe ci-dessus pour modifier son nom");
  });
});
