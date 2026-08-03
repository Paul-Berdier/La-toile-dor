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
let promotionFactionId = "";
let promotionTargetName = "";
let promotionAuditCount = 0;

async function resetPromotionFixture() {
  const seededAgents = await prisma.user.findMany({
    where: { id: { startsWith: "demo-member-3-" } },
    select: { id: true },
  });
  const seededAgentIds = seededAgents.map(({ id }) => id);
  const leaderRole = await prisma.role.findUniqueOrThrow({ where: { slug: "faction_leader" } });

  await prisma.$transaction([
    prisma.groupMember.updateMany({
      where: { userId: { in: seededAgentIds } },
      data: { isLeader: false },
    }),
    prisma.factionMember.updateMany({
      where: { factionId: promotionFactionId, userId: { in: seededAgentIds } },
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
  promotionFactionId = target.group.factionId;
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

  const responses: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("text") || type.includes("json") || type.includes("javascript")) {
      responses.push(await response.text().catch(() => ""));
    }
  });

  await page.goto(`/groupes/${otherGroup.id}`);
  await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible();

  const html = await page.content();
  for (const member of otherMembers) {
    expect(html, `« ${member.firstName} » ne doit pas être dans le DOM`).not.toContain(
      member.firstName!,
    );
    for (const body of responses) {
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
