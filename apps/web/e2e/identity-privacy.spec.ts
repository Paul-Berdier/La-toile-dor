import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Confidentialité du prénom/nom : visibles pour le même groupe et la
 * modération, JAMAIS envoyés (DOM, RSC, réseau) aux autres.
 */

async function groupOf(userId: string) {
  const membership = await prisma.groupMember.findFirstOrThrow({
    where: { userId },
    include: { group: true },
  });
  return membership.group;
}

const promotionTargetId = "demo-member-3-0-0";
let promotionGroupId = "";
let promotionTargetName = "";
let promotionAuditCount = 0;

async function resetPromotionFixture() {
  const seededAgents = await prisma.user.findMany({
    where: { id: { startsWith: "demo-member-3-" } },
    select: { id: true },
  });
  const seededAgentIds = seededAgents.map(({ id }) => id);
  const leaderRole = await prisma.role.findUniqueOrThrow({ where: { slug: "group_leader" } });

  await prisma.$transaction([
    prisma.groupMember.updateMany({
      where: { userId: { in: seededAgentIds } },
      data: { isLeader: false },
    }),
    prisma.userRole.deleteMany({
      where: { userId: { in: seededAgentIds }, roleId: leaderRole.id },
    }),
  ]);
}

test.beforeAll(async () => {
  const target = await prisma.groupMember.findFirstOrThrow({
    where: { userId: promotionTargetId },
    include: { group: true, user: true },
  });
  promotionGroupId = target.groupId;
  promotionTargetName = target.user.displayName;

  // Nettoie aussi les promotions laissées par d'anciens runs interrompus.
  await resetPromotionFixture();
  promotionAuditCount = await prisma.auditLog.count({
    where: {
      actorId: "demo-chief-3",
      action: "group.member_promoted",
      resourceId: promotionGroupId,
    },
  });
});

test.afterAll(async () => {
  await resetPromotionFixture();
  await prisma.$disconnect();
});

test("un membre voit les identités réelles de SON groupe", async ({ context, page }) => {
  // demo-member-0-0-0 appartient à Kumogakure — Cellule 1
  const group = await groupOf("demo-member-0-0-0");
  const teammate = await prisma.user.findFirstOrThrow({
    where: {
      id: { not: "demo-member-0-0-0" },
      firstName: { not: null },
      groupMemberships: { some: { groupId: group.id } },
    },
  });

  await loginAs(context, "demo-member-0-0-0");
  await page.goto(`/groupes/${group.id}`);
  await expect(page.getByText(teammate.firstName!, { exact: false }).first()).toBeVisible();
});

test("un membre peut fermer son nom à ses propres coéquipiers", async ({ context, page }) => {
  // La portée appartient à l'intéressé : s'il choisit « la modération seule »,
  // même un coéquipier cesse de voir son nom — et pas seulement à l'écran :
  // la valeur ne doit plus figurer dans la réponse du serveur.
  const group = await groupOf("demo-member-0-0-0");
  const teammate = await prisma.user.findFirstOrThrow({
    where: {
      id: { not: "demo-member-0-0-0" },
      firstName: { not: null },
      groupMemberships: { some: { groupId: group.id } },
    },
  });

  await prisma.user.update({
    where: { id: teammate.id },
    data: { identityVisibility: "MODERATORS" },
  });
  try {
    const bodies: string[] = [];
    page.on("response", async (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (type.includes("text") || type.includes("json")) {
        bodies.push(await response.text().catch(() => ""));
      }
    });

    await loginAs(context, "demo-member-0-0-0");
    await page.goto(`/groupes/${group.id}`);
    // La page a bien chargé le groupe…
    await expect(page.getByRole("heading", { name: new RegExp(group.name) })).toBeVisible();
    // …mais le prénom du coéquipier n'y est plus, DOM et réseau compris
    const html = await page.content();
    expect(html).not.toContain(teammate.firstName!);
    for (const body of bodies) {
      expect(body).not.toContain(teammate.firstName!);
    }

    // La modération, elle, continue de le voir
    const ctx2 = await page.context().browser()!.newContext();
    await loginAs(ctx2, "demo-mod");
    const page2 = await ctx2.newPage();
    await page2.goto(`/groupes/${group.id}`);
    await expect(page2.getByText(teammate.firstName!, { exact: false }).first()).toBeVisible();
    await ctx2.close();
  } finally {
    await prisma.user.update({
      where: { id: teammate.id },
      data: { identityVisibility: "MY_GROUPS" },
    });
  }
});

test("les identités réelles d'un AUTRE groupe ne quittent jamais le serveur", async ({
  context,
  page,
}) => {
  // demo-member-2-0-0 appartient à La Brume Écarlate — un autre groupe
  const otherGroup = await groupOf("demo-member-2-0-0");
  const otherMembers = await prisma.user.findMany({
    where: {
      firstName: { not: null },
      groupMemberships: { some: { groupId: otherGroup.id } },
      // exclut la modération et le visiteur lui-même
      id: { startsWith: "demo-member-2" },
    },
    select: { firstName: true, lastName: true },
  });
  expect(otherMembers.length).toBeGreaterThan(0);

  await loginAs(context, "demo-member-0-0-0");

  const responses: Promise<string>[] = [];
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("html") || type.includes("x-component") || type.includes("json")) {
      responses.push(response.text().catch(() => ""));
    }
  });

  await page.goto(`/groupes/${otherGroup.id}`);
  // Un groupe étranger peut être entièrement introuvable : c'est plus strict
  // encore que d'afficher une liste anonymisée.
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();

  const html = await page.content();
  const bodies = await Promise.all(responses);
  for (const member of otherMembers) {
    expect(html, `« ${member.firstName} » ne doit pas être dans le DOM`).not.toContain(
      member.firstName!,
    );
    for (const body of bodies) {
      expect(body).not.toContain(member.firstName!);
    }
  }
});

test("la modération voit toutes les identités réelles", async ({ context, page }) => {
  const group = await groupOf("demo-member-2-0-0");
  const member = await prisma.user.findFirstOrThrow({
    where: { firstName: { not: null }, groupMemberships: { some: { groupId: group.id } } },
  });

  await loginAs(context, "demo-mod");
  await page.goto(`/groupes/${group.id}`);
  await expect(page.getByText(member.firstName!, { exact: false }).first()).toBeVisible();
});

test("promotion : un chef promeut un agent de SON groupe (audit + rôle)", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-chief-3");
  await page.goto(`/groupes/${promotionGroupId}`);
  const row = page.locator("li", { hasText: promotionTargetName });
  await row.getByRole("button", { name: "Promouvoir en chef de groupe" }).click();
  await expect(page.getByText(/Vous êtes sur le point de promouvoir/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmer la promotion" }).click();

  await expect(page.getByRole("button", { name: "Confirmer la promotion" })).toHaveCount(0);

  await expect
    .poll(async () => {
      const updated = await prisma.groupMember.findUniqueOrThrow({
        where: { groupId_userId: { groupId: promotionGroupId, userId: promotionTargetId } },
      });
      return updated.isLeader;
    })
    .toBe(true);

  await expect
    .poll(() =>
      prisma.auditLog.count({
        where: {
          actorId: "demo-chief-3",
          action: "group.member_promoted",
          resourceId: promotionGroupId,
        },
      }),
    )
    .toBe(promotionAuditCount + 1);
});
