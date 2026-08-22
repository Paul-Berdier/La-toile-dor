import { expect, test } from "@playwright/test";
import { loginAs, prisma, setStreamerCookie } from "./helpers";

/**
 * « Mes informations » : chacun modifie son propre Titre, son nom et sa fiche
 * publique, tandis que le grade contrôlé reste en lecture seule. Le test utilise un compte qui
 * lui est propre pour n'interférer
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
  await prisma.auditLog.deleteMany({ where: { resourceId: USER_ID } });
  await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
  await prisma.$disconnect();
});

test("un membre modifie son Titre et son nom, mais pas son grade", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  await expect(page.getByRole("heading", { name: /mes informations/i })).toBeVisible();
  // Les valeurs actuelles sont pré-remplies
  await expect(page.getByLabel("Votre Titre *")).toHaveValue(TITLE);
  await expect(page.getByLabel("Prénom du personnage *")).toHaveValue("Kaede");
  await expect(page.locator("#ac-level")).toHaveCount(0);
  await expect(page.getByText(/le grade intervient dans l’éligibilité/i)).toBeVisible();

  const newTitle = `[FICTIF] Vipère ${runId}`;
  await page.getByLabel("Votre Titre *").fill(newTitle);
  await page.getByLabel("Nom de famille — facultatif").fill("Kurosawa");
  await page.getByLabel("Biographie publique").fill("Messagère et pisteuse de la Toile.");
  await page.getByRole("button", { name: "Traque", exact: true }).click();
  await page.getByRole("button", { name: "Infiltration", exact: true }).click();
  await page.getByRole("button", { name: /enregistrer mes informations/i }).click();

  await expect(page.getByText(/identité mise à jour/i)).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  expect(user.displayName).toBe(newTitle);
  expect(user.lastName).toBe("Kurosawa");
  expect(user.publicBio).toBe("Messagère et pisteuse de la Toile.");
  expect(user.specialties).toEqual(expect.arrayContaining(["TRAQUE", "INFILTRATION"]));
  expect(user.playerLevelId).not.toBeNull();
});

test("le portrait est validé, servi aux membres puis supprimé", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  // Image PNG réelle : le serveur doit la décoder, la borner et la réencoder
  // sans métadonnées avant stockage.
  const portrait = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Portrait public").setInputFiles({
    name: "portrait.png",
    mimeType: "image/png",
    buffer: portrait,
  });
  await page.getByRole("button", { name: "Enregistrer le portrait" }).click();
  await expect(page.getByText("Portrait public enregistré.")).toBeVisible();

  const served = await context.request.get(`/api/membres/${USER_ID}/portrait`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("image/webp");
  expect(served.headers()["cache-control"]).toBe("private, max-age=60, must-revalidate");
  expect(served.headers()["etag"]).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
  expect(served.headers()["vary"]).toContain("Cookie");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  const sanitized = Buffer.from(await served.body());
  expect(sanitized.length).toBeGreaterThan(0);
  expect(sanitized).not.toEqual(portrait);

  const revalidated = await context.request.get(`/api/membres/${USER_ID}/portrait`, {
    headers: { "If-None-Match": served.headers()["etag"]! },
  });
  expect(revalidated.status()).toBe(304);
  expect(revalidated.headers()["etag"]).toBe(served.headers()["etag"]);
  expect((await revalidated.body()).length).toBe(0);

  await page.getByRole("button", { name: "Supprimer le portrait" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.getByText("Portrait supprimé.")).toBeVisible();
  expect((await context.request.get(`/api/membres/${USER_ID}/portrait`)).status()).toBe(404);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  expect(user.portraitData).toBeNull();
  expect(user.portraitMime).toBeNull();
});

test("un faux PNG est refusé par sa signature", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  await page.getByLabel("Portrait public").setInputFiles({
    name: "mensonge.png",
    mimeType: "image/png",
    buffer: Buffer.from("ceci n'est pas une image"),
  });
  await page.getByRole("button", { name: "Enregistrer le portrait" }).click();
  await expect(page.getByText(/Format refusé/)).toBeVisible();

  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID } });
  expect(user.portraitData).toBeNull();
  expect(user.portraitMime).toBeNull();
});

test("un Titre déjà porté est refusé", async ({ context, page }) => {
  await loginAs(context, USER_ID);
  await page.goto("/compte");

  // « [FICTIF] Araignée-Mère » appartient à un autre compte du seed
  await page.getByLabel("Votre Titre *").fill("[fictif] araignée-mère");
  await page.getByRole("button", { name: /enregistrer mes informations/i }).click();

  await expect(page.getByText(/déjà porté/i)).toBeVisible();
});

test("le mode Streamer n'envoie aucune donnée personnelle au formulaire", async ({
  context,
  page,
}) => {
  await loginAs(context, USER_ID);
  await setStreamerCookie(context);

  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("html") || type.includes("x-component") || type.includes("json")) {
      bodies.push(response.text().catch(() => ""));
    }
  });
  await page.goto("/compte");

  await expect(page.getByRole("heading", { name: "Édition protégée" })).toBeVisible();
  await expect(page.getByLabel("Prénom du personnage *")).toHaveCount(0);
  await expect(page.getByLabel("Biographie publique")).toHaveCount(0);

  const html = await page.content();
  const responses = await Promise.all(bodies);
  for (const secret of ["Kaede", "Kurosawa", "Messagère et pisteuse de la Toile."]) {
    expect(html).not.toContain(secret);
    for (const body of responses) expect(body).not.toContain(secret);
  }
});
