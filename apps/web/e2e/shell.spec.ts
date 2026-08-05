import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Coquille de l'application : la barre latérale doit rester en place pendant
 * que la page défile. Sans `self-start`, le flex l'étire à la hauteur de tout
 * le contenu et `sticky` n'a rien contre quoi coller — le défaut est alors
 * invisible sur une page courte et ne se voit que sur les pages longues.
 */
test("la barre latérale ne défile pas avec le contenu", async ({ context, page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(context, "demo-admin");
  // Le classement est la page la plus longue : il y a de quoi défiler
  await page.goto("/classement?saison=toutes");

  const navLink = page.locator("aside").getByRole("link", { name: "Missions" });
  const before = await navLink.boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.wheel(0, 1200);
  await page.waitForFunction(() => window.scrollY > 200);

  const after = await navLink.boundingBox();
  expect(after).not.toBeNull();
  // La position À L'ÉCRAN n'a pas bougé : la barre est ancrée
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(4);
  // …et elle reste bien dans la fenêtre
  expect(after!.y).toBeGreaterThanOrEqual(0);
  expect(after!.y).toBeLessThan(800);
});

test("le bloc d'identité et la déconnexion restent atteignables", async ({ context, page }) => {
  // Écran peu haut : la liste de navigation doit défiler pour elle-même
  // plutôt que de repousser la déconnexion hors de la barre.
  await page.setViewportSize({ width: 1280, height: 560 });
  await loginAs(context, "demo-admin");
  await page.goto("/missions");

  const logout = page.locator("aside").getByRole("button", { name: /Couper le fil/ });
  await expect(logout).toBeVisible();
  const box = await logout.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(560);
});
