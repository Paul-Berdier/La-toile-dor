import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { SESSION_COOKIE, validateSession, getUserPermissions } from "@toile/auth";
import { PERMISSIONS } from "@toile/shared";

export const dynamic = "force-dynamic";

/**
 * Portrait d'un dossier de renseignement.
 * GARANTIE ANTI-FUITE : un portrait CONNU mais non acheté n'est JAMAIS servi —
 * la route revérifie les droits (modération OU groupe détenteur d'un accès
 * actif), indépendamment de ce que la page affiche.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const profile = await prisma.characterProfile.findUnique({
    where: { id },
    select: { id: true, imageData: true, imageMime: true, archivedAt: true },
  });
  if (!profile?.imageData || !profile.imageMime || profile.archivedAt) {
    return new NextResponse(null, { status: 404 });
  }

  const permissions = await getUserPermissions(session.userId);
  let authorized = permissions.has(PERMISSIONS.PROFILE_INTEL_VIEW);
  if (!authorized) {
    const grant = await prisma.profileAccessGrant.findFirst({
      where: {
        profileId: profile.id,
        revokedAt: null,
        group: { members: { some: { userId: session.userId } } },
      },
      select: { id: true },
    });
    authorized = grant != null;
  }
  if (!authorized) return new NextResponse(null, { status: 404 });

  return new NextResponse(Buffer.from(profile.imageData), {
    headers: {
      "Content-Type": profile.imageMime,
      // Cache strictement privé : jamais partagé entre utilisateurs
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
