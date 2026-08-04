import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { SESSION_COOKIE, validateSession, getUserPermissions } from "@toile/auth";
import { PERMISSIONS, normalizeRefLabel } from "@toile/shared";

export const dynamic = "force-dynamic";

/** Recherche de profils pour lier des relations — modération uniquement. */
export async function GET(req: NextRequest) {
  const session = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return new NextResponse(null, { status: 401 });
  const permissions = await getUserPermissions(session.userId);
  if (!permissions.has(PERMISSIONS.PROFILE_MANAGE)) {
    return new NextResponse(null, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.slice(0, 80) ?? "";
  const exclude = req.nextUrl.searchParams.get("exclude") ?? undefined;
  if (q.trim().length < 2) return NextResponse.json([]);

  const results = await prisma.characterProfile.findMany({
    where: {
      archivedAt: null,
      mergedIntoId: null,
      ...(exclude ? { id: { not: exclude } } : {}),
      OR: [
        { firstNameNorm: { contains: normalizeRefLabel(q) } },
        { code: { contains: q.toUpperCase() } },
      ],
    },
    select: { id: true, code: true, characterFirstName: true },
    take: 8,
  });
  return NextResponse.json(
    results.map((r) => ({ id: r.id, code: r.code, firstName: r.characterFirstName })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
