import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, generateToken, rateLimit } from "@toile/auth";

export const dynamic = "force-dynamic";

/**
 * Démarre le parcours OAuth2 Discord.
 * `?invite=<jeton>` transporte un jeton d'invitation à consommer au retour.
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limit = rateLimit(`login:${ip}`, 10, 60);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL("/connexion?erreur=limite", req.url));
  }

  const state = generateToken();
  const invite = req.nextUrl.searchParams.get("invite");
  // Fiche RP saisie sur la page d'invitation (titre + village/pays)
  const rpTitle = req.nextUrl.searchParams.get("titre")?.slice(0, 60).trim();
  const village = req.nextUrl.searchParams.get("village")?.slice(0, 60).trim();

  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  // Protection CSRF du flux OAuth : le state doit revenir identique
  res.cookies.set("toile_oauth_state", state, cookieOpts);
  if (invite) {
    res.cookies.set("toile_invite", invite, cookieOpts);
    if (rpTitle) res.cookies.set("toile_rp_title", rpTitle, cookieOpts);
    if (village) res.cookies.set("toile_village", village, cookieOpts);
  } else {
    res.cookies.delete("toile_invite");
    res.cookies.delete("toile_rp_title");
    res.cookies.delete("toile_village");
  }
  return res;
}
