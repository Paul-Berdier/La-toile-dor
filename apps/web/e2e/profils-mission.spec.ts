import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Renseignement issu d'une mission : le parcours part de la mission, la
 * rattache comme source, et rien n'est appliqué sans confirmation.
 */
const suffix = Date.now().toString(36).replace(/[0-9]/g, (d) => "aeiouzyxwv"[Number(d)]!);
const NAME = `Informe${suffix}`;

test.afterAll(async () => {
  await prisma.characterProfile.deleteMany({
    where: { characterFirstName: { startsWith: "Informe" } },
  });
});

test("depuis une mission : créer un dossier puis y verser un renseignement daté", async ({
  context,
  page,
}) => {
  // Mission de collecte d'informations, en cours
  const mission = await prisma.mission.findFirstOrThrow({
    where: { status: { in: ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] } },
  });

  await loginAs(context, "demo-mod");
  await page.goto(`/missions/${mission.id}`);

  // Le bandeau « Renseignement » propose de verser les informations
  await expect(page.getByRole("heading", { name: "Renseignement" })).toBeVisible();
  await page.getByRole("link", { name: "Ajouter les renseignements au dossier" }).click();

  // La liste rappelle la mission d'origine
  await expect(page.getByText(new RegExp(`Renseignements de la mission.*${mission.code}`))).toBeVisible();

  // Création du dossier depuis ce contexte
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
  await page.getByLabel("Prénom du personnage *").fill(NAME);
  await page.getByRole("button", { name: "Créer et compléter" }).click();

  // On arrive sur l'édition, toujours rattachée à la mission
  await page.waitForURL(/\/profils\/[a-z0-9]{20,}\/modifier\?mission=/);
  await page.getByRole("button", { name: /Source & aperçu/ }).click();
  await expect(page.getByText(/rattaché à la mission d/)).toBeVisible();

  // Renseignement structuré + confiance + date RP d'observation
  await page.getByRole("button", { name: /Identité/ }).first().click();
  await page.getByLabel(/État du renseignement — Nom/).selectOption("KNOWN");
  await page.getByLabel("Nom du personnage").fill("Kirigawa");
  await page.getByRole("button", { name: /Source & aperçu/ }).click();
  await page.getByLabel("Niveau de confiance").selectOption("CONFIRMED");
  await page.getByLabel(/Date RP d/).fill("12e jour du mois de la Brume, an 42");
  await page.getByRole("button", { name: "Enregistrer le dossier" }).click();
  await expect(page.getByText("Dossier enregistré.")).toBeVisible();

  // La mission est enregistrée comme source du champ, avec sa confiance
  const profile = await prisma.characterProfile.findFirstOrThrow({
    where: { characterFirstName: NAME },
  });
  const intel = await prisma.characterFieldIntel.findUniqueOrThrow({
    where: { profileId_fieldKey: { profileId: profile.id, fieldKey: "lastName" } },
  });
  expect(intel.sourceMissionId).toBe(mission.id);
  expect(intel.confidence).toBe("CONFIRMED");
  expect(intel.observedAtRp).toContain("Brume");
  expect(profile.characterLastName).toBe("Kirigawa");

  // L'historique conserve la trace du renseignement
  const revision = await prisma.characterProfileRevision.findFirst({
    where: { profileId: profile.id, fieldKey: "lastName" },
  });
  expect(revision?.sourceMissionId).toBe(mission.id);

  // Le dossier affiche la source côté modération
  await page.goto(`/profils/${profile.id}`);
  const moderationIntel = page
    .getByRole("heading", { name: "Renseignements (modération)" })
    .locator("..");
  await expect(
    moderationIntel.getByRole("listitem").filter({ hasText: `mission ${mission.code}` }),
  ).toBeVisible();
});
