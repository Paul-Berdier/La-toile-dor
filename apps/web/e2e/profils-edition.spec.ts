import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Édition d'un dossier : états de connaissance par champ, autocomplete des
 * référentiels, proposition d'entrée absente, résolution de conflit, fusion.
 */
test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36).replace(/[0-9]/g, (d) => "aeiouzyxwv"[Number(d)]!);
const NAME = `Cible${suffix}`;
let profileId = "";

test.beforeAll(async () => {
  const created = await prisma.characterProfile.create({
    data: {
      code: `tmp-${Date.now()}`,
      characterFirstName: NAME,
      firstNameNorm: NAME.toLowerCase(),
      createdById: "demo-mod",
    },
  });
  await prisma.characterProfile.update({
    where: { id: created.id },
    data: { code: `PRF-${String(created.codeNumber).padStart(6, "0")}` },
  });
  profileId = created.id;
});

test.afterAll(async () => {
  await prisma.characterProfile.deleteMany({
    where: { characterFirstName: { startsWith: "Cible" } },
  });
  await prisma.profileReferenceSuggestion.deleteMany({
    where: { proposedLabel: { startsWith: "Clan" } },
  });
});

test("« Absence confirmée » enregistre NONE_CONFIRMED et affiche « Aucun »", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profileId}/modifier`);

  // Section Capacités → artefacts : déclarer l'absence vérifiée
  await page.getByRole("button", { name: /Capacités/ }).click();
  const artifactState = page.getByLabel(/État du renseignement — Artefact/);
  await artifactState.selectOption("NONE_CONFIRMED");
  await expect(page.getByText("Vérifié : il n'y en a pas.")).toBeVisible();

  await page.getByRole("button", { name: "Enregistrer le dossier" }).click();
  await expect(page.getByText("Dossier enregistré.")).toBeVisible();

  const intel = await prisma.characterFieldIntel.findUnique({
    where: { profileId_fieldKey: { profileId, fieldKey: "artifacts" } },
  });
  expect(intel?.knowledgeState).toBe("NONE_CONFIRMED");

  // Côté dossier : « Aucun » pour l'autorisé
  await page.goto(`/profils/${profileId}`);
  await expect(page.getByText("Aucun").first()).toBeVisible();
});

test("l'autocomplete trouve un clan par alias et sans accent", async ({ context, page }) => {
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profileId}/modifier`);
  await page.getByRole("button", { name: /Affiliation/ }).click();

  await page.getByLabel(/État du renseignement — Clan/).selectOption("KNOWN");
  // « uchiwa » est un alias d'Uchiha, saisi sans accent ni majuscule
  await page.getByRole("combobox", { name: "Clan(s) et famille(s)" }).fill("uchiwa");
  await page.getByRole("option", { name: /Uchiha/ }).click();
  await expect(page.getByRole("button", { name: "Retirer Uchiha" })).toBeVisible();

  // Refermer la liste de suggestions, qui recouvre le bouton d'enregistrement
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enregistrer le dossier" }).click();
  await expect(page.getByText("Dossier enregistré.")).toBeVisible();

  const traits = await prisma.characterProfileTrait.findMany({
    where: { profileId, option: { type: "CLAN_FAMILY" } },
    include: { option: true },
  });
  expect(traits.map((t) => t.option.code)).toContain("UCHIHA");
});

test("proposer une entrée absente crée une suggestion en attente", async ({ context, page }) => {
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profileId}/modifier`);
  await page.getByRole("button", { name: /Affiliation/ }).click();
  await page.getByLabel(/État du renseignement — Clan/).selectOption("KNOWN");

  const label = `Clan${suffix}`;
  await page.getByRole("combobox", { name: "Clan(s) et famille(s)" }).fill(label);
  await page.getByRole("button", { name: /Proposer .* comme nouvelle entrée/ }).click();
  await page.getByRole("button", { name: "Proposer", exact: true }).click();
  await expect(page.getByText(/Proposition transmise/)).toBeVisible();

  const suggestion = await prisma.profileReferenceSuggestion.findFirst({
    where: { proposedLabel: label },
  });
  expect(suggestion?.status).toBe("PENDING");
  expect(suggestion?.type).toBe("CLAN_FAMILY");
});

test("un conflit d'information propose les trois issues", async ({ context, page }) => {
  // Valeur connue posée directement en base
  await prisma.characterProfile.update({
    where: { id: profileId },
    data: { characterLastName: "Ancien" },
  });
  await prisma.characterFieldIntel.upsert({
    where: { profileId_fieldKey: { profileId, fieldKey: "lastName" } },
    update: { knowledgeState: "KNOWN" },
    create: { profileId, fieldKey: "lastName", knowledgeState: "KNOWN" },
  });

  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profileId}/modifier`);
  await page.getByLabel("Nom du personnage").fill("Nouveau");
  await page.getByRole("button", { name: "Enregistrer le dossier" }).click();

  await expect(page.getByText(/contredit une valeur enregistrée/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remplacer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Conserver l/ })).toBeVisible();

  // « Marquer contradictoire » → état CONFLICTING
  await page.getByRole("button", { name: "Marquer contradictoire" }).click();
  await expect(page.getByText("Dossier enregistré.")).toBeVisible();

  const intel = await prisma.characterFieldIntel.findUnique({
    where: { profileId_fieldKey: { profileId, fieldKey: "lastName" } },
  });
  expect(intel?.knowledgeState).toBe("CONFLICTING");

  await page.goto(`/profils/${profileId}`);
  await expect(page.getByText("Information contradictoire").first()).toBeVisible();
});

test("la fusion absorbe un doublon et fait rediriger l'ancien code", async ({
  context,
  page,
}) => {
  const doublon = await prisma.characterProfile.create({
    data: {
      code: `tmp2-${Date.now()}`,
      characterFirstName: NAME,
      firstNameNorm: NAME.toLowerCase(),
      details: "Détail présent uniquement sur le doublon.",
      createdById: "demo-mod",
    },
  });
  await prisma.characterProfile.update({
    where: { id: doublon.id },
    data: { code: `PRF-${String(doublon.codeNumber).padStart(6, "0")}` },
  });

  await loginAs(context, "demo-admin"); // super-modérateur
  await page.goto(`/profils/${doublon.id}/modifier`);
  await page.getByRole("button", { name: "Fusionner avec un autre dossier" }).click();
  await page.getByLabel("Dossier à conserver").fill(NAME);
  await page.getByRole("button", { name: new RegExp(`${NAME}.*PRF-`) }).first().click();
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer la fusion" }).click();

  await page.waitForURL(/\/profils\/[a-z0-9]{20,}$/);

  const merged = await prisma.characterProfile.findUniqueOrThrow({ where: { id: doublon.id } });
  expect(merged.mergedIntoId).toBe(profileId);
  expect(merged.archivedAt).not.toBeNull();

  // L'ancien code redirige vers le dossier conservé
  await page.goto(`/profils/${doublon.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(NAME) })).toBeVisible();
});
