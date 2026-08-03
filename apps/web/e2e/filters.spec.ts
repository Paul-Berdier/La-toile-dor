import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("les filtres du tableau vivent dans l'URL et réduisent les cartes", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-mod");

  await page.goto("/missions");
  const allCards = await page.locator("a[href^='/missions/']").count();
  expect(allCards).toBeGreaterThan(3);

  // Filtre par rang SS via l'interface
  await page.getByRole("button", { name: "SS", exact: true }).click();
  await expect(page).toHaveURL(/rank=SS/);
  await expect(page.getByText("TO-SS-0011")).toBeVisible();
  const ssCards = await page.locator("a[href^='/missions/']").count();
  expect(ssCards).toBeLessThan(allCards);

  // Le filtre actif est affiché et supprimable
  await page.getByRole("button", { name: "Rang SS Retirer le filtre" }).click();
  await expect(page).not.toHaveURL(/rank=SS/);

  // Recherche textuelle par code
  await page.getByRole("searchbox").fill("TO-A-0007");
  await expect(page).toHaveURL(/q=TO-A-0007/);
  await expect(page.getByText("Le collecteur de dettes")).toBeVisible();

  // URL directe : filtres restaurés
  await page.goto("/missions?rank=D,C&noLimit=1");
  await expect(page.getByRole("button", { name: "D", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
