import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Parcours complet et isolé d'évolution de grade. Aucun compte, rôle ou grade
 * du seed de démonstration n'est modifié : toutes les entités métier sont
 * propres à ce fichier et supprimées, avec leurs audits/notifications, même
 * si une assertion échoue.
 */
const runId = Date.now().toString(36).toLowerCase();
const MEMBER_ID = `e2e-grade-member-${runId}`;
const REVIEWER_ID = `e2e-grade-reviewer-${runId}`;
const REVIEWER_ROLE_SLUG = `e2e-grade-moderator-${runId}`;
const CURRENT_LEVEL_SLUG = `e2e-grade-current-${runId}`;
const NEXT_LEVEL_SLUG = `e2e-grade-next-${runId}`;
const MEMBER_TITLE = `[FICTIF] Aspirant ${runId.toUpperCase()}`;
const REVIEWER_TITLE = `[FICTIF] Tisseur ${runId.toUpperCase()}`;
const CURRENT_LEVEL_LABEL = `Grade initial E2E ${runId.toUpperCase()}`;
const NEXT_LEVEL_LABEL = `Grade suivant E2E ${runId.toUpperCase()}`;
const REQUEST_REASON = `Progression RP E2E ${runId}`;
const REVIEW_REASON = `Validation croisée E2E ${runId}`;

let currentLevelId = "";
let nextLevelId = "";
let requestId = "";

async function cleanupFixtures(): Promise<string[]> {
  const requests = await prisma.userLevelChangeRequest.findMany({
    where: { targetUserId: MEMBER_ID },
    select: { id: true },
  });
  const batchKeys = requests.flatMap(({ id }) => [
    `user-level:${id}`,
    `user-level:${id}:decision`,
  ]);

  if (batchKeys.length > 0) {
    // La demande est envoyée à tous les détenteurs de la permission : retirer
    // par batchKey nettoie aussi les livraisons destinées aux comptes partagés.
    await prisma.notificationDelivery.deleteMany({
      where: { batchKey: { in: batchKeys } },
    });
  }
  await prisma.auditLog.deleteMany({ where: { resourceId: MEMBER_ID } });
  await prisma.userLevelChangeRequest.deleteMany({ where: { targetUserId: MEMBER_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [MEMBER_ID, REVIEWER_ID] } } });
  await prisma.role.deleteMany({ where: { slug: REVIEWER_ROLE_SLUG } });
  await prisma.playerLevel.deleteMany({
    where: { slug: { in: [CURRENT_LEVEL_SLUG, NEXT_LEVEL_SLUG] } },
  });
  return requests.map(({ id }) => id);
}

async function assertFixturesRemoved(cleanedRequestIds: string[]) {
  const deliveryKeys = cleanedRequestIds.flatMap((id) => [
    `user-level:${id}`,
    `user-level:${id}:decision`,
  ]);
  const [users, roles, levels, requests, audits, deliveries] = await Promise.all([
    prisma.user.count({ where: { id: { in: [MEMBER_ID, REVIEWER_ID] } } }),
    prisma.role.count({ where: { slug: REVIEWER_ROLE_SLUG } }),
    prisma.playerLevel.count({
      where: { slug: { in: [CURRENT_LEVEL_SLUG, NEXT_LEVEL_SLUG] } },
    }),
    prisma.userLevelChangeRequest.count({ where: { targetUserId: MEMBER_ID } }),
    prisma.auditLog.count({ where: { resourceId: MEMBER_ID } }),
    deliveryKeys.length > 0
      ? prisma.notificationDelivery.count({ where: { batchKey: { in: deliveryKeys } } })
      : Promise.resolve(0),
  ]);
  const residue = { users, roles, levels, requests, audits, deliveries };
  if (Object.values(residue).some((count) => count !== 0)) {
    throw new Error(`Nettoyage E2E grades incomplet : ${JSON.stringify(residue)}`);
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupFixtures();

  const [permission, occupiedOrders] = await Promise.all([
    prisma.permission.findUniqueOrThrow({ where: { key: "user.level.manage" } }),
    prisma.playerLevel.findMany({ select: { order: true } }),
  ]);
  const usedOrders = new Set(occupiedOrders.map(({ order }) => order));
  let firstOrder = 1_800_000_000;
  while (usedOrders.has(firstOrder) || usedOrders.has(firstOrder + 1)) firstOrder += 2;

  const [currentLevel, nextLevel, reviewerRole] = await prisma.$transaction([
    prisma.playerLevel.create({
      data: {
        slug: CURRENT_LEVEL_SLUG,
        label: CURRENT_LEVEL_LABEL,
        order: firstOrder,
      },
    }),
    prisma.playerLevel.create({
      data: {
        slug: NEXT_LEVEL_SLUG,
        label: NEXT_LEVEL_LABEL,
        order: firstOrder + 1,
      },
    }),
    prisma.role.create({
      data: {
        slug: REVIEWER_ROLE_SLUG,
        name: `Modérateur E2E ${runId.toUpperCase()}`,
        isSystem: false,
      },
    }),
  ]);
  currentLevelId = currentLevel.id;
  nextLevelId = nextLevel.id;

  await prisma.$transaction([
    prisma.rolePermission.create({
      data: { roleId: reviewerRole.id, permissionId: permission.id },
    }),
    prisma.user.create({
      data: {
        id: MEMBER_ID,
        displayName: MEMBER_TITLE,
        displayNameNorm: MEMBER_TITLE.toLowerCase(),
        firstName: "Aspirant",
        status: "ACTIVE",
        profileCompleted: true,
        privacyAcknowledgedAt: new Date(),
        playerLevelId: currentLevel.id,
      },
    }),
    prisma.user.create({
      data: {
        id: REVIEWER_ID,
        displayName: REVIEWER_TITLE,
        displayNameNorm: REVIEWER_TITLE.toLowerCase(),
        firstName: "Tisseur",
        status: "ACTIVE",
        profileCompleted: true,
        privacyAcknowledgedAt: new Date(),
        playerLevelId: currentLevel.id,
        roles: { create: { roleId: reviewerRole.id } },
      },
    }),
  ]);
});

test.afterAll(async () => {
  const cleanedRequestIds = await cleanupFixtures();
  await assertFixturesRemoved(cleanedRequestIds);
  await prisma.$disconnect();
});

test("un membre demande le grade suivant et un autre modérateur l'approuve", async ({
  context,
  page,
}) => {
  await loginAs(context, MEMBER_ID);
  await page.goto("/grades");

  await expect(
    page.getByRole("heading", { name: "Demander pour mon personnage" }),
  ).toBeVisible();
  await expect(page.getByText(CURRENT_LEVEL_LABEL, { exact: false }).first()).toBeVisible();
  await page.getByLabel("Grade demandé").selectOption(nextLevelId);
  await page.getByLabel("Motif de la demande *").fill(REQUEST_REASON);
  await page.getByRole("button", { name: "Transmettre la demande" }).click();
  await expect(page.getByText(/Demande transmise/)).toBeVisible();

  await expect
    .poll(async () =>
      Boolean(
        await prisma.userLevelChangeRequest.findFirst({
          where: { targetUserId: MEMBER_ID, status: "PENDING" },
          select: { id: true },
        }),
      ),
    )
    .toBe(true);
  // `expect.poll` n'expose pas la valeur : relire par la clé de fixture reste
  // déterministe puisqu'un index garantit une seule demande PENDING par cible.
  const createdRequest = await prisma.userLevelChangeRequest.findFirstOrThrow({
    where: { targetUserId: MEMBER_ID, status: "PENDING" },
  });
  requestId = createdRequest.id;
  expect(createdRequest).toMatchObject({
    requestedById: MEMBER_ID,
    currentLevelId,
    requestedLevelId: nextLevelId,
    reason: REQUEST_REASON,
  });

  await expect
    .poll(() =>
      prisma.auditLog.count({
        where: {
          actorId: MEMBER_ID,
          action: "user.level_change_requested",
          resourceId: MEMBER_ID,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(() =>
      prisma.notificationDelivery.count({
        where: {
          userId: REVIEWER_ID,
          event: "USER_LEVEL_CHANGE_REQUESTED",
          batchKey: `user-level:${requestId}`,
        },
      }),
    )
    .toBe(1);

  await context.clearCookies();
  await loginAs(context, REVIEWER_ID);
  await page.goto("/grades");

  const decisionCard = page
    .locator("li")
    .filter({ hasText: MEMBER_TITLE })
    .filter({ hasText: REQUEST_REASON });
  await expect(decisionCard).toHaveCount(1);
  await decisionCard.getByLabel("Motif de la décision *").fill(REVIEW_REASON);
  await decisionCard.getByRole("button", { name: "Approuver le grade" }).click();
  await expect(decisionCard).toHaveCount(0);

  await expect
    .poll(async () => {
      const [user, request] = await Promise.all([
        prisma.user.findUniqueOrThrow({
          where: { id: MEMBER_ID },
          select: { playerLevelId: true },
        }),
        prisma.userLevelChangeRequest.findUniqueOrThrow({
          where: { id: requestId },
          select: { status: true, reviewedById: true, reviewNote: true },
        }),
      ]);
      return { user, request };
    })
    .toEqual({
      user: { playerLevelId: nextLevelId },
      request: {
        status: "APPROVED",
        reviewedById: REVIEWER_ID,
        reviewNote: REVIEW_REASON,
      },
    });

  await expect
    .poll(() =>
      prisma.auditLog.count({
        where: {
          actorId: REVIEWER_ID,
          action: "user.level_change_approved",
          resourceId: MEMBER_ID,
        },
      }),
    )
    .toBe(1);
  await expect
    .poll(() =>
      prisma.notificationDelivery.count({
        where: {
          userId: MEMBER_ID,
          event: "USER_LEVEL_CHANGE_APPROVED",
          batchKey: `user-level:${requestId}:decision`,
        },
      }),
    )
    .toBe(1);
});
