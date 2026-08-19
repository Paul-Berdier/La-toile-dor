import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * État vital des ninjas :
 *  - la modération marque plusieurs dossiers morts d'un geste (sélection
 *    multiple sur la liste) — croix rouge sur carte et dossier ;
 *  - une proposition de décès en attente saute aux yeux du relecteur ;
 *  - la croix ne fuit jamais vers un lecteur sans accès.
 */

async function createToileProfile(firstName: string) {
  return prisma.characterProfile.create({
    data: {
      code: `ZZ-VIE-${firstName.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      characterFirstName: firstName,
      firstNameNorm: firstName.toLowerCase(),
      title: `Dossier — ${firstName}`,
      lifeStatus: "ALIVE",
      createdById: "demo-mod",
      fieldIntel: { create: [{ fieldKey: "lifeStatus", knowledgeState: "KNOWN", confidence: "CONFIRMED" }] },
    },
  });
}

test("la modération passe DEUX dossiers en morts d'un geste ; croix rouge affichée, rien ne fuit", async ({
  browser,
  context,
  page,
}) => {
  const a = await createToileProfile("ZZVivanta");
  const b = await createToileProfile("ZZVivantb");
  try {
    await loginAs(context, "demo-mod");
    await page.goto("/profils");

    // Sélection des deux cartes puis « Marquer morts » (confirmation native)
    await page.getByRole("checkbox", { name: /Sélectionner ZZVivanta/ }).check();
    await page.getByRole("checkbox", { name: /Sélectionner ZZVivantb/ }).check();
    await expect(page.getByText(/2 dossiers sélectionnés/)).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Marquer morts/ }).click();
    await expect(page.getByText(/2 dossiers passés à « MORT »/)).toBeVisible();

    // En base : état vital, ligne d'intel, révision
    for (const id of [a.id, b.id]) {
      const row = await prisma.characterProfile.findUniqueOrThrow({
        where: { id },
        include: { fieldIntel: { where: { fieldKey: "lifeStatus" } }, revisions: true },
      });
      expect(row.lifeStatus).toBe("DEAD");
      expect(row.fieldIntel[0]?.knowledgeState).toBe("KNOWN");
      expect(row.revisions.some((r) => r.fieldKey === "lifeStatus")).toBe(true);
    }

    // La carte porte la croix et le badge « Mort »
    const card = page.locator("li").filter({ hasText: a.code }).first();
    await expect(card.getByText(/✕ Mort/)).toBeVisible();
    await expect(card.getByRole("img", { name: /Ninja mort/ })).toBeVisible();

    // Le dossier aussi
    await page.goto(`/profils/${a.id}`);
    await expect(page.getByRole("img", { name: /Ninja mort/ })).toBeVisible();
    await expect(page.getByText("✕ Mort").first()).toBeVisible();

    // Un lecteur SANS accès ne voit ni croix ni « Mort » : l'état vital est
    // un renseignement comme un autre (« ??? »)
    const otherCtx = await browser.newContext();
    await loginAs(otherCtx, "demo-member-2-0-0");
    const other = await otherCtx.newPage();
    await other.goto(`/profils/${a.id}`);
    await expect(other.getByRole("img", { name: /Ninja mort/ })).toHaveCount(0);
    expect(await other.content()).not.toContain("✕ Mort");
    await otherCtx.close();
  } finally {
    await prisma.characterProfile.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  }
});

test("une proposition de décès en attente est signalée au relecteur dès l'en-tête", async ({
  context,
  page,
}) => {
  // Dossier appartenant à un groupe ; un acquéreur propose « Mort »
  const member = "demo-member-1-0-0";
  const membership = await prisma.groupMember.findFirstOrThrow({
    where: { userId: member, group: { isActive: true } },
  });
  const profile = await prisma.characterProfile.create({
    data: {
      code: `ZZ-DP-${Date.now().toString(36).toUpperCase()}`,
      characterFirstName: "ZZProposeMort",
      firstNameNorm: "zzproposemort",
      title: "Dossier — ZZProposeMort",
      lifeStatus: "ALIVE",
      createdByGroupId: membership.groupId,
      createdById: member,
      accessGrants: {
        create: { groupId: membership.groupId, grantedById: member, sourceType: "CREATED_BY_GROUP" },
      },
    },
  });
  await prisma.profileIntelContribution.create({
    data: {
      profileId: profile.id,
      fieldKey: "lifeStatus",
      proposedValue: "DEAD",
      proposedLabel: "Mort",
      knowledgeState: "KNOWN",
      confidence: "PROBABLE",
      sourceType: "USER",
      contributorId: "demo-member-2-0-0",
      status: "PENDING_REVIEW",
      conflictsWithExisting: true,
    },
  });
  try {
    await loginAs(context, member);
    await page.goto(`/profils/${profile.id}`);
    // L'alerte en tête, et la proposition marquée en rouge dans la liste
    await expect(page.getByRole("link", { name: /Un renseignement propose : Mort/ })).toBeVisible();
    await expect(page.getByText("Décès proposé")).toBeVisible();
  } finally {
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});
