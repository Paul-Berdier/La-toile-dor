/**
 * Seed de démonstration — TOUTES les données sont FICTIVES et limitées au
 * cadre du jeu de rôle. Aucune donnée réelle ne doit figurer ici.
 *
 * Crée aussi, si aucune invitation n'existe, une invitation super_admin
 * initiale dont le jeton clair est affiché UNE SEULE FOIS en console.
 */
import { createHash, randomBytes } from "node:crypto";
import { seedProfileReferences } from "./seed-profile-references";
import { PrismaClient, MissionRank, MissionCategory } from "../generated/client";

const prisma = new PrismaClient();

// ── Référentiels (mêmes valeurs que @toile/shared, dupliquées ici pour
//    garder le seed autonome vis-à-vis du build) ──

const PERMISSION_DEFS: [string, string][] = [
  ["mission.create", "Créer une mission"],
  ["mission.update", "Modifier une mission"],
  ["mission.cancel", "Annuler une mission"],
  ["mission.move", "Déplacer une mission entre les colonnes"],
  ["mission.assign", "Attribuer une mission à un groupe"],
  ["mission.view.all", "Consulter toutes les missions"],
  ["mission.view.confidential", "Consulter les informations confidentielles"],
  ["mission.claim", "Réclamer une mission"],
  ["mission.report.submit", "Soumettre un rapport de mission"],
  ["claim.review", "Accepter ou refuser une revendication"],
  ["invite.create", "Tendre un fil selon sa position dans la hiérarchie"],
  ["group.create", "Créer un groupe"],
  ["group.edit.any", "Modifier n'importe quel groupe"],
  ["identity.view.real", "Consulter les identités réelles (prénom/nom)"],
  ["profile.manage", "Créer et modifier les dossiers de renseignement"],
  ["profile.intel.view", "Voir toutes les valeurs, sources et historiques des dossiers"],
  ["profile.purchase.review", "Traiter les demandes d'accès aux dossiers"],
  ["profile.request.create", "Demander l'accès à un dossier pour son groupe"],
  ["profile.reference.manage", "Gérer les référentiels des dossiers"],
  ["profile.merge", "Fusionner ou archiver des dossiers"],
  ["points.adjust", "Modifier les points"],
  ["leaderboard.view", "Consulter le classement"],
  ["group.manage", "Gérer les groupes de sa faction"],
  ["invite.manage", "Gérer les invitations"],
  ["faction.manage", "Gérer les factions"],
  ["user.manage", "Gérer les utilisateurs"],
  ["moderator.manage", "Gérer les modérateurs"],
  ["settings.manage", "Modifier les paramètres"],
  ["audit.read", "Consulter les journaux d'audit"],
  ["access.revoke", "Révoquer des accès"],
];

const ROLE_PERMS: Record<string, { name: string; perms: string[] | "all" }> = {
  super_admin: { name: "Super administrateur", perms: "all" },
  moderator: {
    name: "Modérateur",
    perms: [
      "invite.create", "group.create", "group.edit.any", "identity.view.real",
      "profile.manage", "profile.intel.view", "profile.purchase.review",
      "mission.create", "mission.update", "mission.cancel", "mission.move",
      "mission.assign", "mission.view.all", "mission.view.confidential",
      "claim.review", "points.adjust", "leaderboard.view", "audit.read",
    ],
  },
  group_leader: {
    name: "Chef de groupe",
    perms: ["invite.create", "profile.request.create", "mission.claim", "mission.report.submit", "group.manage", "leaderboard.view"],
  },
  group_member: { name: "Membre de groupe", perms: ["leaderboard.view"] },
};

const LEVELS = [
  ["genin_apprenti", "Genin apprenti"], ["genin_simple", "Genin simple"],
  ["genin_confirme", "Genin confirmé"], ["chunin", "Chunin"], ["konin", "Konin"],
  ["tokubetsu_jonin", "Tokubetsu Jonin"], ["jonin", "Jonin"],
  ["commandant_jonin", "Commandant Jonin"], ["kage", "Kage"], ["sanin", "Sanin"],
] as const;

const RANKS: {
  rank: MissionRank; symbol: string; colorToken: string; danger: number;
  min: number; max: number; points: number; level: string; size: number;
}[] = [
  { rank: "D", symbol: "丁", colorToken: "rank-d", danger: 1, min: 5_000, max: 50_000, points: 10, level: "genin_apprenti", size: 2 },
  { rank: "C", symbol: "丙", colorToken: "rank-c", danger: 2, min: 30_000, max: 100_000, points: 25, level: "genin_confirme", size: 3 },
  { rank: "B", symbol: "乙", colorToken: "rank-b", danger: 3, min: 80_000, max: 250_000, points: 60, level: "chunin", size: 3 },
  { rank: "A", symbol: "甲", colorToken: "rank-a", danger: 4, min: 150_000, max: 1_000_000, points: 140, level: "jonin", size: 4 },
  { rank: "S", symbol: "極", colorToken: "rank-s", danger: 5, min: 1_000_000, max: 5_000_000, points: 300, level: "commandant_jonin", size: 4 },
  { rank: "SS", symbol: "禁", colorToken: "rank-ss", danger: 6, min: 5_000_000, max: 20_000_000, points: 700, level: "kage", size: 5 },
];

// SEED_DEMO=0 (production) : uniquement les référentiels (permissions, rôles,
// niveaux, rangs, réglages) + les invitations initiales — AUCUNE donnée fictive.
const seedDemo = process.env.SEED_DEMO !== "0";

async function main() {
  console.log(
    seedDemo
      ? "— Seed La Toile d'Or (référentiels + démonstration fictive) —"
      : "— Seed La Toile d'Or (référentiels seuls, mode production) —",
  );

  // Permissions et rôles
  for (const [key, description] of PERMISSION_DEFS) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }
  const allPerms = await prisma.permission.findMany();
  for (const [slug, def] of Object.entries(ROLE_PERMS)) {
    const role = await prisma.role.upsert({
      where: { slug },
      update: { name: def.name },
      create: { slug, name: def.name, isSystem: true },
    });
    const keys = def.perms === "all" ? allPerms.map((p) => p.key) : def.perms;
    const wantedIds: string[] = [];
    for (const key of keys) {
      const perm = allPerms.find((p) => p.key === key);
      if (!perm) continue;
      wantedIds.push(perm.id);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
    // Convergence : une base ayant connu d'anciennes listes perd les
    // permissions retirées — sinon un rôle système garde à vie des droits
    // périmés (ex. un chef de groupe qui modifierait des missions).
    const pruned = await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: wantedIds } },
    });
    if (pruned.count > 0) {
      console.log(`Rôle ${slug} : ${pruned.count} permission(s) périmée(s) retirée(s).`);
    }
  }

  // Niveaux de joueurs
  for (let i = 0; i < LEVELS.length; i++) {
    const [slug, label] = LEVELS[i]!;
    await prisma.playerLevel.upsert({
      where: { slug },
      update: { label },
      create: { slug, label, order: i + 1 },
    });
  }
  const levels = await prisma.playerLevel.findMany();
  const levelId = (slug: string) => levels.find((l) => l.slug === slug)?.id ?? null;

  // Configuration des rangs
  for (const r of RANKS) {
    await prisma.rankConfig.upsert({
      where: { rank: r.rank },
      update: {},
      create: {
        rank: r.rank, symbol: r.symbol, colorToken: r.colorToken,
        dangerLevel: r.danger, rewardRyoMin: r.min, rewardRyoMax: r.max,
        defaultPoints: r.points, minLevelId: levelId(r.level),
        recommendedGroupSize: r.size,
      },
    });
  }

  // Paramètres applicatifs
  const rpTimeValue = {
    realMsPerRpMonth: 86_400_000, // 1 jour réel = 1 mois RP
    rpMonthsPerYear: 7, // 1 semaine réelle = 1 année RP (année RP de 7 mois)
    realEpochIso: "2026-01-01T00:00:00.000Z",
    rpEpochYear: 1,
  };
  await prisma.appSetting.upsert({
    where: { key: "rp_time" },
    update: { value: rpTimeValue },
    create: { key: "rp_time", value: rpTimeValue },
  });

  // Référentiels des dossiers de renseignement (production incluse)
  const refCount = await seedProfileReferences(prisma);
  console.log(`Référentiels des dossiers : ${refCount} entrées.`);

  // Utilisateur système (auteur des données de démonstration)
  const system = await prisma.user.upsert({
    where: { id: "system" },
    update: {},
    create: { id: "system", displayName: "Le Tisseur (système)", status: "ACTIVE" },
  });

  // Saison active
  const season = await prisma.leaderboardSeason.upsert({
    where: { id: "season-demo" },
    update: {},
    create: {
      id: "season-demo",
      name: "Saison I — L'Éveil de la Toile",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      isActive: true,
    },
  });

  const day = 86_400_000;
  const now = Date.now();

  // ── Données de démonstration (ignorées avec SEED_DEMO=0) ──
  if (seedDemo) {
  // ── Factions et groupes fictifs ──
  const factionDefs = [
    { slug: "kumogakure", name: "[FICTIF] Kumogakure", colorToken: "info" },
    { slug: "clan-kaguya", name: "[FICTIF] Clan Kaguya", colorToken: "danger" },
    { slug: "brume-ecarlate", name: "[FICTIF] La Brume Écarlate", colorToken: "gold" },
    { slug: "racines-grises", name: "[FICTIF] Les Racines Grises", colorToken: "smoke" },
  ];
  const factions = [];
  for (const f of factionDefs) {
    factions.push(
      await prisma.faction.upsert({
        where: { slug: f.slug },
        update: {},
        create: { ...f, description: "Faction fictive du serveur RP." },
      }),
    );
  }

  const leaderRole = await prisma.role.findUniqueOrThrow({ where: { slug: "group_leader" } });
  const memberRole = await prisma.role.findUniqueOrThrow({ where: { slug: "group_member" } });
  const modRole = await prisma.role.findUniqueOrThrow({ where: { slug: "moderator" } });

  // Super administrateur fictif (tests locaux)
  const superRole = await prisma.role.findUniqueOrThrow({ where: { slug: "super_admin" } });
  const demoAdmin = await prisma.user.upsert({
    where: { id: "demo-admin" },
    update: {},
    create: { id: "demo-admin", displayName: "[FICTIF] Le Tisseur Premier", status: "ACTIVE" },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demoAdmin.id, roleId: superRole.id } },
    update: {},
    create: { userId: demoAdmin.id, roleId: superRole.id },
  });

  // Modérateur fictif
  const demoMod = await prisma.user.upsert({
    where: { id: "demo-mod" },
    update: {},
    create: { id: "demo-mod", displayName: "[FICTIF] Araignée-Mère", status: "ACTIVE" },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demoMod.id, roleId: modRole.id } },
    update: {},
    create: { userId: demoMod.id, roleId: modRole.id },
  });

  // Deux groupes par faction, nommés dans le ton de leur maison
  const GROUP_NAMES: string[][] = [
    ["Lances de Foudre", "Veilleurs du Col"],
    ["Ossuaire", "Croc Blanc"],
    ["Racines Profondes", "Sève Amère"],
    ["Voile Rouge", "Marée Basse"],
  ];

  // Chefs, membres et groupes par faction
  const groups = [];
  for (let i = 0; i < factions.length; i++) {
    const faction = factions[i]!;
    const chief = await prisma.user.upsert({
      where: { id: `demo-chief-${i}` },
      update: { playerLevelId: levelId("jonin") },
      create: { id: `demo-chief-${i}`, displayName: `[FICTIF] Chef ${faction.name.replace("[FICTIF] ", "")}`, status: "ACTIVE", playerLevelId: levelId("jonin") },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: chief.id, roleId: leaderRole.id } },
      update: {},
      create: { userId: chief.id, roleId: leaderRole.id },
    });
    for (let g = 0; g < 2; g++) {
      // Noms distincts d'une faction à l'autre : « Cellule 1 » partout rendait
      // le classement et la toile illisibles, huit nœuds portant deux noms.
      const groupName = GROUP_NAMES[i]?.[g] ?? `Cellule ${g + 1}`;
      // Reprise des bases déjà semées : sans ce renommage ciblé, l'upsert
      // ci-dessous créerait un SECOND groupe au lieu de renommer l'ancien.
      // Ne touche que les groupes de démonstration, jamais un groupe créé
      // par un joueur — le nom recherché est exactement l'ancien libellé.
      const legacy = await prisma.group.findFirst({
        where: { factionId: faction.id, name: `Cellule ${g + 1}` },
      });
      if (legacy && groupName !== `Cellule ${g + 1}`) {
        await prisma.group.update({ where: { id: legacy.id }, data: { name: groupName } });
      }
      const group = await prisma.group.upsert({
        where: { factionId_name: { factionId: faction.id, name: groupName } },
        update: {},
        create: { factionId: faction.id, name: groupName },
      });
      groups.push({ group, faction, chief });
      await prisma.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: chief.id } },
        update: { isLeader: true },
        create: { groupId: group.id, userId: chief.id, isLeader: true },
      });
      for (let m = 0; m < 2; m++) {
        const memberLevel = levelId(["genin_confirme", "chunin", "tokubetsu_jonin"][(i + g + m) % 3]!);
        const member = await prisma.user.upsert({
          where: { id: `demo-member-${i}-${g}-${m}` },
          update: { playerLevelId: memberLevel },
          create: {
            id: `demo-member-${i}-${g}-${m}`,
            displayName: `[FICTIF] Opérateur ${i + 1}-${g + 1}-${m + 1}`,
            status: "ACTIVE",
            playerLevelId: memberLevel,
          },
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: member.id, roleId: memberRole.id } },
          update: {},
          create: { userId: member.id, roleId: memberRole.id },
        });
        await prisma.groupMember.upsert({
          where: { groupId_userId: { groupId: group.id, userId: member.id } },
          update: {},
          create: { groupId: group.id, userId: member.id },
        });
      }
    }
  }

  // ── Missions fictives, tous rangs et plusieurs statuts ──
  const missionDefs: {
    code: string; rank: MissionRank; category: MissionCategory; status:
      | "AVAILABLE" | "CLAIM_PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
    title: string; summary: string; expiresInDays: number | null;
    target?: string; location?: string; client?: string; assignIdx?: number;
  }[] = [
    { code: "TO-D-0001", rank: "D", category: "COLLECTE_INFORMATIONS", status: "AVAILABLE", title: "Rumeurs du marché de nuit", summary: "Recueillir les rumeurs circulant au marché nocturne du port.", expiresInDays: 4 },
    { code: "TO-D-0002", rank: "D", category: "ESCORTE", status: "COMPLETED", title: "Escorte d'un marchand de soie", summary: "Escorter un marchand jusqu'au col des Brumes.", expiresInDays: null, assignIdx: 0 },
    { code: "TO-C-0003", rank: "C", category: "SURVEILLANCE_ESPIONNAGE", status: "AVAILABLE", title: "Veille sur l'entrepôt 7", summary: "Surveiller les allées et venues autour de l'entrepôt 7 pendant trois nuits.", expiresInDays: 6, target: "[FICTIF] Contremaître Goza", location: "[FICTIF] Docks est, entrepôt 7" },
    { code: "TO-C-0004", rank: "C", category: "PROTECTION", status: "IN_PROGRESS", title: "Protection d'un témoin", summary: "Assurer la protection discrète d'un témoin avant son audition.", expiresInDays: 3, assignIdx: 2 },
    { code: "TO-B-0005", rank: "B", category: "SABOTAGE", status: "AVAILABLE", title: "Le convoi qui ne doit pas partir", summary: "Retarder le départ d'un convoi sans laisser de traces.", expiresInDays: 8, target: "[FICTIF] Convoi de la guilde Tessen", location: "[FICTIF] Relais du col Nord", client: "[FICTIF] Anonyme — sceau de cire grise" },
    { code: "TO-B-0006", rank: "B", category: "ENLEVEMENT", status: "CLAIM_PENDING", title: "L'archiviste distrait", summary: "Amener discrètement un archiviste à une entrevue qu'il refuse.", expiresInDays: 5, target: "[FICTIF] Archiviste Hosen", location: "[FICTIF] Bibliothèque des Trois Lunes" },
    { code: "TO-A-0007", rank: "A", category: "ELIMINATION", status: "AVAILABLE", title: "Le collecteur de dettes", summary: "Mettre fin aux agissements d'un collecteur protégé par une escorte armée.", expiresInDays: 10, target: "[FICTIF] Ryuzô le Percepteur", location: "[FICTIF] Quartier des lanternes", client: "[FICTIF] La Veuve aux Sept Anneaux" },
    { code: "TO-A-0008", rank: "A", category: "INTERROGATOIRE", status: "FAILED", title: "Questions pour un déserteur", summary: "Obtenir des réponses d'un déserteur avant sa fuite hors des frontières.", expiresInDays: null, assignIdx: 4 },
    // Missions résolues supplémentaires : sans elles, aucune part n'est jamais
    // distribuée et le classement reste vide de ryōs — la moitié du produit
    // ne serait donc jamais démontrée.
    { code: "TO-C-0012", rank: "C", category: "COLLECTE_INFORMATIONS", status: "COMPLETED", title: "Le registre du changeur", summary: "Copier trois pages du registre d'un changeur sans qu'il s'en aperçoive.", expiresInDays: null, assignIdx: 1 },
    { code: "TO-B-0013", rank: "B", category: "PROTECTION", status: "COMPLETED", title: "La nuit des lanternes éteintes", summary: "Protéger une famille de marchands pendant une nuit d'émeute.", expiresInDays: null, assignIdx: 2 },
    { code: "TO-A-0014", rank: "A", category: "SABOTAGE", status: "COMPLETED", title: "Les chaînes du chantier naval", summary: "Immobiliser un navire avant son appareillage.", expiresInDays: null, assignIdx: 3 },
    { code: "TO-S-0009", rank: "S", category: "MERCENARIAT", status: "AVAILABLE", title: "Sept lames pour un pont", summary: "Tenir le pont de Kanzaki pendant l'affrontement entre deux clans.", expiresInDays: 14, target: "[FICTIF] Forces du clan Yagura", location: "[FICTIF] Pont de Kanzaki", client: "[FICTIF] Le Conseil des Cendres" },
    { code: "TO-S-0010", rank: "S", category: "SPECIALE", status: "CANCELLED", title: "L'œil du typhon", summary: "Mission spéciale définie par la modération.", expiresInDays: null },
    { code: "TO-SS-0011", rank: "SS", category: "ELIMINATION", status: "AVAILABLE", title: "Le seigneur des marées noires", summary: "Cible d'exception. Dossier scellé — réservé après attribution.", expiresInDays: 21, target: "[FICTIF] Seigneur Kaimon", location: "[FICTIF] Forteresse des marées", client: "[FICTIF] Sceau d'or — commanditaire voilé" },
  ];

  const rankPoints = Object.fromEntries(RANKS.map((r) => [r.rank, r.points]));
  const rankRewards = Object.fromEntries(RANKS.map((r) => [r.rank, [r.min, r.max]]));

  for (const def of missionDefs) {
    const assigned = def.assignIdx != null ? groups[def.assignIdx % groups.length] : null;
    const [rMin, rMax] = rankRewards[def.rank] as [number, number];
    const mission = await prisma.mission.upsert({
      where: { code: def.code },
      update: {},
      create: {
        code: def.code,
        status: def.status,
        rank: def.rank,
        category: def.category,
        publicTitle: def.title,
        publicSummary: def.summary,
        rewardRyoMin: rMin,
        rewardRyoMax: rMax,
        basePoints: rankPoints[def.rank] as number,
        targetLevelId: levelId(RANKS.find((r) => r.rank === def.rank)!.level),
        minRecommendedLevelId: levelId(RANKS.find((r) => r.rank === def.rank)!.level),
        groupSizeMin: 2,
        groupSizeMax: RANKS.find((r) => r.rank === def.rank)!.size,
        confidentialDescription: def.target
          ? "Dossier confidentiel fictif. Les détails tactiques complets ne sont visibles qu'après attribution."
          : null,
        primaryObjective: def.target ? `Objectif principal concernant ${def.target}.` : null,
        secondaryObjectives: def.target
          ? [
              { label: "Ne laisser aucune trace exploitable", points: 10 },
              { label: "Objectif voilé de la Toile", secret: true, points: 25 },
            ]
          : [],
        targetIdentity: def.target ?? null,
        location: def.location ?? null,
        clientName: def.client ?? null,
        constraints: def.target ? "Aucun témoin. Aucune signature de faction." : null,
        prohibitions: def.target ? "Interdiction de toucher aux civils du quartier." : null,
        evidence: def.target ? "Rapporter le sceau personnel de la cible." : null,
        internalTitle: `${def.code} — dossier interne`,
        createdAt: new Date(now - 10 * day),
        publishedAt: def.status === "AVAILABLE" || def.status === "CLAIM_PENDING" ? new Date(now - 5 * day) : new Date(now - 9 * day),
        expiresAt: def.expiresInDays ? new Date(now + def.expiresInDays * day) : null,
        assignedFactionId: assigned?.faction.id ?? null,
        assignedGroupId: assigned?.group.id ?? null,
        assignedAt: assigned ? new Date(now - 3 * day) : null,
        resolvedAt: ["COMPLETED", "FAILED", "CANCELLED"].includes(def.status) ? new Date(now - day) : null,
        failureReason: def.status === "FAILED" ? "La cible a été exfiltrée avant l'interception (fiction RP)." : null,
        cancellationReason: def.status === "CANCELLED" ? "Annulée par la modération (fiction RP)." : null,
        creatorId: demoMod.id,
        responsibleModeratorId: demoMod.id,
        visibility: { create: { showCategory: def.rank !== "SS", showTargetLevel: true, showSummary: true } },
      },
    });

    if (assigned) {
      const existing = await prisma.missionAssignment.findFirst({ where: { missionId: mission.id } });
      if (!existing) {
        await prisma.missionAssignment.create({
          data: {
            missionId: mission.id,
            factionId: assigned.faction.id,
            groupId: assigned.group.id,
            assignedById: demoMod.id,
            active: !["COMPLETED", "FAILED", "CANCELLED"].includes(def.status),
            assignedAt: new Date(now - 3 * day),
          },
        });
      }
    }
  }

  // Revendication en attente sur TO-B-0006
  const claimMission = await prisma.mission.findUnique({ where: { code: "TO-B-0006" } });
  const claimGroup = groups[1];
  if (claimMission && claimGroup) {
    await prisma.missionClaim.upsert({
      where: { missionId_groupId: { missionId: claimMission.id, groupId: claimGroup.group.id } },
      update: {},
      create: {
        missionId: claimMission.id,
        groupId: claimGroup.group.id,
        leaderId: claimGroup.chief.id,
        message: "Notre cellule connaît bien la Bibliothèque des Trois Lunes. (fiction RP)",
        status: "PENDING",
        proposedHeadcount: 3,
      },
    });
    await prisma.missionClaim.update({
      where: { missionId_groupId: { missionId: claimMission.id, groupId: claimGroup.group.id } },
      data: { proposedHeadcount: 3 },
    });
  }

  // Scores fictifs pour le classement
  const scoreRows: [number, number, string][] = [
    [0, 140, "MISSION_COMPLETED"], [0, 25, "SECONDARY_OBJECTIVES"],
    [1, 60, "MISSION_COMPLETED"], [1, -30, "MISSION_FAILED"],
    [2, 300, "MISSION_COMPLETED"], [2, 45, "SPEED_BONUS"],
    [3, 25, "MISSION_COMPLETED"], [3, -15, "ADMIN_PENALTY"],
    [4, 10, "MISSION_COMPLETED"], [5, 60, "MISSION_COMPLETED"],
    [6, 140, "MISSION_COMPLETED"], [7, 10, "MISSION_COMPLETED"],
  ];
  const existingScores = await prisma.missionScore.count();
  if (existingScores === 0) {
    for (const [groupIdx, points, reason] of scoreRows) {
      const entry = groups[groupIdx % groups.length]!;
      await prisma.missionScore.create({
        data: {
          seasonId: season.id,
          factionId: entry.faction.id,
          groupId: entry.group.id,
          points,
          reason: reason as never,
          justification: "Donnée de démonstration fictive.",
          createdById: demoMod.id,
        },
      });
    }
  }

  // ── Parts distribuées sur les missions accomplies ──
  // Sans elles, « ce que la Toile a rapporté » resterait à zéro partout : ni
  // gains d'agent, ni de groupe, ni de faction. La répartition est le pendant
  // des points, et elle n'était jamais démontrée.
  const completedMissions = await prisma.mission.findMany({
    where: { status: "COMPLETED" },
    include: { assignments: { include: { group: { include: { members: true } } } } },
  });
  for (const mission of completedMissions) {
    const alreadyShared = await prisma.missionParticipant.count({
      where: { missionId: mission.id },
    });
    if (alreadyShared > 0) continue; // seed idempotent
    const assignment = mission.assignments[0];
    if (!assignment) continue;
    const members = assignment.group.members.slice(0, 4);
    if (members.length === 0) continue;

    // Montant retenu par la modération dans la fourchette du rang
    const awarded = Math.round((mission.rewardRyoMin + mission.rewardRyoMax) / 2);
    const perHead = Math.floor(awarded / members.length);
    const remainder = awarded - perHead * members.length;
    await prisma.mission.update({ where: { id: mission.id }, data: { awardedRyo: awarded } });
    await prisma.missionParticipant.createMany({
      data: members.map((member, index) => ({
        missionId: mission.id,
        userId: member.userId,
        groupId: assignment.groupId,
        addedById: demoMod.id,
        // Le reliquat de la division revient au premier : la somme des parts
        // est exactement le montant versé, sans ryō évaporé.
        ryoAwarded: perHead + (index === 0 ? remainder : 0),
        pointsAwarded: Math.max(1, Math.round(mission.basePoints / members.length)),
      })),
      skipDuplicates: true,
    });
  }

  // ── Fiches de groupe fictives (pays, village, spécialités) ──
  const groupFiches: [number, string, string, MissionCategory[]][] = [
    [0, "Pays de la Foudre", "Kumogakure", ["COLLECTE_INFORMATIONS", "SURVEILLANCE_ESPIONNAGE"]],
    [1, "Pays de la Foudre", "Kumogakure", ["ESCORTE", "PROTECTION"]],
    [2, "Pays de l'Eau", "Kirigakure", ["ELIMINATION", "TRAQUE"]],
    [3, "Pays de l'Eau", "Kirigakure", ["INFILTRATION", "SABOTAGE"]],
  ];
  for (const [index, country, village, specialties] of groupFiches) {
    const entry = groups[index];
    if (!entry) continue;
    await prisma.group.update({
      where: { id: entry.group.id },
      data: {
        primaryCountry: country,
        primaryVillage: village,
        specialties,
        createdById: demoMod.id,
      },
    });
  }

  // ── Identités fictives complétées (l'onboarding est testé via demo-incomplete) ──
  const FIRST_NAMES = ["Akira", "Rin", "Sota", "Yumi", "Kaede", "Hiro", "Mei", "Ren"];
  const LAST_NAMES = ["Uzumori", null, "Kagesawa", null, "Hoshigaki", "Yanagi", null, "Kurotsuki"];
  const demoUsers = await prisma.user.findMany({ where: { id: { startsWith: "demo-" } } });
  for (let i = 0; i < demoUsers.length; i++) {
    const user = demoUsers[i]!;
    const norm = user.displayName.trim().replace(/\s+/g, " ").toLowerCase();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: user.firstName ?? FIRST_NAMES[i % FIRST_NAMES.length],
        lastName: user.lastName ?? LAST_NAMES[i % LAST_NAMES.length],
        displayNameNorm: norm,
        profileCompleted: true,
        privacyAcknowledgedAt: new Date(),
      },
    });
  }

  // Compte fictif au profil INCOMPLET : sert aux tests de l'onboarding
  await prisma.user.upsert({
    where: { id: "demo-incomplete" },
    update: { profileCompleted: false, firstName: null, privacyAcknowledgedAt: null },
    create: {
      id: "demo-incomplete",
      displayName: "[FICTIF] Nouveau Fil",
      status: "ACTIVE",
      profileCompleted: false,
    },
  });

  // ── Dossiers de renseignement fictifs ──
  const refOption = async (type: string, code: string) =>
    prisma.profileReferenceOption.findUniqueOrThrow({ where: { type_code: { type, code } } });

  const existingProfiles = await prisma.characterProfile.count();
  if (existingProfiles === 0) {
    const day2 = 86_400_000;
    // Dossier COMPLET : « Akira » du clan Kaguya (toutes données fictives)
    const akira = await prisma.characterProfile.create({
      data: {
        code: `tmp-${Date.now()}`,
        characterFirstName: "Akira",
        firstNameNorm: "akira",
        characterLastName: "Kaguya",
        sexCode: "MALE",
        heightMinCm: 180,
        heightMaxCm: 190,
        hairColorId: (await refOption("HAIR_COLOR", "WHITE")).id,
        factionId: (await prisma.faction.findUnique({ where: { slug: "kumogakure" } }))?.id,
        rankId: levelId("jonin"),
        lifeStatus: "ALIVE",
        ageMode: "AGE_AT_REFERENCE",
        ageYearsAtRef: 24,
        ageReferenceRealAt: new Date(now - 3 * day2),
        details: "Mercenaire discret opérant autour des routes marchandes. (fiction RP)",
        strengths: "Ossature modelable, sang-froid remarquable. (fiction RP)",
        weaknesses: "Endurance limitée après usage prolongé du Shikotsumyaku. (fiction RP)",
        internalNotes: "NOTE INTERNE FICTIVE — jamais vendue avec le dossier.",
        createdById: demoMod.id,
      },
    });
    await prisma.characterProfile.update({
      where: { id: akira.id },
      data: { code: `PRF-${String(akira.codeNumber).padStart(6, "0")}` },
    });
    await prisma.characterProfileTrait.createMany({
      data: [
        { profileId: akira.id, optionId: (await refOption("CLAN_FAMILY", "KAGUYA")).id },
        { profileId: akira.id, optionId: (await refOption("CHAKRA_NATURE", "SUITON")).id },
        { profileId: akira.id, optionId: (await refOption("KEKKEI_GENKAI", "SHIKOTSUMYAKU")).id },
        { profileId: akira.id, optionId: (await refOption("COMBAT_STYLE", "KENJUTSU")).id },
        { profileId: akira.id, optionId: (await refOption("KENJUTSU_STYLE", "HEAVY_BLADE")).id },
      ],
    });
    await prisma.characterSignatureTechnique.create({
      data: {
        profileId: akira.id,
        name: "Danse des Camélias",
        shortDescription: "Enchaînement de frappes à l'os affûté. (fiction RP)",
        jutsuTypeId: (await refOption("JUTSU_TYPE", "TAIJUTSU")).id,
        rank: "B",
        createdById: demoMod.id,
      },
    });
    // États de connaissance : tout ce qui précède est CONNU ; la peau reste
    // inconnue (pas de ligne) ; l'absence d'artefact est CONFIRMÉE.
    const knownKeys = [
      "lastName", "sex", "height", "hairColor", "faction", "clans", "rank",
      "lifeStatus", "age", "chakraNatures", "kekkeiGenkai", "techniques",
      "combatStyles", "kenjutsuStyles", "details", "strengths", "weaknesses",
    ];
    await prisma.characterFieldIntel.createMany({
      data: [
        ...knownKeys.map((fieldKey) => ({
          profileId: akira.id,
          fieldKey,
          knowledgeState: "KNOWN" as const,
          confidence: "CONFIRMED" as const,
          updatedById: demoMod.id,
        })),
        {
          profileId: akira.id,
          fieldKey: "artifacts",
          knowledgeState: "NONE_CONFIRMED" as const,
          confidence: "PROBABLE" as const,
          updatedById: demoMod.id,
        },
      ],
    });

    // Dossier MINIMAL : « Ombre » (prénom seul, tout Inconnu)
    const ombre = await prisma.characterProfile.create({
      data: {
        code: `tmp2-${Date.now()}`,
        characterFirstName: "Ombre",
        firstNameNorm: "ombre",
        createdById: demoMod.id,
      },
    });
    await prisma.characterProfile.update({
      where: { id: ombre.id },
      data: { code: `PRF-${String(ombre.codeNumber).padStart(6, "0")}` },
    });

    // Relation : Akira est parent d'Ombre (fiction)
    await prisma.characterRelationship.create({
      data: {
        fromProfileId: akira.id,
        toProfileId: ombre.id,
        type: "PARENT_OF",
        createdById: demoMod.id,
      },
    });

    // Accès : la Cellule 1 de Kumogakure a acheté le dossier d'Akira ;
    // une demande PENDING existe pour un autre groupe.
    const buyerGroup = groups[0];
    const requesterGroup = groups[2];
    if (buyerGroup) {
      await prisma.profileAccessGrant.create({
        data: {
          profileId: akira.id,
          groupId: buyerGroup.group.id,
          grantedById: demoMod.id,
          priceRyos: 150_000,
        },
      });
    }
    if (requesterGroup) {
      await prisma.profilePurchaseRequest.create({
        data: {
          profileId: akira.id,
          groupId: requesterGroup.group.id,
          requestedById: requesterGroup.chief.id,
          message: "Nos routes croisent ce personnage. (fiction RP)",
        },
      });
    }
    console.log("Dossiers de démonstration créés (Akira, Ombre).");
  }
  }

  // Invitations super_admin initiales si aucune invitation n'existe :
  // une pour le codeur, une pour le streamer qui incarne « Le Tisseur d'Or ».
  const inviteCount = await prisma.invitation.count();
  if (inviteCount === 0) {
    const pepper = process.env.INVITE_TOKEN_PEPPER;
    if (!pepper) {
      console.warn("⚠ INVITE_TOKEN_PEPPER absent — invitations initiales non créées.");
    } else {
      const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { slug: "super_admin" } });
      const initial = [
        { note: "Invitation initiale — le codeur (seed)", label: "CODEUR" },
        { note: "Invitation initiale — Le Tisseur d'Or (seed)", label: "LE TISSEUR D'OR" },
      ];
      console.log("\n════════════════════════════════════════════════════════");
      console.log("  INVITATIONS SUPER ADMIN (affichées une seule fois) :");
      for (const inv of initial) {
        const token = randomBytes(32).toString("base64url");
        await prisma.invitation.create({
          data: {
            tokenHash: createHash("sha256").update(`${token}${pepper}`).digest("hex"),
            createdById: system.id,
            roleId: superAdminRole.id,
            playerLevelId: levelId("genin_apprenti"),
            expiresAt: new Date(now + 7 * day),
            requireApproval: false,
            note: inv.note,
          },
        });
        console.log(`  ${inv.label} :`);
        console.log(`  ${process.env.APP_URL ?? "http://localhost:3000"}/invitation/${token}\n`);
      }
      console.log("════════════════════════════════════════════════════════\n");
    }
  }

  console.log("Seed terminé.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
