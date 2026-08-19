import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { getApiUser } from "@/lib/session";
import { getProfileViewer, decideAccess, toAccessTarget, accessTargetSelect } from "@/server/profiles/access";

export const dynamic = "force-dynamic";

/**
 * Portrait principal d'un dossier de renseignement.
 *
 * GARANTIE ANTI-FUITE : un portrait CONNU mais non acquis n'est JAMAIS servi.
 * La route ne réimplémente PAS la règle d'accès — elle passe par la même
 * `decideAccess` que la page, sans quoi les deux finiraient par diverger et
 * l'image fuirait là où le texte est masqué. Un refus vaut 404, pas 403 :
 * l'existence même du portrait est une information.
 *
 * Source : le portrait principal de la galerie (ProfileImage), et à défaut
 * l'ancienne colonne `imageData` — les dossiers d'avant la galerie restent
 * servis sans rupture.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const current = await getApiUser();
  if (!current) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const profile = await prisma.characterProfile.findUnique({
    where: { id },
    select: {
      ...accessTargetSelect,
      imageData: true,
      imageMime: true,
      images: {
        where: { isPrimary: true, deletedAt: null },
        select: { imageData: true, imageMime: true },
        take: 1,
      },
    },
  });
  if (!profile || profile.archivedAt) return new NextResponse(null, { status: 404 });

  const viewer = await getProfileViewer(current);
  if (!decideAccess(viewer, toAccessTarget(profile)).canView) {
    return new NextResponse(null, { status: 404 });
  }

  const primary = profile.images[0];
  const data = primary?.imageData ?? profile.imageData;
  const mime = primary?.imageMime ?? profile.imageMime;
  if (!data || !mime) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(data), {
    headers: {
      "Content-Type": mime,
      // Cache strictement privé : jamais partagé entre utilisateurs
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
