import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { getApiUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const PORTRAIT_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PORTRAIT_CACHE_CONTROL = "private, max-age=60, must-revalidate";

function privateNotFound() {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}

function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  return Boolean(
    ifNoneMatch
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`),
  );
}

/**
 * Portrait public au sens de la Toile : visible par tout membre authentifié,
 * jamais par Internet sans session. Un compte absent ou inactif et un portrait
 * absent produisent le même 404 afin de ne pas fournir d'oracle d'existence.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const current = await getApiUser();
  if (!current) return privateNotFound();

  const { id } = await params;
  if (!id || id.length > 64) return privateNotFound();

  const member = await prisma.user.findFirst({
    where: { id, status: "ACTIVE", profileCompleted: true },
    select: { portraitData: true, portraitMime: true },
  });
  if (
    !member?.portraitData ||
    !member.portraitMime ||
    !PORTRAIT_MIMES.has(member.portraitMime)
  ) {
    return privateNotFound();
  }

  const portrait = Buffer.from(member.portraitData);
  const etag = `"sha256-${createHash("sha256")
    .update(member.portraitMime)
    .update("\0")
    .update(portrait)
    .digest("base64url")}"`;
  const headers = {
    "Cache-Control": PORTRAIT_CACHE_CONTROL,
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };

  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(portrait, {
    headers: {
      ...headers,
      "Content-Type": member.portraitMime,
    },
  });
}
