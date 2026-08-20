import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Non-régression multi-rôles : les droits de modération ne doivent jamais
 * masquer ceux que la même personne possède comme chef d'un groupe.
 */
const ACTOR_ID = "demo-chief-0";
const MISSION_ID = "cmultiroleclaim000000000001";
const MISSION_CODE = "E2E-MR-CLAIM";
const MISSION_TITLE = "Contrat e2e multi-rôles";

let ledGroupId = "";
let moderatorRoleId = "";
let moderatorRoleInitiallyPresent: boolean | null = null;

async function cleanupMissionFixture() {
  const staleMissions = await prisma.mission.findMany({
    where: { OR: [{ id: MISSION_ID }, { code: MISSION_CODE }] },
    select: { id: true },
  });
  const missionIds = [...new Set([MISSION_ID, ...staleMissions.map(({ id }) => id)])];

  await prisma.auditLog.deleteMany({ where: { resourceId: { in: missionIds } } });
  await prisma.notificationDelivery.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupMissionFixture();

  const [moderatorRole, leaderRole, ledMemberships] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { slug: "moderator" } }),
    prisma.role.findUniqueOrThrow({ where: { slug: "group_leader" } }),
    prisma.groupMember.findMany({
      where: { userId: ACTOR_ID, isLeader: true, group: { isActive: true } },
      select: { groupId: true, group: { select: { name: true } } },
    }),
  ]);

  const ledMembership = ledMemberships.sort((a, b) =>
    a.group.name.localeCompare(b.group.name, "fr"),
  )[0];
  if (!ledMembership) throw new Error("Le chef de démonstration ne dirige aucun groupe actif.");
  ledGroupId = ledMembership.groupId;
  moderatorRoleId = moderatorRole.id;

  const [leaderAssignment, moderatorAssignment] = await Promise.all([
    prisma.userRole.findUnique({
      where: { userId_roleId: { userId: ACTOR_ID, roleId: leaderRole.id } },
    }),
    prisma.userRole.findUnique({
      where: { userId_roleId: { userId: ACTOR_ID, roleId: moderatorRole.id } },
    }),
  ]);
  if (!leaderAssignment) throw new Error("Le chef de démonstration a perdu son rôle group_leader.");
  moderatorRoleInitiallyPresent = moderatorAssignment !== null;

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: ACTOR_ID, roleId: moderatorRole.id } },
    update: {},
    create: { userId: ACTOR_ID, roleId: moderatorRole.id },
  });

  await prisma.mission.create({
    data: {
      id: MISSION_ID,
      code: MISSION_CODE,
      publicTitle: MISSION_TITLE,
      publicSummary: "Mission isolée vérifiant le cumul des responsabilités.",
      rank: "D",
      category: "COLLECTE_INFORMATIONS",
      status: "AVAILABLE",
      rewardRyoMin: 100,
      rewardRyoMax: 200,
      basePoints: 10,
      groupSizeMin: 1,
      groupSizeMax: 10,
      eligibilityMode: "RECOMMENDATION",
      creatorId: ACTOR_ID,
      responsibleModeratorId: ACTOR_ID,
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
});

test.afterAll(async () => {
  await cleanupMissionFixture();
  if (moderatorRoleInitiallyPresent === false && moderatorRoleId) {
    await prisma.userRole.deleteMany({
      where: { userId: ACTOR_ID, roleId: moderatorRoleId },
    });
  }
  await prisma.$disconnect();
});

test("un modérateur qui dirige un groupe conserve tout le parcours de revendication", async ({
  context,
  page,
}) => {
  await loginAs(context, ACTOR_ID);
  await page.goto(`/missions/${MISSION_ID}`);

  await expect(page.getByRole("link", { name: /Revendications/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Groupes", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attribution", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saisir ce fil", exact: true })).toBeVisible();

  await page.getByLabel("Cellule candidate").selectOption(ledGroupId);
  const agents = page
    .getByRole("group", { name: /Agents engagés/ })
    .getByRole("checkbox");
  await expect(agents.first()).toBeVisible();
  await agents.first().check();
  await page.getByRole("button", { name: "Réclamer la mission" }).click();
  await expect(page.getByText(/Revendication déposée/)).toBeVisible();

  const claim = await prisma.missionClaim.findUnique({
    where: { missionId_groupId: { missionId: MISSION_ID, groupId: ledGroupId } },
    include: { participants: true },
  });
  expect(claim).toMatchObject({
    leaderId: ACTOR_ID,
    groupId: ledGroupId,
    status: "PENDING",
  });
  expect(claim?.participants.length).toBeGreaterThanOrEqual(1);

  const roles = await prisma.userRole.findMany({
    where: { userId: ACTOR_ID },
    select: { role: { select: { slug: true } } },
  });
  expect(roles.map(({ role }) => role.slug)).toEqual(
    expect.arrayContaining(["moderator", "group_leader"]),
  );
  await expect(
    prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: ledGroupId, userId: ACTOR_ID } },
      select: { isLeader: true },
    }),
  ).resolves.toEqual({ isLeader: true });
});
