import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { normalizeRefLabel } from "@toile/shared";
import { getApiUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Recherche de dossiers par nom ou code — pour repérer un doublon avant
 * d'ouvrir un dossier, ou lier une relation. Ouverte à tout membre connecté :
 * elle ne renvoie QUE ce qui est public pour tous (code, titre, prénom, nom).
 * Rien d'autre ne doit jamais sortir d'ici — pas de grade, pas de faction,
 * pas d'indicateur d'accès.
 */
export async function GET(req: NextRequest) {
  const current = await getApiUser();
  if (!current) return new NextResponse(null, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.slice(0, 80) ?? "";
  const exclude = req.nextUrl.searchParams.get("exclude") ?? undefined;
  if (q.trim().length < 2) return NextResponse.json([]);

  const norm = normalizeRefLabel(q);
  const results = await prisma.characterProfile.findMany({
    where: {
      archivedAt: null,
      mergedIntoId: null,
      ...(exclude ? { id: { not: exclude } } : {}),
      OR: [
        { firstNameNorm: { contains: norm } },
        { characterLastName: { contains: q.trim(), mode: "insensitive" } },
        { title: { contains: q.trim(), mode: "insensitive" } },
        { code: { contains: q.toUpperCase() } },
      ],
    },
    select: { id: true, code: true, title: true, characterFirstName: true, characterLastName: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return NextResponse.json(
    results.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      firstName: r.characterFirstName,
      lastName: r.characterLastName,
    })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
