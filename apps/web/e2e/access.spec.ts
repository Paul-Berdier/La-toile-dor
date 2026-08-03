import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

test.describe("accès strictement privé", () => {
  test("sans session, les pages protégées renvoient au seuil", async ({ page }) => {
    for (const path of ["/missions", "/classement", "/admin", "/revendications"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion/);
    }
  });

  test("aucune inscription publique : la connexion de dev est morte en production", async ({
    request,
  }) => {
    const res = await request.get("/api/dev/login?as=demo-admin");
    expect(res.status()).toBe(404);
  });

  test("une invitation invalide affiche un refus générique", async ({ page }) => {
    await page.goto("/invitation/jeton-bidon-jeton-bidon-jeton-bidon");
    await expect(page.getByText("Fil rompu")).toBeVisible();
    await expect(page.getByText(/La Toile ne fournit pas/)).toBeVisible();
  });

  test("un utilisateur suspendu est rejeté malgré une session existante", async ({ context, page }) => {
    const userId = "demo-member-3-1-1";
    await loginAs(context, userId);
    await prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
    try {
      await page.goto("/missions");
      await expect(page).toHaveURL(/\/connexion/);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    }
  });

  test("un membre authentifié accède au tableau", async ({ context, page }) => {
    await loginAs(context, "demo-member-0-0-0");
    await page.goto("/missions");
    await expect(page.getByRole("heading", { name: /tableau des contrats/i })).toBeVisible();
  });
});
