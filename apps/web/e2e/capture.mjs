/**
 * Capture d'audit visuel : pages clés × résolutions cibles → PNG.
 * Usage : node e2e/capture.mjs <dossier-de-sortie>
 * Prérequis : serveur de production sur :3100, base seedée.
 */
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

const OUT = process.argv[2] ?? "audit-screens";
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

const ss = await prisma.mission.findUniqueOrThrow({ where: { code: "TO-SS-0011" } });

const PAGES = [
  { name: "connexion", path: "/connexion", as: null },
  { name: "missions-mod", path: "/missions", as: "demo-mod" },
  { name: "mission-ss-mod", path: `/missions/${ss.id}`, as: "demo-mod" },
  { name: "mission-ss-chef", path: `/missions/${ss.id}`, as: "demo-chief-1" },
  { name: "classement", path: "/classement", as: "demo-mod" },
  { name: "revendications", path: "/revendications", as: "demo-mod" },
  { name: "creation", path: "/missions/nouvelle", as: "demo-mod" },
  { name: "admin-config", path: "/admin/configuration", as: "demo-admin" },
  { name: "admin-invitations", path: "/admin/invitations", as: "demo-admin" },
];

const browser = await chromium.launch();
for (const [vpName, width, height] of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width, height } });
  const tokens = new Map();
  for (const pageDef of PAGES) {
    // Mobile : ne capturer que les pages principales pour limiter le volume
    if ((vpName.startsWith("mobile") || vpName === "tablet-768") &&
        !["connexion", "missions-mod", "mission-ss-mod", "classement", "creation"].includes(pageDef.name)) {
      continue;
    }
    if (pageDef.as && !tokens.has(pageDef.as)) tokens.set(pageDef.as, await makeSession(pageDef.as));
    const page = await context.newPage();
    if (pageDef.as) {
      await context.addCookies([
        { name: "toile_session", value: tokens.get(pageDef.as), domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);
    }
    await page.goto(`${BASE}${pageDef.path}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, `${pageDef.name}--${vpName}.png`), fullPage: false });
    await page.close();
  }
  await context.close();
  console.log(`✓ ${vpName}`);
}
await browser.close();
await prisma.$disconnect();
console.log(`Captures dans ${OUT}`);
