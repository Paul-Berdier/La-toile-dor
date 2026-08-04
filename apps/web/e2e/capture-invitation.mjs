/**
 * Audit visuel de la branche « invitation » : première connexion (Titre et
 * grade déclarés par le joueur), page « Mes informations », formulaire
 * d'invitation sans grade, liste des dossiers (noms de famille, filtres
 * fluides) et section Apparence de l'éditeur (couleurs visibles).
 *
 * Usage : node e2e/capture-invitation.mjs <dossier-de-sortie>
 * Prérequis : serveur de production sur :3100 (npx next start -p 3100).
 */
import { chromium } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../../../packages/database/generated/client/index.js";

const OUT = process.argv[2] ?? "audit-invitation";
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

const akira = await prisma.characterProfile.findFirstOrThrow({
  where: { characterFirstName: "Akira" },
});

const browser = await chromium.launch();

/** Une capture = un utilisateur, une page, une résolution. */
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
  // Première connexion : le Titre est expliqué, le grade est proposé
  await shot("demo-incomplete", "/bienvenue", `bienvenue-${label}`, width, height);
  // Mes informations : auto-édition
  await shot("demo-admin", "/compte", `compte-${label}`, width, height);
  // Invitation : plus aucun grade imposé, terminologie « groupe »
  await shot("demo-admin", "/invitations", `invitations-${label}`, width, height);
  // Liste des dossiers : noms de famille et filtres sans bouton
  await shot("demo-admin", "/profils", `profils-liste-${label}`, width, height);
  // Éditeur, section Apparence : les couleurs sont saisissables d'emblée
  await shot(
    "demo-admin",
    `/profils/${akira.id}/modifier`,
    `profils-apparence-${label}`,
    width,
    height,
    async (page) => {
      await page.getByRole("button", { name: /Apparence/ }).click();
      await page.waitForTimeout(300);
    },
  );
}

await browser.close();
await prisma.$disconnect();
console.log(`Captures écrites dans ${OUT}`);
