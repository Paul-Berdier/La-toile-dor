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

const request = (headers?: HeadersInit) =>
  new NextRequest("http://localhost/api/compte/portrait", { headers });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ session: { userId: "member-1" } });
});

describe("GET /api/compte/portrait", () => {
  it("ne lit aucun portrait sans session", async () => {
    mocks.getApiUser.mockResolvedValueOnce(null);
    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("ne charge que le portrait du compte connecté", async () => {
    const portrait = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    mocks.findFirst.mockResolvedValue({ portraitData: portrait, portraitMime: "image/webp" });

    const response = await GET(request());

    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "member-1", status: "ACTIVE", profileCompleted: true },
      select: { portraitData: true, portraitMime: true },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60, must-revalidate");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(portrait);
  });

  it("répond 304 avec un ETag identique", async () => {
    const portrait = Buffer.from([1, 2, 3, 4]);
    mocks.findFirst.mockResolvedValue({ portraitData: portrait, portraitMime: "image/webp" });
    const first = await GET(request());
    const etag = first.headers.get("etag");

    const response = await GET(request({ "If-None-Match": String(etag) }));

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(etag);
  });
});
