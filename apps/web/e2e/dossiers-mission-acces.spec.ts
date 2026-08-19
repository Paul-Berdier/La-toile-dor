import { expect, test, type Page } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Accès aux dossiers par les MISSIONS : quand une mission a pour cible un
 * dossier existant, les groupes dont la revendication a été acceptée
 * (attribution active, mission ASSIGNED / IN_PROGRESS) lisent le dossier de
 * la cible pendant la mission — sans achat. L'attribution retirée, l'accès
 * disparaît. Les autres groupes ne voient jamais rien.
 *
 * Vérifie aussi que la recherche publique (/api/profils/recherche) ne renvoie
 * QUE les champs publics.
 */

function collectBodies(page: Page): () => Promise<string[]> {
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

test("le groupe attribué lit le dossier de la cible pendant la mission — plus après le retrait", async ({
  browser,
  context,
  page,
}) => {
  // Un agent (non chef) du groupe A ; le dossier appartient à la Toile
  const agent = "demo-member-0-0-0";
  const membership = await prisma.groupMember.findFirstOrThrow({
    where: { userId: agent, group: { isActive: true } },
    include: { group: true },
  });
  const group = membership.group;
  const jonin = await prisma.playerLevel.findFirstOrThrow({ where: { slug: "jonin" } });

  const profile = await prisma.characterProfile.create({
    data: {
      code: `ZZ-MT-${Date.now().toString(36).toUpperCase()}`,
      characterFirstName: "ZZCibleMission",
      firstNameNorm: "zzciblemission",
      title: "Dossier — ZZCibleMission",
      rankId: jonin.id,
      createdById: "demo-mod",
      fieldIntel: { create: [{ fieldKey: "rank", knowledgeState: "KNOWN", confidence: "CONFIRMED" }] },
    },
  });
  const mission = await prisma.mission.create({
    data: {
      code: `ZZ-MT-${Date.now().toString(36).toUpperCase()}`,
      publicTitle: "ZZ Accès cible",
      rank: "C",
      category: "TRAQUE",
      status: "IN_PROGRESS",
      rewardRyoMin: 1000,
      rewardRyoMax: 2000,
      basePoints: 10,
      assignedGroupId: group.id,
      creatorId: "demo-mod",
      targets: { create: { profileId: profile.id } },
    },
  });
  const assignment = await prisma.missionAssignment.create({
    data: {
      missionId: mission.id,
      groupId: group.id,
      factionId: group.factionId,
      assignedById: "demo-mod",
      active: true,
      isLeadGroup: true,
      assignedHeadcount: 1,
    },
  });

  try {
    // ── Pendant la mission : l'agent du groupe attribué LIT le dossier ──
    await loginAs(context, agent);
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByText(/Mission en cours/i).first()).toBeVisible();
    // La valeur du grade est réellement servie (pas un « ??? »)
    await expect(page.getByText(jonin.label).first()).toBeVisible();

    // La liste le range parmi les dossiers accessibles, avec la raison
    await page.goto("/profils");
    const card = page.locator("li").filter({ hasText: profile.code }).first();
    await expect(card.getByText(/Mission en cours/i)).toBeVisible();
    await expect(card.getByText(/Ouvrir le dossier/)).toBeVisible();

    // ── Un membre d'un AUTRE groupe ne voit rien ──
    const otherCtx = await browser.newContext();
    await loginAs(otherCtx, "demo-member-2-0-0");
    const other = await otherCtx.newPage();
    const readBodies = collectBodies(other);
    await other.goto(`/profils/${profile.id}`);
    await expect(other.getByText(/Non acquis/).first()).toBeVisible();
    const html = await other.content();
    expect(html).not.toContain(jonin.label);
    for (const body of await readBodies()) {
      expect(body, "le grade ne doit pas fuir vers un groupe non attribué").not.toContain(jonin.label);
    }
    await otherCtx.close();

    // ── Attribution retirée : l'accès disparaît avec elle ──
    await prisma.missionAssignment.update({
      where: { id: assignment.id },
      data: { active: false, releasedAt: new Date(), releasedReason: "test" },
    });
    const sealedCtx = await browser.newContext();
    await loginAs(sealedCtx, agent);
    const sealed = await sealedCtx.newPage();
    const readSealedBodies = collectBodies(sealed);
    await sealed.goto(`/profils/${profile.id}`);
    await expect(sealed.getByText(/Non acquis/).first()).toBeVisible();
    expect(await sealed.content()).not.toContain(jonin.label);
    for (const body of await readSealedBodies()) {
      expect(body, "le grade ne doit plus être servi après le retrait").not.toContain(jonin.label);
    }
    await sealedCtx.close();
  } finally {
    await prisma.mission.delete({ where: { id: mission.id } }).catch(() => {});
    await prisma.characterProfile.delete({ where: { id: profile.id } }).catch(() => {});
  }
});

test("la recherche publique ne renvoie que code, titre, prénom, nom", async ({ context, page }) => {
  await loginAs(context, "demo-member-2-0-0");
  // Une page quelconque pour porter le cookie, puis l'appel API direct
  await page.goto("/profils");
  const res = await page.request.get("/api/profils/recherche?q=Akira");
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as Record<string, unknown>[];
  expect(rows.length).toBeGreaterThan(0);
  const allowed = ["id", "code", "title", "firstName", "lastName"].sort();
  for (const row of rows) {
    expect(Object.keys(row).sort(), "aucune clé au-delà des champs publics").toEqual(allowed);
  }
  const body = JSON.stringify(rows);
  // Valeurs du dossier Akira du seed — jamais dans la recherche
  for (const secret of ["Shikotsumyaku", "Suiton", "Jonin", "Kumogakure"]) {
    expect(body).not.toContain(secret);
  }
});
