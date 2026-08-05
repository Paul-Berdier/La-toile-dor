import { expect, test } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Attribution multi-groupes : modale, effectifs, groupe principal, accès des
 * groupes assignés, refus du passage « en cours » sans équipe.
 */
test.describe.configure({ mode: "serial" });

let missionId = "";

async function resetMission() {
  await prisma.missionParticipant.deleteMany({ where: { missionId } });
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

  // Deux groupes d'une MÊME faction : ils partagent leur chef, et c'est
  // précisément le cas que ce test couvre. On les désigne par leur identifiant
  // plutôt que par leur rang dans la liste — l'ordre du catalogue n'est pas un
  // contrat, et s'y fier rendait le test dépendant du nom des groupes.
  const faction = await prisma.faction.findFirstOrThrow({
    where: { isActive: true, groups: { some: { isActive: true } } },
    include: { groups: { where: { isActive: true }, orderBy: { name: "asc" }, take: 2 } },
  });
  expect(faction.groups).toHaveLength(2);
  const select = dialog.getByLabel("Ajouter un autre groupe");
  for (const group of faction.groups) {
    await select.selectOption(group.id);
    await dialog.getByRole("button", { name: "Ajouter", exact: true }).click();
  }

  // Les deux groupes comptent 3 membres chacun, MAIS leur chef appartient
  // aux deux : un agent ne peut représenter qu'un seul groupe. On engage donc
  // les 3 agents du premier groupe et les 2 autres du second → 5.
  const agentCheckboxes = dialog.locator("fieldset input[type=checkbox]");
  expect(await agentCheckboxes.count()).toBe(6);
  const boxes = await agentCheckboxes.all();
  for (const [index, checkbox] of boxes.entries()) {
    if (index === 3) continue; // le chef, déjà engagé via la première cellule
    await checkbox.check();
  }
  await expect(dialog.getByText("Effectif total : 5")).toBeVisible();

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
  expect(mission.assignments.reduce((sum, a) => sum + a.assignedHeadcount, 0)).toBe(5);
  expect(mission.assignments.filter((a) => a.isLeadGroup)).toHaveLength(1);
  expect(await prisma.missionParticipant.count({ where: { missionId } })).toBe(5);
});

test("chaque groupe assigné voit l'équipe ; l'historique et l'audit existent", async ({
  context,
  page,
}) => {
  const assignments = await prisma.missionAssignment.findMany({
    where: { missionId, active: true },
  });
  // Le CHEF, explicitement : il dirige les deux groupes engagés et voit donc
  // l'équipe entière. Un simple agent ne voit que son propre groupe — c'est le
  // comportement voulu, mais ce n'est pas ce que ce test vérifie. S'en remettre
  // à l'ordre implicite de `findFirst` faisait dépendre le résultat de l'ordre
  // de création des membres.
  const member = await prisma.groupMember.findFirstOrThrow({
    where: {
      groupId: assignments[0]!.groupId,
      isLeader: true,
      user: { status: "ACTIVE", profileCompleted: true },
    },
  });

  await loginAs(context, member.userId);
  await page.goto(`/missions/${missionId}`);
  await expect(page.getByRole("heading", { name: /équipe assignée/i })).toBeVisible();
  await expect(page.getByText("Effectif total : 5")).toBeVisible();
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
