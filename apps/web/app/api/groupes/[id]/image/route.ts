import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { SESSION_COOKIE, validateSession } from "@toile/auth";

export const dynamic = "force-dynamic";

/** Sert l'image d'un groupe — membres authentifiés uniquement. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const group = await prisma.group.findUnique({
    where: { id },
    select: { imageData: true, imageMime: true },
  });
  if (!group?.imageData || !group.imageMime) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Buffer.from(group.imageData), {
    headers: {
      "Content-Type": group.imageMime,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
