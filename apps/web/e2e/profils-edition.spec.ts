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
  await prisma.profileReferenceOption.deleteMany({
    where: { label: { startsWith: "Clan" }, type: "CLAN_FAMILY" },
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

test("un super-modérateur ajoute directement une entrée au référentiel", async ({
  context,
  page,
}) => {
  // demo-admin détient profile.reference.manage : il crée sans validation
  await loginAs(context, "demo-admin");
  await page.goto(`/profils/${profileId}/modifier`);
  await page.getByRole("button", { name: /Affiliation/ }).click();

  const label = `Clan${suffix}Direct`;
  await page.getByRole("combobox", { name: "Clan(s) et famille(s)" }).fill(label);
  await page.getByRole("button", { name: /Ajouter .* au référentiel/ }).click();

  // L'entrée créée est immédiatement sélectionnée, sans rechargement
  await expect(page.getByRole("button", { name: `Retirer ${label}` })).toBeVisible();

  const option = await prisma.profileReferenceOption.findFirst({
    where: { label, type: "CLAN_FAMILY" },
  });
  expect(option).not.toBeNull();
  expect(option?.isActive).toBe(true);
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

/** Ouvre un dossier minimal avec un code définitif. */
async function makeProfile(firstName: string) {
  const created = await prisma.characterProfile.create({
    data: {
      code: `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      characterFirstName: firstName,
      firstNameNorm: firstName.toLowerCase(),
      createdById: "demo-mod",
    },
  });
  return prisma.characterProfile.update({
    where: { id: created.id },
    data: { code: `PRF-${String(created.codeNumber).padStart(6, "0")}` },
  });
}

test("deux rédacteurs simultanés : le second n'écrase pas le premier", async ({
  context,
  page,
}) => {
  const cible = await makeProfile(`Cible${suffix}Concurrent`);
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${cible.id}/modifier`);
  await page.getByRole("button", { name: /Analyse/ }).click();
  await page.getByLabel("Détails", { exact: true }).fill("Ma saisie à moi.");

  // Pendant la saisie, un autre rédacteur enregistre le dossier
  await prisma.characterProfile.update({
    where: { id: cible.id },
    data: { version: { increment: 1 }, details: "Écrit par l'autre rédacteur." },
  });

  await page.getByRole("button", { name: "Enregistrer le dossier" }).click();
  // L'interface rend des apostrophes typographiques (’) : la classe accepte
  // les deux formes, sans quoi le texte affiché ne correspondrait jamais.
  await expect(page.getByText(/enregistré par quelqu['’]un d['’]autre/)).toBeVisible();

  // Rien n'a été écrit : le travail de l'autre est intact
  const after = await prisma.characterProfile.findUniqueOrThrow({ where: { id: cible.id } });
  expect(after.details).toBe("Écrit par l'autre rédacteur.");
});

test("la suppression est réservée aux super-modérateurs et exige le code", async ({
  context,
  page,
}) => {
  const jetable = await makeProfile(`Cible${suffix}Jetable`);

  // Un modérateur simple n'a pas accès au panneau destructif
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${jetable.id}/modifier`);
  await expect(page.getByRole("button", { name: /Supprimer définitivement/ })).toHaveCount(0);

  // Un super-modérateur le voit, mais doit recopier le code du dossier
  const ctx2 = await page.context().browser()!.newContext();
  await loginAs(ctx2, "demo-admin");
  const page2 = await ctx2.newPage();
  await page2.goto(`/profils/${jetable.id}/modifier`);
  await page2.getByRole("button", { name: /Supprimer définitivement/ }).click();

  const confirmer = page2.getByRole("button", { name: /^Supprimer définitivement$/ }).last();
  await expect(confirmer).toBeDisabled(); // tant que le code n'est pas recopié
  await page2.getByLabel(/Recopiez/).fill(jetable.code);
  await confirmer.click();

  await page2.waitForURL(/\/profils$/);
  const gone = await prisma.characterProfile.findUnique({ where: { id: jetable.id } });
  expect(gone).toBeNull();
  await ctx2.close();
});

test("la fusion de deux dossiers ayant un parent commun ne casse pas", async ({
  context,
  page,
}) => {
  // Reproduit le P2002 observé en production : deux doublons partagent presque
  // toujours un parent, donc la même relation (parent → X, PARENT_OF). Le
  // déplacement en bloc violait alors la contrainte unique et perdait tout.
  const pere = await makeProfile(`Cible${suffix}Pere`);
  const src = await makeProfile(`Cible${suffix}Src`);
  const dst = await makeProfile(`Cible${suffix}Dst`);
  const enfant = await makeProfile(`Cible${suffix}Fils`);

  await prisma.characterRelationship.createMany({
    data: [
      // Le lien partagé, qui faisait tout échouer
      { fromProfileId: pere.id, toProfileId: src.id, type: "PARENT_OF" },
      { fromProfileId: pere.id, toProfileId: dst.id, type: "PARENT_OF" },
      // Un lien porté par la source seule : il doit être transféré
      { fromProfileId: src.id, toProfileId: enfant.id, type: "PARENT_OF" },
    ],
  });

  await loginAs(context, "demo-admin");
  await page.goto(`/profils/${src.id}/modifier`);
  await page.getByRole("button", { name: "Fusionner avec un autre dossier" }).click();
  await page.getByLabel("Dossier à conserver").fill(`Cible${suffix}Dst`);
  await page.getByRole("button", { name: new RegExp(`Cible${suffix}Dst.*PRF-`) }).first().click();
  await page.getByRole("button", { name: "Fusionner", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer la fusion" }).click();

  // La fusion aboutit : plus d'erreur serveur
  await page.waitForURL(new RegExp(`/profils/${dst.id}$`));

  const merged = await prisma.characterProfile.findUniqueOrThrow({ where: { id: src.id } });
  expect(merged.mergedIntoId).toBe(dst.id);

  // Le parent commun n'apparaît qu'UNE fois, le doublon a disparu
  const duPere = await prisma.characterRelationship.findMany({
    where: { fromProfileId: pere.id, type: "PARENT_OF" },
  });
  expect(duPere).toHaveLength(1);
  expect(duPere[0]?.toProfileId).toBe(dst.id);

  // Le lien propre à la source a bien suivi
  const versEnfant = await prisma.characterRelationship.findFirst({
    where: { toProfileId: enfant.id, type: "PARENT_OF" },
  });
  expect(versEnfant?.fromProfileId).toBe(dst.id);
});
