import { prisma } from "@toile/database";
import type { Session, User } from "@toile/database";
import { generateShortId, generateToken, hashSessionToken } from "./crypto";

export const SESSION_COOKIE = "toile_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export interface SessionWithUser extends Session {
  user: User;
}

/** Crée une session en base et retourne le jeton clair (à placer en cookie HttpOnly). */
export async function createSession(
  userId: string,
  meta: { ipTrunc?: string | null; userAgent?: string | null },
): Promise<{ token: string; session: Session }> {
  const token = generateToken();
  const session = await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      shortId: generateShortId(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      ipTrunc: meta.ipTrunc ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return { token, session };
}

/**
 * Valide un jeton de session. Retourne null si la session est inconnue,
 * expirée, révoquée, ou si le compte n'est plus ACTIF.
 */
export async function validateSession(token: string | undefined): Promise<SessionWithUser | null> {
  if (!token || token.length < 20) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;

  // Horodatage de dernière activité (best-effort, pas à chaque requête)
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }
  return session;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(token) },
    data: { revokedAt: new Date() },
  });
}

/** Révocation immédiate de toutes les sessions d'un utilisateur. */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
