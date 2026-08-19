import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { getApiUser } from "@/lib/session";
import { getProfileViewer, decideAccess, toAccessTarget, accessTargetSelect } from "@/server/profiles/access";

export const dynamic = "force-dynamic";

/**
 * Une image de la galerie d'un dossier.
 *
 * Même garantie que le portrait : la décision est prise par `decideAccess`,
 * jamais par la route. Un refus vaut 404 — qu'une image existe est déjà un
 * renseignement. L'identifiant de l'image est imprévisible (cuid), mais la
 * garde ne repose PAS dessus : elle repose sur l'accès au dossier.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const current = await getApiUser();
  if (!current) return new NextResponse(null, { status: 404 });

  const { id, imageId } = await params;
  const profile = await prisma.characterProfile.findUnique({
    where: { id },
    select: accessTargetSelect,
  });
  if (!profile || profile.archivedAt) return new NextResponse(null, { status: 404 });

  const viewer = await getProfileViewer(current);
  if (!decideAccess(viewer, toAccessTarget(profile)).canView) {
    return new NextResponse(null, { status: 404 });
  }

  // L'image doit appartenir à CE dossier : pas de traversée d'un dossier
  // autorisé vers l'image d'un autre.
  const image = await prisma.profileImage.findFirst({
    where: { id: imageId, profileId: id, deletedAt: null },
    select: { imageData: true, imageMime: true },
  });
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(image.imageData), {
    headers: {
      "Content-Type": image.imageMime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
