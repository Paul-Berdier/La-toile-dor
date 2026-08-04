/**
 * Audit visuel des dossiers de renseignement : captures des vues clés
 * (modérateur, groupe acheteur, groupe sans accès) aux résolutions cibles.
 * Usage : node e2e/capture-profils.mjs <dossier-de-sortie>
 * Prérequis : serveur de production sur :3100 (npx next start -p 3100).
 */
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

const OUT = process.argv[2] ?? "audit-profils";
mkdirSync(OUT, { recursive: true });
const prisma = new PrismaClient();
const BASE = "http://localhost:3100";

const VIEWPORTS = [
  ["desktop-1440", 1440, 900],
  ["laptop-1280", 1280, 800],
  ["tablet-1024", 1024, 768],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
  ["mobile-360", 360, 800],
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

const akira = await prisma.characterProfile.findFirstOrThrow({
  where: { characterFirstName: "Akira" },
  include: { accessGrants: { where: { revokedAt: null } } },
});
const buyer = await prisma.groupMember.findFirstOrThrow({
  where: { groupId: akira.accessGrants[0].groupId, user: { profileCompleted: true } },
});

const PAGES = [
  { name: "liste-mod", path: "/profils", as: "demo-mod" },
  { name: "dossier-mod", path: `/profils/${akira.id}`, as: "demo-mod" },
  { name: "dossier-acheteur", path: `/profils/${akira.id}`, as: buyer.userId },
  { name: "dossier-sans-acces", path: `/profils/${akira.id}`, as: "demo-member-2-0-0" },
  { name: "liste-agent", path: "/profils", as: "demo-member-2-0-0" },
  { name: "edition", path: `/profils/${akira.id}/modifier`, as: "demo-mod" },
  { name: "demandes", path: "/profils/demandes", as: "demo-mod" },
  { name: "referentiels", path: "/admin/referentiels", as: "demo-admin" },
];

const browser = await chromium.launch();
for (const [vpName, width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const tokens = new Map();
  for (const def of PAGES) {
    // Mobile/tablette portrait : limiter aux écrans structurants
    if (
      (vpName.startsWith("mobile") || vpName === "tablet-768") &&
      !["liste-mod", "dossier-mod", "dossier-sans-acces", "edition"].includes(def.name)
    ) {
      continue;
    }
    if (!tokens.has(def.as)) tokens.set(def.as, await makeSession(def.as));
    const page = await context.newPage();
    await context.addCookies([
      { name: "toile_session", value: tokens.get(def.as), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    await page.goto(`${BASE}${def.path}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, `${def.name}--${vpName}.png`), fullPage: false });
    await page.close();
  }
  await context.close();
  console.log(`✓ ${vpName}`);
}
await browser.close();
await prisma.$disconnect();
console.log(`Captures dans ${OUT}`);
