import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Attribution multi-groupes : modale, effectifs, groupe principal, accès des
 * groupes assignés, refus du passage « en cours » sans équipe.
 */
test.describe.configure({ mode: "serial" });

let missionId = "";

async function resetMission() {
  await prisma.missionAssignment.deleteMany({ where: { missionId } });
  await prisma.missionClaim.updateMany({
    where: { missionId },
    data: { status: "WITHDRAWN" },
  });
  await prisma.mission.update({
    where: { id: missionId },
    data: { status: "AVAILABLE", assignedFactionId: null, assignedGroupId: null, assignedAt: null },
  });
}

test.beforeAll(async () => {
  const mission = await prisma.mission.findUniqueOrThrow({ where: { code: "TO-D-0001" } });
  missionId = mission.id;
  await resetMission();
});

test.afterAll(async () => {
  // Retour à l'état du seed, même si un run précédent s'est interrompu.
  await resetMission();
  await prisma.$disconnect();
});

test("le modérateur attribue la mission à DEUX groupes et la démarre", async ({
  context,
  page,
}) => {
  await loginAs(context, "demo-mod");
  await page.goto(`/missions/${missionId}`);
  await page.getByRole("button", { name: "Attribuer la mission" }).click();

  const dialog = page.getByRole("dialog", { name: /Attribuer la mission/ });
  await expect(dialog.getByText(/Constituer l/)).toBeVisible();

  // Ajout manuel de deux groupes depuis le catalogue
  const select = dialog.getByLabel("Ajouter un autre groupe");
  await select.selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  await select.selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();

  // Les cellules du seed comptent chacune 3 membres : 3 + 3 → total 6.
  const headcountInputs = dialog.locator("input[type=number]");
  await headcountInputs.nth(0).fill("3");
  await headcountInputs.nth(1).fill("3");
  await expect(dialog.getByText("Effectif total : 6")).toBeVisible();

  // Groupe principal : le premier
  await dialog.getByRole("radio").first().check();

  await dialog
    .getByRole("button", { name: "Confirmer l'attribution et démarrer la mission" })
    .click();
  await expect(dialog).toHaveCount(0);

  // Vérité en base : mission en cours, 2 attributions actives, 1 principal
  const mission = await prisma.mission.findUniqueOrThrow({
    where: { id: missionId },
    include: { assignments: { where: { active: true } } },
  });
  expect(mission.status).toBe("IN_PROGRESS");
  expect(mission.assignments).toHaveLength(2);
  expect(mission.assignments.reduce((s, a) => s + a.assignedHeadcount, 0)).toBe(6);
  expect(mission.assignments.filter((a) => a.isLeadGroup)).toHaveLength(1);
});

test("chaque groupe assigné voit l'équipe ; l'historique et l'audit existent", async ({
  context,
  page,
}) => {
  const assignments = await prisma.missionAssignment.findMany({
    where: { missionId, active: true },
  });
  const member = await prisma.groupMember.findFirstOrThrow({
    where: { groupId: assignments[0]!.groupId, user: { status: "ACTIVE", profileCompleted: true } },
  });

  await loginAs(context, member.userId);
  await page.goto(`/missions/${missionId}`);
  await expect(page.getByRole("heading", { name: /équipe assignée/i })).toBeVisible();
  await expect(page.getByText("Effectif total : 6")).toBeVisible();
  await expect(page.getByText("Groupe principal")).toBeVisible();

  const history = await prisma.missionStatusHistory.findFirst({
    where: { missionId, toStatus: "IN_PROGRESS" },
    orderBy: { createdAt: "desc" },
  });
  expect(history?.reason).toContain("2 groupe(s)");
  const auditEntry = await prisma.auditLog.findFirst({
    where: { action: "mission.assigned", resourceId: missionId },
    orderBy: { createdAt: "desc" },
  });
  expect(auditEntry).not.toBeNull();
});

test("un membre étranger aux groupes assignés ne voit pas l'équipe", async ({ context, page }) => {
  const assignments = await prisma.missionAssignment.findMany({
    where: { missionId, active: true },
    select: { groupId: true, factionId: true },
  });
  // demo-member-3-1-1 : Racines Grises, Cellule 2 — vérifions qu'il est étranger
  const outsider = "demo-member-3-1-1";
  const isInvolved = await prisma.groupMember.findFirst({
    where: { userId: outsider, groupId: { in: assignments.map((a) => a.groupId) } },
  });
  test.skip(isInvolved !== null, "le hasard du catalogue a sélectionné son groupe");

  await loginAs(context, outsider);
  await page.goto(`/missions/${missionId}`);
  await expect(page.getByRole("heading", { name: /équipe assignée/i })).toHaveCount(0);
});
