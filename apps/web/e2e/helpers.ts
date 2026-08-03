/**
 * Utilitaires e2e : création de sessions directement en base pour incarner
 * les utilisateurs du seed (le flux OAuth Discord réel ne peut pas être joué
 * en CI). Le client Prisma généré (JS) est importé directement.
 */
import { createHash, randomBytes } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — client généré
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

export const prisma = new PrismaClient();

/** Crée une session valide pour un utilisateur du seed et pose le cookie. */
export async function loginAs(context: BrowserContext, userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      shortId: randomBytes(4).toString("hex").toUpperCase(),
      userId,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      userAgent: "e2e",
    },
  });
  await context.addCookies([
    {
      name: "toile_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function setStreamerCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    { name: "toile_streamer", value: "1", domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
}

/** Identifiant de la mission SS du seed (dossier confidentiel de référence). */
export async function ssMissionId(): Promise<string> {
  const mission = await prisma.mission.findUniqueOrThrow({ where: { code: "TO-SS-0011" } });
  return mission.id;
}
