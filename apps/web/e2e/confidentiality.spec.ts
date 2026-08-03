import { expect, test } from "@playwright/test";
import { loginAs, setStreamerCookie, ssMissionId } from "./helpers";

/**
 * LE test central du projet : les données confidentielles de TO-SS-0011
 * (« Seigneur Kaimon », « Forteresse des marées », commanditaire) ne doivent
 * JAMAIS atteindre le navigateur d'un utilisateur non autorisé — ni dans le
 * DOM, ni dans le payload RSC, ni dans aucune réponse réseau.
 */

const SECRETS = ["Kaimon", "Forteresse des marées", "commanditaire voilé"];

test("un chef de faction non attribué ne reçoit RIEN du dossier scellé", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-chief-1");
  const missionId = await ssMissionId();

  const responses: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("text") || type.includes("json") || type.includes("javascript")) {
      responses.push(await response.text().catch(() => ""));
    }
  });

  await page.goto(`/missions/${missionId}`);
  await expect(page.getByText("Dossier scellé").first()).toBeVisible();

  const html = await page.content();
  for (const secret of SECRETS) {
    expect(html, `« ${secret} » ne doit pas être dans le DOM`).not.toContain(secret);
    for (const body of responses) {
      expect(body, `« ${secret} » ne doit être dans aucune réponse réseau`).not.toContain(secret);
    }
  }

  // La catégorie de la mission SS est voilée par le modérateur
  await expect(page.getByText("Élimination de cible")).toHaveCount(0);
});

test("le tableau Kanban ne fuit aucun secret vers un simple membre", async ({ context, page }) => {
  await loginAs(context, "demo-member-0-0-0");
  await page.goto("/missions");
  const html = await page.content();
  for (const secret of SECRETS) {
    expect(html).not.toContain(secret);
  }
});

test("un modérateur voit le dossier complet", async ({ context, page }) => {
  await loginAs(context, "demo-mod");
  const missionId = await ssMissionId();
  await page.goto(`/missions/${missionId}`);
  await expect(page.getByText("[FICTIF] Seigneur Kaimon", { exact: true })).toBeVisible();
  await expect(page.getByText("[FICTIF] Forteresse des marées", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /notes internes/i })).toBeVisible();
});

test("le mode Streamer voile les valeurs sensibles CÔTÉ SERVEUR", async ({ context, page }) => {
  await loginAs(context, "demo-mod");
  await setStreamerCookie(context);
  const missionId = await ssMissionId();
  await page.goto(`/missions/${missionId}`);

  await expect(page.getByText("Mode Streamer actif", { exact: false })).toBeVisible();
  const html = await page.content();
  for (const secret of SECRETS) {
    expect(html, `mode Streamer : « ${secret} » ne doit pas partir au navigateur`).not.toContain(
      secret,
    );
  }
  // Les valeurs sont remplacées par des codes
  await expect(page.getByText(/CIBLE-[0-9A-F]{4}/)).toBeVisible();
});

test("le filigrane est présent sur les pages authentifiées", async ({ context, page }) => {
  await loginAs(context, "demo-mod");
  await page.goto("/missions");
  const watermarks = page.locator("[data-wm]");
  await expect(watermarks.first()).toBeAttached();
});
