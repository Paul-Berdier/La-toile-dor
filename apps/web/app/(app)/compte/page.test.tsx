import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isStreamerMode: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/streamer", () => ({ isStreamerMode: mocks.isStreamerMode }));
vi.mock("@toile/database", () => ({
  prisma: { user: { findUniqueOrThrow: mocks.findUniqueOrThrow } },
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
    expect(html).toContain("Édition protégée");
    expect(html).toContain("ne sont pas chargés");
  });
});
