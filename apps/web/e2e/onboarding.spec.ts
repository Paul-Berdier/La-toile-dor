import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Onboarding d'identité : prénom obligatoire, nom facultatif, pseudonyme
 * unique, case de confidentialité obligatoire, redirection des profils
 * incomplets, blocage des pages sensibles avant complétion.
 */
const runId = Date.now().toString(36).toUpperCase();

test.describe.configure({ mode: "serial" });

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
  await expect(page.getByLabel("Prénom *")).toBeVisible();
  // L'encart de confidentialité est présent
  await expect(page.getByText("Identité confidentielle")).toBeVisible();
  await expect(page.getByText(/resteront confidentiels/)).toBeVisible();
});

test("le pseudonyme déjà pris est refusé (insensible à la casse)", async ({ context, page }) => {
  await loginAs(context, "demo-incomplete");
  await page.goto("/bienvenue");
  await page.getByLabel("Prénom *").fill("Testeur");
  // « [FICTIF] Araignée-Mère » existe déjà (casse différente)
  await page.getByLabel("Pseudonyme public *").fill("[fictif] araignée-mère");
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
  await page.getByLabel("Prénom *").fill("Akira");
  // Nom de famille volontairement vide : le personnage n'en possède pas
  await page.getByLabel("Pseudonyme public *").fill(`Fil-Nouveau-${runId}`);
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
