import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  validateSession,
  getUserPermissions,
  truncateIp,
  reduceUserAgent,
  type SessionWithUser,
} from "@toile/auth";

export interface CurrentUser {
  session: SessionWithUser;
  permissions: Set<string>;
}

/** Session courante (mise en cache par requête). null si non authentifié. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = await validateSession(token);
  if (!session) return null;
  const permissions = await getUserPermissions(session.userId);
  return { session, permissions };
});

/**
 * Garde de page : redirige vers la connexion si non authentifié, et vers
 * l'onboarding tant que le profil (identité + confidentialité) n'est pas
 * complété — aucune page sensible n'est accessible avant.
 */
export async function requireUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) redirect("/connexion");
  if (!current.session.user.profileCompleted) redirect("/bienvenue");
  return current;
}

/**
 * Garde de ROUTE API : même règle que `requireUser` (session valide ET
 * onboarding terminé), mais sans redirection — une route renvoie un statut.
 * Les routes qui validaient seulement la session laissaient passer un compte
 * encore en « bienvenue » ; la règle doit être la même des deux côtés.
 */
export async function getApiUser(): Promise<CurrentUser | null> {
  const current = await getCurrentUser();
  if (!current || !current.session.user.profileCompleted) return null;
  return current;
}

/** Garde de page avec permission obligatoire. */
export async function requireUserWith(permission: string): Promise<CurrentUser> {
  const current = await requireUser();
  if (!current.permissions.has(permission)) redirect("/missions");
  return current;
}

/** Métadonnées de requête pour l'audit (IP tronquée, UA réduit). */
export async function requestMeta(): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipHash: truncateIp(forwarded),
    userAgent: reduceUserAgent(h.get("user-agent")),
  };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
