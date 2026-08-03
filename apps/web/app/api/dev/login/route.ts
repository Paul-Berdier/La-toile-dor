import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import { createSession, SESSION_COOKIE } from "@toile/auth";

export const dynamic = "force-dynamic";

/**
 * Connexion de DÉVELOPPEMENT uniquement : permet d'incarner un utilisateur du
 * seed sans OAuth Discord. Triple verrou : NODE_ENV, drapeau explicite, 404 sinon.
 * Ne JAMAIS activer DEV_LOGIN en production.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN !== "1") {
    return new NextResponse(null, { status: 404 });
  }

  const as = req.nextUrl.searchParams.get("as") ?? "demo-mod";
  const user = await prisma.user.findUnique({ where: { id: as } });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "utilisateur de seed inconnu" }, { status: 400 });
  }

  const { token, session } = await createSession(user.id, {
    ipTrunc: null,
    userAgent: "dev-login",
  });
  const res = NextResponse.redirect(new URL("/missions", req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
