import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getApiUser: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getApiUser: mocks.getApiUser }));
vi.mock("@toile/database", () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}));

import { GET } from "./route";

const portraitRequest = (headers?: HeadersInit) =>
  new NextRequest("http://localhost/api/membres/member-1/portrait", { headers });
const context = { params: Promise.resolve({ id: "member-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ session: { userId: "viewer-1" } });
});

describe("GET /api/membres/[id]/portrait", () => {
  it("répond 404 sans membre authentifié, sans interroger la cible", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);

    const response = await GET(portraitRequest(), context);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("ne recherche que les comptes actifs dont l'onboarding est terminé", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);

    const response = await GET(portraitRequest(), context);

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "member-1", status: "ACTIVE", profileCompleted: true },
      select: { portraitData: true, portraitMime: true },
    });
  });

  it("sert les octets avec un cache privé court, un ETag et nosniff", async () => {
    const portrait = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.findFirst.mockResolvedValueOnce({
      portraitData: portrait,
      portraitMime: "image/png",
    });

    const response = await GET(portraitRequest(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60, must-revalidate");
    expect(response.headers.get("etag")).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(portrait);
  });

  it("répond 304 sans corps quand le portrait en cache est encore identique", async () => {
    const portrait = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mocks.findFirst.mockResolvedValue({
      portraitData: portrait,
      portraitMime: "image/png",
    });

    const first = await GET(portraitRequest(), context);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const response = await GET(portraitRequest({ "If-None-Match": `W/${etag}` }), context);

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("cache-control")).toBe("private, max-age=60, must-revalidate");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.text()).toBe("");
  });
});
