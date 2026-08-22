import { expect, test, type Page } from "@playwright/test";
import type { IdentityVisibility, MissionCategory } from "@toile/database";
import { loginAs, prisma, setStreamerCookie } from "./helpers";

/**
 * Fiches membres : les informations publiques suivent un agent partout dans
 * l'interface, tandis que son identité réelle reste filtrée côté serveur.
 */
const TARGET_ID = "demo-member-0-0-0";
const OUTSIDER_ID = "demo-member-2-0-0";
const MISSION_ID = "cmemberprofilee2e000000001";
const MISSION_CODE = "E2E-MEMBER-PROFILE";
const PUBLIC_BIO = "Présentation publique e2e — fil d’or.";
const SECRET_FIRST_NAME = "PrenomSecretE2EProfil";
const SECRET_LAST_NAME = "NomSecretE2EProfil";
const PORTRAIT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

let targetSnapshot: {
  firstName: string | null;
  lastName: string | null;
  publicBio: string | null;
  specialties: MissionCategory[];
  portraitData: Uint8Array | null;
  portraitMime: string | null;
  identityVisibility: IdentityVisibility;
} | null = null;
let targetDisplayName = "";
let targetGroupId = "";
let targetGroupName = "";

function collectTextBodies(page: Page): () => Promise<string[]> {
  const pending: Promise<string>[] = [];
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("html") || type.includes("x-component") || type.includes("json")) {
      pending.push(response.text().catch(() => ""));
    }
  });
  return async () => {
    let previousCount = -1;
    while (previousCount !== pending.length) {
      previousCount = pending.length;
      await Promise.all(pending.slice(0, previousCount));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return Promise.all(pending);
  };
}

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

  const [target, memberships, outsiderMemberships, activeSeason] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: TARGET_ID },
      select: {
        displayName: true,
        firstName: true,
        lastName: true,
        publicBio: true,
        specialties: true,
        portraitData: true,
        portraitMime: true,
        identityVisibility: true,
      },
    }),
    prisma.groupMember.findMany({
      where: { userId: TARGET_ID, group: { isActive: true } },
      select: { groupId: true, group: { select: { name: true } } },
      orderBy: { groupId: "asc" },
    }),
    prisma.groupMember.findMany({
      where: { userId: OUTSIDER_ID, group: { isActive: true } },
      select: { groupId: true },
      orderBy: { groupId: "asc" },
    }),
    prisma.leaderboardSeason.findFirst({
      where: { isActive: true },
      orderBy: { startsAt: "desc" },
    }),
  ]);

  const targetMembership = memberships[0];
  if (!targetMembership) throw new Error("Le membre e2e n’appartient à aucun groupe actif.");
  const outsiderGroupIds = new Set(outsiderMemberships.map(({ groupId }) => groupId));
  if (memberships.some(({ groupId }) => outsiderGroupIds.has(groupId))) {
    throw new Error("Le visiteur extérieur partage désormais un groupe avec le membre e2e.");
  }

  targetSnapshot = target;
  targetDisplayName = target.displayName;
  targetGroupId = targetMembership.groupId;
  targetGroupName = targetMembership.group.name;

  const now = Date.now();
  const resolvedAt = activeSeason
    ? new Date(
        Math.max(
          activeSeason.startsAt.getTime() + 1_000,
          activeSeason.endsAt
            ? Math.min(now, activeSeason.endsAt.getTime() - 1_000)
            : now,
        ),
      )
    : new Date(now);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: TARGET_ID },
      data: {
        firstName: SECRET_FIRST_NAME,
        lastName: SECRET_LAST_NAME,
        publicBio: PUBLIC_BIO,
        specialties: ["INFILTRATION", "TRAQUE"],
        portraitData: PORTRAIT_PNG,
        portraitMime: "image/png",
        identityVisibility: "MODERATORS",
      },
    }),
    prisma.mission.create({
      data: {
        id: MISSION_ID,
        code: MISSION_CODE,
        publicTitle: "Parcours membre e2e",
        rank: "D",
        category: "INFILTRATION",
        status: "COMPLETED",
        rewardRyoMin: 100,
        rewardRyoMax: 200,
        awardedRyo: 111,
        basePoints: 7,
        creatorId: "demo-mod",
        publishedAt: resolvedAt,
        resolvedAt,
        participants: {
          create: {
            userId: TARGET_ID,
            groupId: targetGroupId,
            addedById: "demo-mod",
            pointsAwarded: 7,
            ryoAwarded: 111,
          },
        },
      },
    }),
  ]);
});

test.afterAll(async () => {
  const snapshot = targetSnapshot;
  const cleanupResults = await Promise.allSettled([
    cleanupMissionFixture(),
    snapshot
      ? prisma.user.update({
          where: { id: TARGET_ID },
          data: {
            firstName: snapshot.firstName,
            lastName: snapshot.lastName,
            publicBio: snapshot.publicBio,
            specialties: snapshot.specialties,
            portraitData: snapshot.portraitData
              ? new Uint8Array(snapshot.portraitData)
              : null,
            portraitMime: snapshot.portraitMime,
            identityVisibility: snapshot.identityVisibility,
          },
        })
      : Promise.resolve(),
  ]);
  await prisma.$disconnect();
  const failedCleanup = cleanupResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failedCleanup) throw failedCleanup.reason;
});

test("un membre retrouve sa présentation, ses spécialités et son portrait", async ({
  context,
  page,
}) => {
  await loginAs(context, TARGET_ID);
  await page.goto(`/membres/${TARGET_ID}`);

  await expect(page.getByRole("heading", { name: targetDisplayName })).toBeVisible();
  await expect(page.getByText(PUBLIC_BIO, { exact: true })).toBeVisible();
  const specialties = page.getByRole("list", { name: "Spécialités" });
  await expect(specialties.getByText("Infiltration", { exact: true })).toBeVisible();
  await expect(specialties.getByText("Traque", { exact: true })).toBeVisible();

  const portrait = page.getByRole("img", { name: `Portrait de ${targetDisplayName}` });
  await expect(portrait).toHaveAttribute("src", `/api/membres/${TARGET_ID}/portrait`);
  await expect
    .poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
});

test("les pages groupe et classement mènent vers la fiche membre", async ({ context, page }) => {
  await loginAs(context, TARGET_ID);

  await page.goto(`/groupes/${targetGroupId}`);
  await expect(page.getByRole("heading", { name: new RegExp(targetGroupName) })).toBeVisible();
  await expect(page.getByRole("link", { name: targetDisplayName, exact: true })).toHaveAttribute(
    "href",
    `/membres/${TARGET_ID}`,
  );

  await page.goto("/classement");
  await page.getByRole("button", { name: /Agents/ }).click();
  await expect(page.getByRole("link", { name: targetDisplayName, exact: true })).toHaveAttribute(
    "href",
    `/membres/${TARGET_ID}`,
  );
});

test("un membre extérieur reçoit la fiche publique, jamais l’identité réelle", async ({
  context,
  page,
}) => {
  const readBodies = collectTextBodies(page);
  await loginAs(context, OUTSIDER_ID);
  await page.goto(`/membres/${TARGET_ID}`);

  await expect(page.getByRole("heading", { name: targetDisplayName })).toBeVisible();
  await expect(page.getByText(PUBLIC_BIO, { exact: true })).toBeVisible();
  await expect(page.getByText(/Aucune appartenance de groupe visible/)).toBeVisible();

  const html = await page.content();
  const bodies = await readBodies();
  for (const secret of [SECRET_FIRST_NAME, SECRET_LAST_NAME, `${SECRET_FIRST_NAME} ${SECRET_LAST_NAME}`]) {
    expect(html, `« ${secret} » ne doit pas être dans le DOM`).not.toContain(secret);
    for (const body of bodies) expect(body).not.toContain(secret);
  }
});

test("le mode Streamer ne rend ni biographie ni portrait sur les fiches membres", async ({
  context,
  page,
}) => {
  await loginAs(context, TARGET_ID);
  await setStreamerCookie(context);
  const readBodies = collectTextBodies(page);

  await page.goto(`/membres/${TARGET_ID}`);
  await expect(page.locator(`img[src="/api/membres/${TARGET_ID}/portrait"]`)).toHaveCount(0);
  await expect(page.getByText(PUBLIC_BIO, { exact: true })).toHaveCount(0);

  await page.goto(`/membres?q=${encodeURIComponent(targetDisplayName)}`);
  await expect(page.locator(`img[src="/api/membres/${TARGET_ID}/portrait"]`)).toHaveCount(0);
  await expect(page.getByText(PUBLIC_BIO, { exact: true })).toHaveCount(0);

  const html = await page.content();
  const bodies = await readBodies();
  for (const secret of [PUBLIC_BIO, `/api/membres/${TARGET_ID}/portrait`]) {
    expect(html).not.toContain(secret);
    for (const body of bodies) expect(body).not.toContain(secret);
  }
});
