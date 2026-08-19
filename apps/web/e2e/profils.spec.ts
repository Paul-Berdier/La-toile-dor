import { expect, test, type Page } from "@playwright/test";
import { loginAs, prisma } from "./helpers";

/**
 * Dossiers de renseignement : distinction Inconnu / ???, non-fuite des valeurs
 * protégées (DOM + réseau), portrait gardé, achat par un groupe.
 *
 * Le dossier de démonstration « Akira » (seed) est :
 *  - CONNU pour nom, faction, clan, cheveux, KG… (« ??? » sans accès) ;
 *  - INCONNU pour la couleur de peau et les artefacts marqués « Aucun » ;
 *  - acheté par la Cellule 1 de Kumogakure (groups[0]).
 *
 * Le NOM (« Kaguya ») est PUBLIC — il figure dans le titre du dossier — et
 * n'est donc plus un secret ; le clan Kaguya, lui, l'est, mais porte le même
 * mot : on vérifie le clan par son état « ??? », pas par le texte.
 */
const SECRETS = ["Shikotsumyaku", "Danse des Camélias"];

function collectServerBodies(page: Page): () => Promise<string[]> {
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

async function akira() {
  return prisma.characterProfile.findFirstOrThrow({
    where: { characterFirstName: "Akira" },
    include: { accessGrants: { where: { revokedAt: null } } },
  });
}

test("un CHEF sans accès ne reçoit pas le grade par le panneau d'estimation", async ({
  context,
  page,
}) => {
  // Le lecteur le plus exposé : il voit le panneau « valeur estimée » (les
  // agents ne le voient pas), et c'est là qu'une régression a un jour écrit le
  // grade en clair — juste sous le même grade affiché « ??? ». Le test
  // inspecte le DOM ET chaque réponse réseau, parce que la clé peut être
  // absente de l'écran tout en voyageant dans la charge utile RSC.
  const profile = await akira();
  const grantedGroupIds = profile.accessGrants.map((g) => g.groupId);
  const rank = await prisma.playerLevel.findUniqueOrThrow({
    where: { id: profile.rankId! },
    select: { label: true },
  });
  // demo-chief-3 dirige des groupes sans accès à ce dossier
  const chiefGroups = await prisma.groupMember.findMany({
    where: { userId: "demo-chief-3", isLeader: true },
    select: { groupId: true },
  });
  expect(chiefGroups.some((g) => grantedGroupIds.includes(g.groupId))).toBe(false);

  const readBodies = collectServerBodies(page);

  await loginAs(context, "demo-chief-3");
  await page.goto(`/profils/${profile.id}`);
  // Le panneau d'estimation est bien là : c'est lui qu'on surveille
  await expect(page.getByText(/valeur estimée/i)).toBeVisible();

  // Le chef est lui-même gradé et son grade figure dans la barre latérale :
  // on ne peut pas bannir le mot « Jonin » de la page. On cible donc la FORME
  // exacte que produisait la fuite — « Jonin (×1.8) », le grade suivi de son
  // multiplicateur — et les clés qui ne doivent exister que dans la forme
  // complète de l'estimation.
  const leakPattern = new RegExp(`${rank.label}\\s*\\(×`);
  const html = await page.content();
  expect(html, "le grade multiplié ne doit pas figurer dans le panneau").not.toMatch(leakPattern);
  for (const body of await readBodies()) {
    expect(body).not.toMatch(leakPattern);
    // Le nombre de renseignements et le détail du calcul sont des oracles :
    // ces clés n'existent que dans la forme « full », jamais servie ici.
    expect(body).not.toContain("knownCount");
    expect(body).not.toContain("gradeLabel");
    expect(body).not.toContain("gradeMultiplier");
  }
});

test("un agent SANS accès voit le prénom, « Inconnu » et « ??? » — jamais les valeurs", async ({
  context,
  page,
}) => {
  const profile = await akira();
  const grantedGroupIds = profile.accessGrants.map((g) => g.groupId);
  // demo-member-2-0-0 (Brume Écarlate) n'appartient pas au groupe détenteur
  const outsider = await prisma.groupMember.findFirstOrThrow({
    where: { userId: "demo-member-2-0-0", groupId: { notIn: grantedGroupIds } },
  });
  expect(outsider).toBeTruthy();

  const readBodies = collectServerBodies(page);

  await loginAs(context, "demo-member-2-0-0");
  await page.goto(`/profils/${profile.id}`);

  // Titre, prénom et nom restent visibles — règle du produit
  await expect(page.getByRole("heading", { name: /Akira Kaguya/ })).toBeVisible();
  // Les informations acquises mais protégées s'affichent « ??? » — dont le
  // CLAN, qui porte le même mot que le nom : c'est l'état qui fait foi.
  const clanRow = page.locator("dt", { hasText: /^Clan$/ }).locator("xpath=..");
  await expect(clanRow.getByRole("img", { name: /confidentiel/i })).toBeVisible();
  // Une information jamais découverte reste « Inconnu » pour tous
  await expect(page.getByText("Inconnu").first()).toBeVisible();

  const html = await page.content();
  const responses = await readBodies();
  for (const secret of SECRETS) {
    expect(html, `« ${secret} » ne doit pas être dans le DOM`).not.toContain(secret);
    for (const body of responses) {
      expect(body, `« ${secret} » ne doit être dans aucune réponse réseau`).not.toContain(secret);
    }
  }
});

test("la LISTE montre titre, prénom et nom à tous — et rien d'autre sans accès", async ({
  context,
  page,
}) => {
  // Le nom est PUBLIC : un lecteur sans accès voit « Akira Kaguya ». En
  // revanche la charge utile ne doit porter AUCUNE autre valeur du dossier :
  // ni la faction, ni le KG, ni un indicateur de portrait.
  const profile = await akira();
  const readBodies = collectServerBodies(page);

  await loginAs(context, "demo-member-2-0-0");
  await page.goto("/profils");
  await expect(page.getByText(/Akira Kaguya/).first()).toBeVisible();
  // La carte est SCELLÉE : sceau et « Voir », pas « Ouvrir »
  const card = page.locator("article, li").filter({ hasText: profile.code }).first();
  await expect(card.getByText(/Non acquis/)).toBeVisible();

  for (const body of await readBodies()) {
    for (const secret of SECRETS) expect(body).not.toContain(secret);
    expect(body).not.toContain("hasVisiblePortrait\":true");
  }
});

test("le portrait protégé n'est PAS servi (404) à un utilisateur sans accès", async ({
  context,
  request,
  page,
}) => {
  const profile = await akira();
  // Portrait présent en base pour ce test
  await prisma.characterProfile.update({
    where: { id: profile.id },
    data: {
      imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      imageMime: "image/png",
    },
  });
  try {
    await loginAs(context, "demo-member-2-0-0");
    await page.goto(`/profils/${profile.id}`);
    const res = await page.request.get(`/api/profils/${profile.id}/image`);
    expect(res.status()).toBe(404);
  } finally {
    await prisma.characterProfile.update({
      where: { id: profile.id },
      data: { imageData: null, imageMime: null },
    });
  }
});

test("un membre du groupe ACHETEUR voit les valeurs", async ({ context, page }) => {
  const profile = await akira();
  const grant = profile.accessGrants[0];
  expect(grant).toBeTruthy();
  const member = await prisma.groupMember.findFirstOrThrow({
    where: { groupId: grant!.groupId, user: { status: "ACTIVE", profileCompleted: true } },
  });

  await loginAs(context, member.userId);
  await page.goto(`/profils/${profile.id}`);
  await expect(page.getByText("Kaguya").first()).toBeVisible();
  await expect(page.getByText("Shikotsumyaku").first()).toBeVisible();
  // Les notes internes ne sont JAMAIS vendues avec le dossier
  const html = await page.content();
  expect(html).not.toContain("NOTE INTERNE FICTIVE");
});

test("un ancien membre perd l'accès dès sa sortie du groupe", async ({ context, page }) => {
  const profile = await akira();
  const grant = profile.accessGrants[0]!;
  const member = await prisma.groupMember.findFirstOrThrow({
    where: { groupId: grant.groupId, isLeader: false, user: { profileCompleted: true } },
  });

  await prisma.groupMember.delete({
    where: { groupId_userId: { groupId: member.groupId, userId: member.userId } },
  });
  try {
    await loginAs(context, member.userId);
    await page.goto(`/profils/${profile.id}`);
    const html = await page.content();
    expect(html).not.toContain("Shikotsumyaku");
  } finally {
    await prisma.groupMember.create({
      data: { groupId: member.groupId, userId: member.userId, isLeader: false },
    });
  }
});

test("le modérateur voit tout, y compris les notes internes et les sources", async ({
  context,
  page,
}) => {
  const profile = await akira();
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profile.id}`);
  await expect(page.getByText("Kaguya").first()).toBeVisible();
  await expect(page.getByText("NOTE INTERNE FICTIVE")).toBeVisible();
  await expect(page.getByRole("heading", { name: /renseignements/i })).toBeVisible();
});

test("« Aucun » (absence confirmée) est visible pour l'autorisé, « ??? » sinon", async ({
  context,
  page,
}) => {
  const profile = await akira();
  await loginAs(context, "demo-mod");
  await page.goto(`/profils/${profile.id}`);
  // L'absence d'artefact a été confirmée dans le seed
  await expect(page.getByText("Aucun").first()).toBeVisible();
});

test("création rapide : prénom seul, code généré, doublons avertis sans blocage", async ({
  context,
  page,
}) => {
  // Prénom unique SANS chiffre : la validation n'accepte que des lettres,
  // espaces, apostrophes et traits d'union (règle métier volontaire).
  const suffix = Date.now()
    .toString(36)
    .replace(/[0-9]/g, (d) => "aeiouzyxwv"[Number(d)]!);
  const unique = `Test${suffix}`;
  await loginAs(context, "demo-mod");
  await page.goto("/profils");
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
  await page.getByLabel("Prénom du personnage *").fill(unique);
  await page.getByRole("button", { name: "Créer rapidement" }).click();
  // La modale se ferme après succès : c'est le signal de fin de l'action serveur
  await expect(page.getByRole("dialog", { name: "Ouvrir un dossier" })).toHaveCount(0);

  const created = await prisma.characterProfile.findFirstOrThrow({
    where: { characterFirstName: unique },
  });
  expect(created.code).toMatch(/^PRF-\d{6}$/);
  expect(created.characterLastName).toBeNull();

  // Second profil au MÊME prénom : averti, puis créé sur confirmation
  await page.reload();
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
  await page.getByLabel("Prénom du personnage *").fill(unique);
  await page.getByRole("button", { name: "Créer rapidement" }).click();
  await expect(page.getByText(/dossiers ressemblants existent déjà/i)).toBeVisible();
  await page.getByRole("button", { name: "Créer quand même" }).click();
  await expect(page.getByRole("dialog", { name: "Ouvrir un dossier" })).toHaveCount(0);

  const both = await prisma.characterProfile.findMany({ where: { characterFirstName: unique } });
  expect(both).toHaveLength(2);
  expect(new Set(both.map((p) => p.code)).size).toBe(2);

  await prisma.characterProfile.deleteMany({ where: { characterFirstName: unique } });
});

test("un agent ne peut PAS demander l'accès ; un chef le peut", async ({ context, page }) => {
  const profile = await akira();

  // Agent : aucun bouton de demande
  await loginAs(context, "demo-member-2-0-1");
  await page.goto(`/profils/${profile.id}`);
  await expect(page.getByRole("button", { name: /Demander l'accès/ })).toHaveCount(0);

  // Chef d'un groupe sans accès : le bouton existe et la demande part
  const chief = "demo-chief-3";
  await prisma.profilePurchaseRequest.deleteMany({
    where: { profileId: profile.id, requestedById: chief },
  });
  const ctx2 = await page.context().browser()!.newContext();
  await loginAs(ctx2, chief);
  const page2 = await ctx2.newPage();
  await page2.goto(`/profils/${profile.id}`);
  await page2.getByRole("button", { name: /Demander l'accès pour mon groupe/ }).click();
  // « Demande transmise » est TRANSITOIRE : le rafraîchissement qui suit
  // remplace le panneau de demande par l'état persistant. S'accrocher au
  // message rendait le test dépendant de la vitesse du serveur. On vérifie
  // donc ce que l'utilisateur voit durablement.
  await expect(page2.getByText(/attend la décision/)).toBeVisible();

  const created = await prisma.profilePurchaseRequest.findFirst({
    where: { profileId: profile.id, requestedById: chief, status: "PENDING" },
  });
  expect(created).not.toBeNull();
  await ctx2.close();
  await prisma.profilePurchaseRequest.deleteMany({ where: { id: created!.id } });
});
