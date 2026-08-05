/**
 * Audit visuel du classement (part personnelle, podium, trois échelles) et de
 * la pagination des dossiers.
 *
 * Usage : node e2e/capture-classement.mjs <dossier-de-sortie>
 * Prérequis : serveur de production sur :3100 (npx next start -p 3100).
 */
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

const OUT = process.argv[2] ?? "audit-classement";
mkdirSync(OUT, { recursive: true });
const prisma = new PrismaClient();
const BASE = "http://localhost:3100";

const VIEWPORTS = [
  ["desktop-1440", 1440, 900],
  ["mobile-390", 390, 844],
];

async function makeSession(userId) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      shortId: randomBytes(4).toString("hex").toUpperCase(),
      userId,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      userAgent: "audit",
    },
  });
  return token;
}

const browser = await chromium.launch();

async function shot(userId, url, name, width, height, prepare) {
  const token = await makeSession(userId);
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    { name: "toile_session", value: token, domain: "localhost", path: "/", sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await context.close();
}

for (const [label, width, height] of VIEWPORTS) {
  // Un agent : sa part, celle de son groupe et de sa faction
  // demo-member-0-0-0 appartient aux Lances de Foudre, qui ont touché des parts
  await shot("demo-member-0-0-0", "/classement?saison=toutes", `classement-agent-${label}`, width, height);
  // Onglet Factions
  await shot(
    "demo-admin",
    "/classement?saison=toutes",
    `classement-factions-${label}`,
    width,
    height,
    async (page) => {
      await page.getByRole("button", { name: /Factions/ }).click();
      await page.waitForTimeout(200);
    },
  );
  // Onglet Agents, classé par ryōs
  await shot(
    "demo-admin",
    "/classement?saison=toutes",
    `classement-agents-ryos-${label}`,
    width,
    height,
    async (page) => {
      await page.getByRole("button", { name: /Agents/ }).click();
      await page.getByRole("button", { name: "Ryōs" }).click();
      await page.waitForTimeout(200);
    },
  );
  // Pagination des dossiers
  await shot("demo-admin", "/profils", `profils-pagination-${label}`, width, height);
}

await browser.close();
await prisma.$disconnect();
console.log(`Captures écrites dans ${OUT}`);
