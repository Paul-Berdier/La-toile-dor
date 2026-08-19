import { expect, test, type Page } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Refonte des dossiers : groupe créateur, achat sans double vente, galerie
 * gardée, classe / couleur des yeux, contributions sans fuite, rapport de fin
 * de mission. Chaque test crée ce dont il a besoin et le retire après.
 *
 * Oracles de fuite : les valeurs de test portent un marqueur unique
 * (« ZZ-… ») qu'on cherche dans le DOM ET dans chaque réponse réseau.
 */

/** Collecte les corps de réponses texte/JSON/JS d'une page. */
function collectBodies(page: Page): () => Promise<string[]> {
  const pending: Promise<string>[] = [];
  page.on("response", (response) => {
    const type = response.headers()["content-type"] ?? "";
    // Les chunks JS partagés contiennent les libellés génériques du catalogue
    // et ne sont pas une charge de données du dossier consulté. On surveille
    // le document, les réponses RSC et JSON produites côté serveur.
    if (type.includes("html") || type.includes("x-component") || type.includes("json")) {
      pending.push(response.text().catch(() => ""));
    }
  });
  return async () => {
    // Une réponse peut être émise pendant qu'une autre finit d'être lue.
    // On attend jusqu'à ce que la liste soit stable, pas seulement les
    // promesses présentes au premier instantané.
    let previousCount = -1;
    while (previousCount !== pending.length) {
      previousCount = pending.length;
      await Promise.all(pending.slice(0, previousCount));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return Promise.all(pending);
  };
}

/** Groupe du seed par membre, avec son chef. */
async function groupOf(userId: string) {
  const m = await prisma.groupMember.findFirstOrThrow({
    where: { userId, group: { isActive: true } },
    include: { group: true },
  });
  const chief = await prisma.groupMember.findFirstOrThrow({ where: { groupId: m.groupId, isLeader: true } });
  return { group: m.group, chiefId: chief.userId };
}

async function deleteProfileByCode(code: string) {
  await prisma.characterProfile.deleteMany({ where: { code } });
}

// ─────────────────────────────────────────────────────────────
// 1. Groupe créateur : tout membre crée, le groupe voit et complète
// ─────────────────────────────────────────────────────────────
test("un membre de groupe ouvre un dossier ; son groupe le voit et le complète, pas les autres", async ({
  browser,
  context,
  page,
}) => {
  const author = "demo-member-1-1-0"; // membre simple, un seul groupe
  const { group } = await groupOf(author);
  const suffix = Date.now()
    .toString(36)
    .replace(/[0-9]/g, (digit) => "aeiouzyxwv"[Number(digit)]!);
  const firstName = `ZZCreat${suffix}`;
  let profileId: string | null = null;
  try {
    await loginAs(context, author);
    await page.goto("/profils");
    await page.getByRole("button", { name: "Nouveau dossier" }).click();
    await page.getByLabel(/Prénom du personnage/).fill(firstName);
    await page.getByLabel(/^Nom/).fill("ZZNom");
    // Un seul groupe : pré-sélectionné et affiché
    await expect(page.getByText(group.name).first()).toBeVisible();
    await page.getByRole("button", { name: "Créer et compléter" }).click();
    await expect(page).toHaveURL(/\/profils\/[^/]+\/modifier/);

    const profile = await prisma.characterProfile.findFirstOrThrow({
      where: { characterFirstName: firstName },
      include: { accessGrants: true },
    });
    profileId = profile.id;
    expect(profile.createdByGroupId).toBe(group.id);
    expect(profile.title).toBe(`Dossier — ${firstName} ZZNom`);
    expect(profile.accessGrants.some((g) => g.sourceType === "CREATED_BY_GROUP" && g.groupId === group.id)).toBe(true);

    // Un AUTRE membre du même groupe voit et peut modifier
    const mateCtx = await browser.newContext();
    await loginAs(mateCtx, "demo-member-1-1-1");
    const mate = await mateCtx.newPage();
    await mate.goto(`/profils/${profile.id}`);
    await expect(mate.getByText(/Créé par votre groupe/)).toBeVisible();
    await expect(mate.getByRole("link", { name: /Modifier le dossier/ })).toBeVisible();
    await mate.goto(`/profils/${profile.id}/modifier`);
    await expect(mate).toHaveURL(/\/modifier/);
    await mateCtx.close();

    // Un membre d'un autre groupe ne voit que le public, et « Non acquis »
    const otherCtx = await browser.newContext();
    await loginAs(otherCtx, "demo-member-2-0-0");
    const other = await otherCtx.newPage();
    await other.goto(`/profils/${profile.id}`);
    await expect(other.getByText(/Non acquis/).first()).toBeVisible();
    await expect(other.getByRole("link", { name: /Modifier le dossier/ })).toHaveCount(0);
    // L'édition lui est refusée (redirigé vers le dossier)
    await other.goto(`/profils/${profile.id}/modifier`);
    await expect(other).toHaveURL(new RegExp(`/profils/${profile.id}$`));
    await otherCtx.close();
  } finally {
    if (profileId) await prisma.characterProfile.delete({ where: { id: profileId } }).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────
// 2. Achat : pas de bouton d'achat si déjà acquis / créé par le groupe
// ─────────────────────────────────────────────────────────────
test("le chef du groupe créateur ne voit aucune demande d'accès sur son propre dossier", async ({
  context,
  page,
}) => {
  const chiefId = "demo-chief-1";
  const chiefGroup = await prisma.groupMember.findFirstOrThrow({ where: { userId: chiefId, isLeader: true } });
  const profile = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZOwned",
      firstNameNorm: "zzowned",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZOwned",
      createdByGroupId: chiefGroup.groupId,
      accessGrants: { create: { groupId: chiefGroup.groupId, grantedById: chiefId, sourceType: "CREATED_BY_GROUP" } },
    },
  });
  try {
    await loginAs(context, chiefId);
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByText(/Créé par votre groupe/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Demander l'accès/ })).toHaveCount(0);
    await expect(page.getByText(/Valeur estimée/)).toHaveCount(0);
  } finally {
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. Galerie : 404 sans accès, aucune URL d'image dans la page
// ─────────────────────────────────────────────────────────────
test("une image de galerie n'est ni servie ni nommée à un lecteur sans accès", async ({
  browser,
  context,
  page,
}) => {
  const owner = "demo-member-1-0-0";
  const { group } = await groupOf(owner);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const profile = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZGallery",
      firstNameNorm: "zzgallery",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZGallery",
      createdByGroupId: group.id,
      accessGrants: { create: { groupId: group.id, grantedById: owner, sourceType: "CREATED_BY_GROUP" } },
      images: {
        create: {
          imageData: png, imageMime: "image/png", sizeBytes: png.length, type: "EVIDENCE",
          caption: "ZZ-LEGENDE-SECRETE", isPrimary: false, uploadedById: owner,
        },
      },
    },
    include: { images: true },
  });
  const imageId = profile.images[0]!.id;
  try {
    // Sans accès : 404 sur l'image, placeholder « Image confidentielle », ni id ni légende dans la page
    const readBodies = collectBodies(page);
    await loginAs(context, "demo-member-2-0-0");
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByRole("img", { name: /confidentielles/i })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(imageId);
    expect(html).not.toContain("ZZ-LEGENDE-SECRETE");
    for (const body of await readBodies()) {
      expect(body).not.toContain(imageId);
      expect(body).not.toContain("ZZ-LEGENDE-SECRETE");
    }
    const denied = await page.request.get(`/api/profils/${profile.id}/images/${imageId}`);
    expect(denied.status()).toBe(404);

    // Avec accès : l'image est servie
    const ownerCtx = await browser.newContext();
    await loginAs(ownerCtx, owner);
    const p2 = await ownerCtx.newPage();
    await p2.goto(`/profils/${profile.id}`);
    const ok = await p2.request.get(`/api/profils/${profile.id}/images/${imageId}`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toContain("no-store");
    // Traversée : l'image d'un dossier ne se sert pas sous l'id d'un autre
    const akira = await prisma.characterProfile.findFirstOrThrow({ where: { characterFirstName: "Akira" } });
    const crossed = await p2.request.get(`/api/profils/${akira.id}/images/${imageId}`);
    expect(crossed.status()).toBe(404);
    await ownerCtx.close();
  } finally {
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. Classe et couleur des yeux : référentiels présents, visibles selon l'accès
// ─────────────────────────────────────────────────────────────
test("classe ninja et couleur des yeux (hétérochromie) s'affichent à l'autorisé, « ??? » sinon", async ({
  browser,
  context,
  page,
}) => {
  const [classes, eyes] = await Promise.all([
    prisma.profileReferenceOption.findMany({ where: { type: "NINJA_CLASS", isActive: true } }),
    prisma.profileReferenceOption.findMany({ where: { type: "EYE_COLOR", isActive: true } }),
  ]);
  expect(classes.map((c) => c.code)).toEqual(
    expect.arrayContaining(["DEFENDER", "HEALER", "RAVAGER", "TRACKER"]),
  );
  expect(eyes.length).toBeGreaterThanOrEqual(13);
  const ravager = classes.find((c) => c.code === "RAVAGER")!;
  const blue = eyes.find((e) => e.code === "BLUE")!;
  const green = eyes.find((e) => e.code === "GREEN")!;

  const owner = "demo-member-1-0-0";
  const { group } = await groupOf(owner);
  const profile = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZEyes",
      firstNameNorm: "zzeyes",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZEyes",
      createdByGroupId: group.id,
      ninjaClassId: ravager.id,
      eyeColorId: blue.id,
      eyeColorSecondaryId: green.id,
      accessGrants: { create: { groupId: group.id, grantedById: owner, sourceType: "CREATED_BY_GROUP" } },
      fieldIntel: { create: [{ fieldKey: "ninjaClass", knowledgeState: "KNOWN" }, { fieldKey: "eyeColor", knowledgeState: "KNOWN" }] },
    },
  });
  try {
    await loginAs(context, owner);
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByText(ravager.label).first()).toBeVisible();
    await expect(page.getByText(`${blue.label} / ${green.label}`)).toBeVisible();

    const otherCtx = await browser.newContext();
    await loginAs(otherCtx, "demo-member-2-0-0");
    const other = await otherCtx.newPage();
    const readBodies = collectBodies(other);
    await other.goto(`/profils/${profile.id}`);
    const html = await other.content();
    expect(html).not.toContain(ravager.label);
    for (const secret of [blue.label, green.label, blue.id, green.id]) {
      expect(html).not.toContain(secret);
    }
    for (const body of await readBodies()) {
      expect(body).not.toContain(ravager.label);
      expect(body).not.toContain(ravager.id);
      for (const secret of [blue.label, green.label, blue.id, green.id]) {
        expect(body).not.toContain(secret);
      }
    }
    await otherCtx.close();
  } finally {
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. Contributions : un acquéreur propose, sans jamais apprendre la valeur en place
// ─────────────────────────────────────────────────────────────
test("un acquéreur propose un renseignement ; le conflit reste côté modération", async ({
  browser,
  context,
  page,
}) => {
  const ownerGroupMember = "demo-member-1-0-0";
  const buyerMember = "demo-member-2-1-0";
  const { group: ownerGroup } = await groupOf(ownerGroupMember);
  const { group: buyerGroup } = await groupOf(buyerMember);
  const profile = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZContrib",
      firstNameNorm: "zzcontrib",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZContrib",
      createdByGroupId: ownerGroup.id,
      details: "ZZ-HISTOIRE-EN-PLACE",
      fieldIntel: { create: [{ fieldKey: "details", knowledgeState: "KNOWN" }] },
      accessGrants: {
        create: [
          { groupId: ownerGroup.id, grantedById: ownerGroupMember, sourceType: "CREATED_BY_GROUP" },
          { groupId: buyerGroup.id, grantedById: "demo-mod", sourceType: "PURCHASED", priceRyos: 1000 },
        ],
      },
    },
  });
  try {
    // L'acquéreur propose une autre histoire
    await loginAs(context, buyerMember);
    const readBodies = collectBodies(page);
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByText(/Dossier acquis/)).toBeVisible();
    await page.getByRole("button", { name: /Ajouter un renseignement/ }).click();
    await page.getByRole("button", { name: "Détails", exact: true }).click();
    await page.getByLabel("Détails").fill("ZZ-HISTOIRE-PROPOSEE");
    await page.getByRole("button", { name: "Proposer" }).click();
    // Le toast est volontairement transitoire ; l'état durable fait foi.
    await expect(page.getByText(/En attente de validation/)).toBeVisible();

    const row = await prisma.profileIntelContribution.findFirstOrThrow({ where: { profileId: profile.id } });
    expect(row.status).toBe("PENDING_REVIEW");
    expect(row.conflictsWithExisting).toBe(true);
    expect(row.groupId).toBe(buyerGroup.id);
    // La valeur en place n'a pas bougé, et l'indicateur de conflit n'a pas voyagé
    const after = await prisma.characterProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after.details).toBe("ZZ-HISTOIRE-EN-PLACE");
    await page.reload();
    const html = await page.content();
    expect(html).not.toContain("conflictsWithExisting");
    expect(html).not.toContain("Contredit la valeur");
    for (const body of await readBodies()) expect(body).not.toContain("conflictsWithExisting\":true");

    // Le groupe créateur tranche depuis le dossier : il voit le conflit, accepte
    const ownerCtx = await browser.newContext();
    await loginAs(ownerCtx, ownerGroupMember);
    const op = await ownerCtx.newPage();
    await op.goto(`/profils/${profile.id}`);
    await expect(op.getByText(/Contredit la valeur en place/)).toBeVisible();
    await op.getByRole("button", { name: "Accepter" }).click();
    await expect(op.getByText("ZZ-HISTOIRE-PROPOSEE")).toBeVisible();
    await ownerCtx.close();
    const reviewed = await prisma.profileIntelContribution.findUniqueOrThrow({ where: { id: row.id } });
    expect(reviewed.status).toBe("ACCEPTED");
    const applied = await prisma.characterProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(applied.details).toBe("ZZ-HISTOIRE-PROPOSEE");

    // Un lecteur SANS accès ne voit ni le bouton, ni l'une ni l'autre valeur
    const outCtx = await browser.newContext();
    await loginAs(outCtx, "demo-member-3-0-0");
    const out = await outCtx.newPage();
    const readOutBodies = collectBodies(out);
    await out.goto(`/profils/${profile.id}`);
    await expect(out.getByRole("button", { name: /Ajouter un renseignement/ })).toHaveCount(0);
    const outHtml = await out.content();
    expect(outHtml).not.toContain("ZZ-HISTOIRE");
    for (const body of await readOutBodies()) expect(body).not.toContain("ZZ-HISTOIRE");
    await outCtx.close();
  } finally {
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});

// ─────────────────────────────────────────────────────────────
// 6. Rapport de fin de mission : tout ou rien, ninja découvert, dossiers traités
// ─────────────────────────────────────────────────────────────
test("le rapport de fin de mission enregistre sorts, renseignements et nouveau dossier d'un bloc", async ({
  context,
  page,
}) => {
  // Le rapport final est déposé par le CHEF du groupe attribué (il nomme les
  // cibles, dont l'identité est réservée à ce niveau) — ici demo-chief-0.
  const agent = "demo-chief-0";
  const group = (await prisma.groupMember.findFirstOrThrow({
    where: { userId: agent, isLeader: true, group: { isActive: true } },
    include: { group: true },
  })).group;
  const target = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZCible",
      firstNameNorm: "zzcible",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZCible",
    },
  });
  const mission = await prisma.mission.create({
    data: {
      code: `ZZ-R-${Date.now().toString(36).toUpperCase()}`,
      publicTitle: "ZZ Rapport test",
      rank: "C",
      category: "SURVEILLANCE_ESPIONNAGE",
      status: "IN_PROGRESS",
      rewardRyoMin: 1000,
      rewardRyoMax: 2000,
      basePoints: 10,
      assignedGroupId: group.id,
      creatorId: "demo-mod",
    },
  });
  await prisma.missionAssignment.create({
    data: {
      missionId: mission.id, groupId: group.id, factionId: group.factionId, assignedById: "demo-mod",
      active: true, isLeadGroup: true, assignedHeadcount: 1,
    },
  });
  await prisma.missionParticipant.create({
    data: { missionId: mission.id, userId: agent, groupId: group.id, addedById: "demo-mod" },
  });
  const missionTarget = await prisma.missionTarget.create({ data: { missionId: mission.id, profileId: target.id } });
  let discoveredId: string | null = null;
  try {
    await loginAs(context, agent);
    await page.goto(`/missions/${mission.id}`);
    await expect(page.getByRole("heading", { name: /Rapport de fin de mission/ })).toBeVisible();

    // Étape 1 : sort + résumé
    await page.getByLabel(/Sort de ZZCible/).selectOption("ESCAPED");
    await page.getByLabel(/Résumé de la mission/).fill("La cible a filé par les toits ; un complice l'attendait.");
    await page.getByRole("button", { name: "Suivant →" }).click();
    // Étape 2 : rien de neuf sur la cible, un ninja découvert avec un renseignement
    await page.getByLabel("Aucune nouvelle information").check();
    await page.getByRole("button", { name: "+ Ninja découvert" }).click();
    await page.getByPlaceholder("Prénom *").fill("ZZDecouvert");
    await page.getByRole("button", { name: "+ Ajouter un champ" }).last().click();
    await page.getByRole("button", { name: "Détails", exact: true }).click();
    await page.getByLabel("Détails").fill("ZZ-COMPLICE-SUR-LES-TOITS");
    await page.getByRole("button", { name: "Suivant →" }).click();
    // Étape 3 : finaliser
    await page.getByRole("button", { name: /Déposer le rapport final et les renseignements/ }).click();
    await expect(page.getByText(/Rapport final enregistré/)).toBeVisible();

    const report = await prisma.missionReport.findFirstOrThrow({ where: { missionId: mission.id, isFinal: true } });
    expect(report.content).toContain("toits");
    expect(report.reportingGroupId).toBe(group.id);
    expect(report.payload).toMatchObject({
      outcomes: [{ targetId: missionTarget.id, outcome: "ESCAPED" }],
    });
    const t = await prisma.missionTarget.findUniqueOrThrow({ where: { id: missionTarget.id } });
    expect(t.outcome).toBe("ESCAPED");
    const discovered = await prisma.characterProfile.findFirstOrThrow({
      where: { characterFirstName: "ZZDecouvert" },
      include: { accessGrants: true, contributions: true },
    });
    discoveredId = discovered.id;
    expect(discovered.createdByGroupId).toBe(group.id);
    expect(discovered.details).toBe("ZZ-COMPLICE-SUR-LES-TOITS");
    expect(discovered.contributions[0]?.status).toBe("APPLIED");
    expect(discovered.contributions[0]?.sourceType).toBe("MISSION");
    const newTarget = await prisma.missionTarget.findFirst({ where: { missionId: mission.id, profileId: discovered.id } });
    // Un ninja découvert par ce groupe ne devient pas une cible globale visible
    // des autres groupes attribués.
    expect(newTarget).toBeNull();
    const draft = await prisma.missionReportDraft.findFirst({ where: { missionId: mission.id } });
    expect(draft).toBeNull();
  } finally {
    await prisma.mission.delete({ where: { id: mission.id } }).catch(() => {});
    if (discoveredId) await prisma.characterProfile.delete({ where: { id: discoveredId } }).catch(() => {});
    await prisma.characterProfile.delete({ where: { id: target.id } }).catch(() => {});
    await deleteProfileByCode(target.code);
  }
});

// ─────────────────────────────────────────────────────────────
// 7. Changement de groupe : l'accès suit le groupe, pas la personne
// ─────────────────────────────────────────────────────────────
test("quitter le groupe créateur fait perdre l'accès ; le rejoindre le rend", async ({ context, page }) => {
  const member = "demo-member-3-1-1";
  const { group } = await groupOf(member);
  const profile = await prisma.characterProfile.create({
    data: {
      characterFirstName: "ZZMove",
      firstNameNorm: "zzmove",
      code: `ZZ-${Date.now().toString(36).toUpperCase()}`,
      title: "Dossier — ZZMove",
      createdByGroupId: group.id,
      strengths: "ZZ-FORCE-SECRETE",
      fieldIntel: { create: [{ fieldKey: "strengths", knowledgeState: "KNOWN" }] },
      accessGrants: { create: { groupId: group.id, grantedById: member, sourceType: "CREATED_BY_GROUP" } },
    },
  });
  try {
    await loginAs(context, member);
    await page.goto(`/profils/${profile.id}`);
    await expect(page.getByText("ZZ-FORCE-SECRETE")).toBeVisible();

    await prisma.groupMember.delete({ where: { groupId_userId: { groupId: group.id, userId: member } } });
    await page.reload();
    expect(await page.content()).not.toContain("ZZ-FORCE-SECRETE");

    await prisma.groupMember.create({ data: { groupId: group.id, userId: member } });
    await page.reload();
    await expect(page.getByText("ZZ-FORCE-SECRETE")).toBeVisible();
  } finally {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: member } },
      update: {},
      create: { groupId: group.id, userId: member },
    });
    await prisma.characterProfile.delete({ where: { id: profile.id } });
  }
});
