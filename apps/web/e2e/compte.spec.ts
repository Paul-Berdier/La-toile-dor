import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * « Mes informations » : chacun modifie son propre Titre, son grade et son
 * nom. Le test travaille sur un compte qui lui est propre pour n'interférer
 * avec aucune autre spec.
 */
const runId = Date.now().toString(36).toUpperCase();
const USER_ID = `e2e-compte-${runId}`;
const TITLE = `[FICTIF] Ombre ${runId}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const level = await prisma.playerLevel.findFirstOrThrow({ orderBy: { order: "asc" } });
  await prisma.user.create({
    data: {
      id: USER_ID,
      displayName: TITLE,
      displayNameNorm: TITLE.toLowerCase(),
      firstName: "Kaede",
      lastName: "Mizuhara",
      status: "ACTIVE",
      profileCompleted: true,
      privacyAcknowledgedAt: new Date(),
      playerLevelId: level.id,
    },
  });
});

test.afterAll(async () => {
  await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
  await prisma.$disconnect();
});

test("un membre modifie lui-même son Titre, son grade et son nom", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  await expect(page.getByRole("heading", { name: /mes informations/i })).toBeVisible();
  // Les valeurs actuelles sont pré-remplies
  await expect(page.getByLabel("Votre Titre *")).toHaveValue(TITLE);
  await expect(page.getByLabel("Prénom du personnage *")).toHaveValue("Kaede");

  const newTitle = `[FICTIF] Vipère ${runId}`;
  await page.getByLabel("Votre Titre *").fill(newTitle);
  await page.getByLabel("Nom de famille — facultatif").fill("Kurosawa");
  await page.getByRole("button", { name: /enregistrer mes informations/i }).click();

  await expect(page.getByText(/identité mise à jour/i)).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  expect(user.displayName).toBe(newTitle);
  expect(user.lastName).toBe("Kurosawa");
});

test("un Titre déjà porté est refusé", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  // « [FICTIF] Araignée-Mère » appartient à un autre compte du seed
  await page.getByLabel("Votre Titre *").fill("[fictif] araignée-mère");
  await page.getByRole("button", { name: /enregistrer mes informations/i }).click();

  await expect(page.getByText(/déjà porté/i)).toBeVisible();
});
