import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Onboarding d'identité : Titre RP unique (jamais le pseudo Discord), grade
 * fixé dans l'invitation, prénom obligatoire, nom facultatif, case de
 * confidentialité obligatoire, redirection des profils incomplets et blocage
 * des pages sensibles avant complétion.
 */
const runId = Date.now().toString(36).toUpperCase();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const level = await prisma.playerLevel.findFirstOrThrow({ orderBy: { order: "asc" } });
  await prisma.user.update({
    where: { id: "demo-incomplete" },
    data: { playerLevelId: level.id },
  });
});

test.afterAll(async () => {
  // Remise à zéro du compte de test d'onboarding
  await prisma.user.update({
    where: { id: "demo-incomplete" },
    data: {
      profileCompleted: false,
      firstName: null,
      lastName: null,
      privacyAcknowledgedAt: null,
      displayName: "[FICTIF] Nouveau Fil",
      displayNameNorm: null,
      playerLevelId: null,
    },
  });
  await prisma.$disconnect();
});

test("un profil incomplet est redirigé vers l'onboarding et bloqué ailleurs", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-incomplete");
  await page.goto("/missions");
  await expect(page).toHaveURL(/\/bienvenue/);
  await expect(page.getByLabel("Prénom du personnage *")).toBeVisible();
  // Le Titre est expliqué comme distinct du pseudo Discord
  await expect(page.getByText(/pas.*votre pseudo Discord/i)).toBeVisible();
  // Le champ démarre vide : rien à valider machinalement
  await expect(page.getByLabel("Votre Titre *")).toHaveValue("");
  // Le grade fixé dans l'invitation est visible mais non modifiable
  await expect(page.getByText(/grade fixé dans votre invitation/i)).toBeVisible();
  await expect(page.locator("#ob-level")).toHaveCount(0);
  // L'encart de confidentialité est présent
  await expect(page.getByText("Identité confidentielle")).toBeVisible();
  await expect(page.getByText(/resteront confidentiels/)).toBeVisible();
});

test("le pseudonyme déjà pris est refusé (insensible à la casse)", async ({ context, page }) => {
  await loginAs(context, "demo-incomplete");
  await page.goto("/bienvenue");
  await page.getByLabel("Prénom du personnage *").fill("Testeur");
  // « [FICTIF] Araignée-Mère » existe déjà (casse différente)
  await page.getByLabel("Votre Titre *").fill("[fictif] araignée-mère");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sceller mon identité" }).click();
  await expect(page.getByText(/déjà pris/)).toBeVisible();
});

test("l'onboarding complet ouvre l'accès (nom de famille absent → prénom seul)", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-incomplete");
  await page.goto("/bienvenue");
  await page.getByLabel("Prénom du personnage *").fill("Akira");
  // Nom de famille volontairement vide : le personnage n'en possède pas
  await page.getByLabel("Votre Titre *").fill(`Fil-Nouveau-${runId}`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sceller mon identité" }).click();

  await page.waitForURL(/\/missions/);
  await expect(page.getByRole("heading", { name: /tableau des contrats/i })).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: "demo-incomplete" } });
  expect(user.profileCompleted).toBe(true);
  expect(user.firstName).toBe("Akira");
  expect(user.lastName).toBeNull(); // jamais de valeur fictive de remplacement
  expect(user.privacyAcknowledgedAt).not.toBeNull();
});
