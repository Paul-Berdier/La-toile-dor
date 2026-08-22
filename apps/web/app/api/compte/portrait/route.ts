import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { getApiUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const PORTRAIT_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CACHE_CONTROL = "private, max-age=60, must-revalidate";

function privateNotFound() {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}

/**
 * Portrait du seul compte connecté. Aucun identifiant de cible n'est accepté :
 * `/compte` reste une fiche personnelle et cette route ne crée pas d'annuaire
 * indirect d'images.
 */
export async function GET(request: NextRequest) {
  const current = await getApiUser();
  if (!current) return privateNotFound();

  const user = await prisma.user.findFirst({
    where: {
      id: current.session.userId,
      status: "ACTIVE",
      profileCompleted: true,
    },
    select: { portraitData: true, portraitMime: true },
  });
  if (!user?.portraitData || !user.portraitMime || !PORTRAIT_MIMES.has(user.portraitMime)) {
    return privateNotFound();
  }

  const portrait = Buffer.from(user.portraitData);
  const etag = `"sha256-${createHash("sha256").update(portrait).digest("base64url")}"`;
  const headers = {
    "Cache-Control": CACHE_CONTROL,
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  const matches = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag || candidate === `W/${etag}`);
  if (matches) return new NextResponse(null, { status: 304, headers });

  return new NextResponse(portrait, {
    headers: { ...headers, "Content-Type": user.portraitMime },
  });
}
