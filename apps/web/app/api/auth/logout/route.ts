import { NextRequest, NextResponse } from "next/server";
import { audit, revokeSession, SESSION_COOKIE } from "@toile/auth";

export const dynamic = "force-dynamic";

// POST uniquement : la déconnexion modifie l'état (protection CSRF via SameSite=Lax)
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token);
    await audit({ action: "auth.logout" });
  }
  const res = NextResponse.redirect(new URL("/connexion", process.env.APP_URL ?? req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
