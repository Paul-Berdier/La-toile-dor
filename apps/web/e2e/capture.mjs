/**
 * Capture d'audit visuel : pages clés × résolutions cibles → PNG.
 * Usage : node e2e/capture.mjs <dossier-de-sortie>
 * Prérequis : serveur de production sur :3100, base seedée.
 */
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

const OUT = process.argv[2] ?? "audit-screens";
mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient();
const BASE = "http://localhost:3100";
let server = null;

if (process.env.AUDIT_START_SERVER === "1") {
  server = spawn(process.execPath, ["e2e/start-production.mjs"], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: { ...process.env, PORT: "3100", HOSTNAME: "127.0.0.1" },
    stdio: "ignore",
    windowsHide: true,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE}/connexion`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // Le serveur est encore en cours de démarrage.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Le serveur d'audit n'a pas démarré sur le port 3100.");
  process.once("exit", () => server?.kill("SIGTERM"));
}

const VIEWPORTS = [
  ["desktop-1440", 1440, 900],
  ["laptop-1280", 1280, 800],
  ["tablet-1024", 1024, 768],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
  ["mobile-360", 360, 800],
];
const NEW_SCREEN_NAMES = new Set(["onboarding", "groupe-chef", "assignment-modal"]);
const newScreensOnly = process.env.AUDIT_NEW_ONLY === "1";

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
const assignmentMission = await prisma.mission.findUniqueOrThrow({ where: { code: "TO-D-0001" } });
const auditMembership = await prisma.groupMember.findFirstOrThrow({
  where: { userId: "demo-member-3-0-0" },
});

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
  { name: "onboarding", path: "/bienvenue", as: "demo-incomplete" },
  { name: "groupe-chef", path: `/groupes/${auditMembership.groupId}`, as: "demo-chief-3" },
  {
    name: "assignment-modal",
    path: `/missions/${assignmentMission.id}`,
    as: "demo-mod",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Attribuer la mission" }).click();
      const dialog = page.getByRole("dialog", { name: /Attribuer la mission/ });
      const select = dialog.getByLabel("Ajouter un autre groupe");
      await select.selectOption({ index: 1 });
      await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
      await select.selectOption({ index: 1 });
      await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
    },
  },
];

const browser = await chromium.launch();
const targetViewports = newScreensOnly
  ? VIEWPORTS.filter(([name]) => ["desktop-1440", "mobile-390", "mobile-360"].includes(name))
  : VIEWPORTS;
const targetPages = newScreensOnly ? PAGES.filter(({ name }) => NEW_SCREEN_NAMES.has(name)) : PAGES;

for (const [vpName, width, height] of targetViewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const tokens = new Map();
  for (const pageDef of targetPages) {
    // Mobile : ne capturer que les pages principales pour limiter le volume
    if ((vpName.startsWith("mobile") || vpName === "tablet-768") &&
        !["connexion", "missions-mod", "mission-ss-mod", "classement", "creation"].includes(pageDef.name) &&
        !NEW_SCREEN_NAMES.has(pageDef.name)) {
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
    await pageDef.prepare?.(page);
    await page.screenshot({ path: path.join(OUT, `${pageDef.name}--${vpName}.png`), fullPage: false });
    await page.close();
  }
  await context.close();
  console.log(`✓ ${vpName}`);
}
await browser.close();
await prisma.$disconnect();
server?.kill("SIGTERM");
server = null;
console.log(`Captures dans ${OUT}`);
