import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { SESSION_COOKIE, validateSession, getUserPermissions } from "@toile/auth";
import { canViewCharacterProfile } from "@toile/shared";

export const dynamic = "force-dynamic";

/**
 * Portrait d'un dossier de renseignement.
 *
 * GARANTIE ANTI-FUITE : un portrait CONNU mais non acquis n'est JAMAIS servi.
 * La route ne réimplémente PAS la règle d'accès — elle appelle la même
 * `canViewCharacterProfile` que la page, sans quoi les deux finiraient par
 * diverger et l'image fuirait là où le texte est masqué. Un refus vaut 404,
 * pas 403 : l'existence même du portrait est une information.
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
    select: {
      id: true,
      imageData: true,
      imageMime: true,
      archivedAt: true,
      createdByGroupId: true,
      accessGrants: { select: { groupId: true, sourceType: true, revokedAt: true } },
    },
  });
  if (!profile?.imageData || !profile.imageMime || profile.archivedAt) {
    return new NextResponse(null, { status: 404 });
  }

  const [permissions, memberships] = await Promise.all([
    getUserPermissions(session.userId),
    prisma.groupMember.findMany({
      where: { userId: session.userId, group: { isActive: true } },
      select: { groupId: true },
    }),
  ]);
  const authorized = canViewCharacterProfile(
    { userId: session.userId, permissions, groupIds: new Set(memberships.map((m) => m.groupId)) },
    {
      id: profile.id,
      createdByGroupId: profile.createdByGroupId,
      archivedAt: profile.archivedAt,
      grants: profile.accessGrants,
    },
  );
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
