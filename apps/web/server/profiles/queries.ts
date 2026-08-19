import "server-only";
import { prisma } from "@toile/database";
import type { Prisma } from "@toile/database";
import { normalizeRefLabel, type GrantSource } from "@toile/shared";
import type { CurrentUser } from "@/lib/session";
import { getRpTimeConfig } from "@/server/rp-config";
import {
  getProfileViewer,
  canViewProfileValues,
  decideAccess,
  toAccessTarget,
  type ProfileViewer,
  type AccessDecision,
} from "./access";
import { dossierInclude, serializeDossier, type SerializedDossier } from "./serializer";
import { estimateProfilePrice, type ProfileEstimate } from "./pricing";

// ── Liste des dossiers ──

/**
 * Dossiers par page. La liste était auparavant tronquée à 100 sans le dire :
 * passé ce seuil, un dossier existant devenait introuvable et l'on aurait cru
 * à une panne de la recherche.
 */
export const PROFILE_PAGE_SIZE = 24;

export interface ProfileListFilters {
  q?: string;
  /** Page demandée, à partir de 1 */
  page?: number;
  /** Filtres réservés à la modération (ignorés sinon — anti-fuite) */
  factionId?: string;
  clanOptionId?: string;
  lifeStatus?: string;
  rankId?: string;
  sexCode?: string;
  /**
   * Traits recherchés — nature de chakra, Kekkei Genkai, technique de clan,
   * style de combat, artefact. Combinés en ET : « Fûton ET Sharingan »
   * répond à une vraie question d'enquête, là où un OU noierait le résultat.
   */
  traitOptionIds?: string[];
  /** Ne garder que les dossiers portant un portrait */
  withPortrait?: boolean;
  /** Nombre minimal de renseignements acquis */
  minIntel?: number;
  /** Filtres sans fuite pour chefs/agents */
  access?: "granted" | "pending" | "refused";
}

export interface ProfileListRow {
  id: string;
  code: string;
  /**
   * Titre, prénom et nom sont les TROIS seules vraies valeurs publiques d'un
   * dossier (règle du produit). Tout le reste est « Inconnu » ou « ??? » pour
   * qui n'a pas accès.
   */
  title: string;
  firstName: string;
  lastName: string | null;
  canViewValues: boolean;
  hasVisiblePortrait: boolean;
  updatedAt: string;
  /**
   * Pourquoi le lecteur voit ce dossier — le lecteur ne doit pas se le
   * demander. `null` s'il ne le voit pas, ou le voit par fonction.
   */
  accessOrigin: GrantSource | null;
  /** Chefs/agents : état d'une demande de leurs groupes, s'il y en a une */
  accessBadge: "pending" | "refused" | null;
  /** Modération uniquement */
  intelCount?: number;
  pendingRequests?: number;
}

export async function listProfiles(
  current: CurrentUser,
  filters: ProfileListFilters,
): Promise<{
  rows: ProfileListRow[];
  viewer: ProfileViewer;
  /** Nombre total de dossiers correspondant aux filtres */
  total: number;
  page: number;
  pageCount: number;
}> {
  const viewer = await getProfileViewer(current);

  const where: Prisma.CharacterProfileWhereInput = {
    archivedAt: null,
    mergedIntoId: null,
  };

  if (filters.q) {
    const norm = normalizeRefLabel(filters.q);
    // Titre, prénom, nom et code : les quatre champs PUBLICS d'un dossier.
    // Chercher dessus ne révèle rien — ils s'affichent à tous sur la liste.
    where.OR = [
      { firstNameNorm: { contains: norm } },
      { characterLastName: { contains: filters.q, mode: "insensitive" } },
      { title: { contains: filters.q, mode: "insensitive" } },
      { code: { contains: filters.q.toUpperCase() } },
    ];
  }

  // ── Filtres sur des champs PROTÉGÉS ──
  // Un lecteur peut filtrer par classe, faction, clan… mais UNIQUEMENT parmi
  // les dossiers qu'il voit déjà. Sinon « tous les Ravageurs » révélerait
  // lesquels des dossiers verrouillés en sont — une fuite par différence de
  // résultats. On restreint donc d'abord l'ensemble, puis on filtre dedans :
  // les dossiers scellés ne sont tout simplement pas dans la base de recherche.
  const protectedFilterRequested =
    Boolean(filters.factionId || filters.rankId || filters.lifeStatus || filters.sexCode) ||
    Boolean(filters.withPortrait) ||
    Boolean(filters.clanOptionId) ||
    (filters.traitOptionIds?.length ?? 0) > 0 ||
    (filters.minIntel ?? 0) > 0;

  if (protectedFilterRequested) {
    if (!viewer.canViewAll) {
      where.id = { in: [...viewer.grantedProfileIds, ...viewer.createdProfileIds] };
    }
    if (filters.factionId) where.factionId = filters.factionId;
    if (filters.rankId) where.rankId = filters.rankId;
    if (filters.lifeStatus) where.lifeStatus = filters.lifeStatus as never;
    if (filters.sexCode) where.sexCode = filters.sexCode as never;
    if (filters.withPortrait) where.imageMime = { not: null };

    // Traits cumulés : une clause par trait, sinon Prisma ne garderait que le
    // dernier `some` et « Fûton ET Sharingan » deviendrait « Sharingan ».
    const traitIds = [
      ...(filters.clanOptionId ? [filters.clanOptionId] : []),
      ...(filters.traitOptionIds ?? []),
    ].filter(Boolean);
    if (traitIds.length > 0) {
      where.AND = traitIds.map((optionId) => ({ traits: { some: { optionId } } }));
    }

    if (filters.minIntel && filters.minIntel > 0) {
      where.fieldIntel = { some: { knowledgeState: "KNOWN" } };
    }
  }

  // Filtre d'accès pour chefs/agents (basé sur LEURS groupes uniquement)
  if (!viewer.canViewAll && filters.access) {
    if (filters.access === "granted") {
      where.id = { in: [...viewer.grantedProfileIds, ...viewer.createdProfileIds] };
    } else {
      where.purchaseRequests = {
        some: {
          groupId: { in: viewer.groupIds },
          status: filters.access === "pending" ? "PENDING" : "REFUSED",
        },
      };
    }
  }

  // Le total est compté avec les MÊMES filtres : il indique ce qui existe
  // réellement, sans jamais révéler un dossier hors de portée du lecteur.
  const total = await prisma.characterProfile.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PROFILE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(filters.page ?? 1)), pageCount);

  const profiles = await prisma.characterProfile.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * PROFILE_PAGE_SIZE,
    take: PROFILE_PAGE_SIZE,
    select: {
      id: true,
      code: true,
      title: true,
      characterFirstName: true,
      characterLastName: true,
      createdByGroupId: true,
      archivedAt: true,
      imageMime: true,
      updatedAt: true,
      _count: { select: { fieldIntel: true } },
      // Octrois des groupes du lecteur seulement : de quoi décider et dire
      // POURQUOI il voit, sans charger ceux des autres groupes.
      accessGrants: viewer.canViewAll
        ? false
        : {
            where: { groupId: { in: viewer.groupIds }, revokedAt: null },
            select: { groupId: true, sourceType: true, revokedAt: true },
          },
      purchaseRequests: viewer.canViewAll
        ? { where: { status: "PENDING" }, select: { id: true } }
        : {
            where: { groupId: { in: viewer.groupIds } },
            select: { status: true },
            orderBy: { requestedAt: "desc" },
            take: 1,
          },
    },
  });

  const rows: ProfileListRow[] = profiles.map((profile) => {
    // La MÊME règle que le détail, nourrie des octrois du lecteur
    const decision = decideAccess(viewer, {
      id: profile.id,
      createdByGroupId: profile.createdByGroupId,
      archivedAt: profile.archivedAt,
      grants: (profile.accessGrants ?? []) as {
        groupId: string;
        sourceType: GrantSource;
        revokedAt: Date | null;
      }[],
    });
    const canView = decision.canView;
    let accessBadge: ProfileListRow["accessBadge"] = null;
    if (!viewer.canViewAll && !canView) {
      const last = profile.purchaseRequests[0] as { status?: string } | undefined;
      if (last?.status === "PENDING") accessBadge = "pending";
      else if (last?.status === "REFUSED") accessBadge = "refused";
    }
    return {
      id: profile.id,
      code: profile.code,
      title: profile.title ?? formatDossierTitle(profile.characterFirstName, profile.characterLastName),
      firstName: profile.characterFirstName,
      // Le nom est PUBLIC, au même titre que le prénom et le titre : ce sont
      // les trois seules vraies valeurs qu'un lecteur sans accès reçoit.
      lastName: profile.characterLastName,
      canViewValues: canView,
      hasVisiblePortrait: canView && profile.imageMime != null,
      updatedAt: profile.updatedAt.toISOString(),
      accessOrigin: decision.origin,
      accessBadge,
      ...(viewer.canViewAll
        ? {
            intelCount: profile._count.fieldIntel,
            pendingRequests: profile.purchaseRequests.length,
          }
        : {}),
    };
  });

  return { rows, viewer, total, page, pageCount };
}

// ── Détail d'un dossier ──

const RELATION_GROUP_LABELS = {
  parents: "Parents",
  children: "Enfants",
  creators: "Créateurs",
  creations: "Créations",
  siblings: "Frères et sœurs",
} as const;

export type RelationGroupKey = keyof typeof RELATION_GROUP_LABELS;

export interface RelationView {
  relationId: string;
  group: RelationGroupKey;
  groupLabel: string;
  /** « ??? » si le lecteur n'a pas accès au dossier consulté */
  typeVisible: boolean;
  related: { id: string; code: string; firstName: string };
}

export interface DossierDetail {
  dossier: SerializedDossier;
  relations: RelationView[];
  viewer: ProfileViewer;
  /** Modération : notes internes + renseignement */
  internal?: {
    internalNotes: string | null;
    intel: {
      fieldKey: string;
      knowledgeState: string;
      confidence: string | null;
      sourceMissionCode: string | null;
      sourceNote: string | null;
      observedAtRp: string | null;
      updatedAt: string;
    }[];
    revisions: {
      fieldKey: string;
      oldValue: unknown;
      newValue: unknown;
      justification: string | null;
      confidence: string | null;
      createdAt: string;
    }[];
    grants: {
      id: string;
      groupName: string;
      priceRyos: number | null;
      grantedAt: string;
      revokedAt: string | null;
    }[];
  };
  /** Chefs : leurs groupes sans accès (pour demander l'achat) */
  requestableGroups: { id: string; name: string }[];
  myPendingRequest: boolean;
  /** Nombre d'informations détenues par la Toile (sans en révéler le contenu) */
  sealedCount: number;
  /** Dernier prix consenti pour ce dossier, à titre indicatif */
  lastPrice: number | null;
  /**
   * Prix conseillé par le barème. Un CONSEIL, jamais un prélèvement : aucun
   * compte n'est débité, le règlement se fait en jeu.
   */
  estimate: ProfileEstimate | null;
  /**
   * Ce que le lecteur peut faire, décidé UNE fois par la règle centrale.
   * `origin` dit pourquoi il voit : le lecteur ne doit pas se le demander.
   */
  access: AccessDecision;
  /** Titre public du dossier — jamais nul en sortie, généré s'il manque */
  title: string;
  /** Groupe propriétaire : nom seulement, et seulement s'il en a un */
  ownerGroupName: string | null;
}

export async function getDossierDetail(
  current: CurrentUser,
  profileId: string,
): Promise<DossierDetail | null> {
  const viewer = await getProfileViewer(current);
  const profile = await prisma.characterProfile.findUnique({
    where: { id: profileId },
    include: {
      ...dossierInclude,
      relationsFrom: {
        include: { toProfile: { select: { id: true, code: true, characterFirstName: true, archivedAt: true } } },
      },
      relationsTo: {
        include: { fromProfile: { select: { id: true, code: true, characterFirstName: true, archivedAt: true } } },
      },
      // Ce dont la règle d'accès a besoin, et rien de plus
      accessGrants: { select: { groupId: true, sourceType: true, revokedAt: true } },
      createdByGroup: { select: { name: true } },
    },
  });
  if (!profile) return null;
  // Un dossier fusionné est aussi archivé : la redirection doit donc être
  // évaluée AVANT le test d'archivage, sinon l'ancien code renverrait 404.
  if (profile.mergedIntoId) {
    return getDossierDetail(current, profile.mergedIntoId);
  }
  if (profile.archivedAt) return null;

  // UNE décision, prise par la règle centrale — pas une déduction locale.
  const access = decideAccess(viewer, toAccessTarget(profile));
  const canView = access.canView;
  const rpConfig = await getRpTimeConfig();
  const dossier = serializeDossier(profile, viewer, canView, rpConfig);

  // Relations : prénom du profil lié toujours visible ; le TYPE est voilé
  // pour un lecteur sans accès au dossier consulté.
  const relations: RelationView[] = [];
  const push = (
    relationId: string,
    group: RelationGroupKey,
    related: { id: string; code: string; characterFirstName: string; archivedAt: Date | null },
  ) => {
    if (related.archivedAt) return;
    relations.push({
      relationId,
      group,
      groupLabel: RELATION_GROUP_LABELS[group],
      typeVisible: canView,
      related: { id: related.id, code: related.code, firstName: related.characterFirstName },
    });
  };
  for (const rel of profile.relationsFrom) {
    if (rel.type === "PARENT_OF") push(rel.id, "children", rel.toProfile);
    else if (rel.type === "CREATOR_OF") push(rel.id, "creations", rel.toProfile);
    else push(rel.id, "siblings", rel.toProfile);
  }
  for (const rel of profile.relationsTo) {
    if (rel.type === "PARENT_OF") push(rel.id, "parents", rel.fromProfile);
    else if (rel.type === "CREATOR_OF") push(rel.id, "creators", rel.fromProfile);
    else push(rel.id, "siblings", rel.fromProfile);
  }

  // Volume de renseignements détenus : un compte, jamais un contenu — il est
  // déjà déductible des « ??? » affichés (règle assumée, cf.
  // docs/PROFILE_VISIBILITY.md), et motive la demande d'accès. Il ne doit en
  // revanche JAMAIS voisiner un autre compte (nombre de champs « connus », par
  // ex.) : par soustraction, la différence dirait combien de champs sont
  // « Aucun » ou « contradictoire ».
  const sealedCount = profile.fieldIntel.filter(
    (row) => row.knowledgeState !== "UNKNOWN",
  ).length;
  // Dernier tarif consenti : MODÉRATION seulement. Pour un lecteur sans accès,
  // c'est un renseignement sur les AUTRES groupes — lequel a acheté, et à quel
  // prix. Le chef a désormais l'estimation du barème comme base de
  // négociation ; il n'a pas besoin de connaître le marché des autres.
  const lastGrant = viewer.canViewAll
    ? await prisma.profileAccessGrant.findFirst({
        where: { profileId: profile.id, priceRyos: { not: null } },
        orderBy: { grantedAt: "desc" },
        select: { priceRyos: true },
      })
    : null;
  const lastPrice = lastGrant?.priceRyos ?? null;

  // Le barème n'intéresse que ceux qui négocient : la modération qui fixe le
  // prix, et le chef qui s'apprête à le payer. Inutile de le calculer pour un
  // agent qui ne peut rien acheter.
  // La forme dépend de ce que le lecteur voit déjà : détail complet pour qui
  // lit le dossier, montant seul pour qui s'apprête à le payer.
  const estimate =
    viewer.canViewAll || viewer.canRequest
      ? await estimateProfilePrice(profile.id, canView)
      : null;

  // Chefs : groupes qu'ils dirigent, sans accès actif ni demande en attente
  let requestableGroups: { id: string; name: string }[] = [];
  let myPendingRequest = false;
  if (viewer.canRequest && viewer.ledGroupIds.length > 0 && !viewer.canViewAll) {
    const [grants, pending, groups] = await Promise.all([
      prisma.profileAccessGrant.findMany({
        where: { profileId: profile.id, groupId: { in: viewer.ledGroupIds }, revokedAt: null },
        select: { groupId: true },
      }),
      prisma.profilePurchaseRequest.findMany({
        where: { profileId: profile.id, groupId: { in: viewer.groupIds }, status: "PENDING" },
        select: { groupId: true },
      }),
      prisma.group.findMany({
        where: { id: { in: viewer.ledGroupIds }, isActive: true },
        select: { id: true, name: true },
      }),
    ]);
    const blocked = new Set([...grants.map((g) => g.groupId), ...pending.map((p) => p.groupId)]);
    requestableGroups = groups.filter((g) => !blocked.has(g.id));
    myPendingRequest = pending.length > 0;
  }

  // Renseignement interne : modération uniquement
  let internal: DossierDetail["internal"];
  if (viewer.canViewAll) {
    const [intelRows, revisions, grants] = await Promise.all([
      prisma.characterFieldIntel.findMany({
        where: { profileId: profile.id },
        include: { sourceMission: { select: { code: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.characterProfileRevision.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.profileAccessGrant.findMany({
        where: { profileId: profile.id },
        include: { group: { select: { name: true } } },
        orderBy: { grantedAt: "desc" },
      }),
    ]);
    internal = {
      internalNotes: profile.internalNotes,
      intel: intelRows.map((row) => ({
        fieldKey: row.fieldKey,
        knowledgeState: row.knowledgeState,
        confidence: row.confidence,
        sourceMissionCode: row.sourceMission?.code ?? null,
        sourceNote: row.sourceNote,
        observedAtRp: row.observedAtRp,
        updatedAt: row.updatedAt.toISOString(),
      })),
      revisions: revisions.map((rev) => ({
        fieldKey: rev.fieldKey,
        oldValue: rev.oldValue,
        newValue: rev.newValue,
        justification: rev.justification,
        confidence: rev.confidence,
        createdAt: rev.createdAt.toISOString(),
      })),
      grants: grants.map((grant) => ({
        id: grant.id,
        groupName: grant.group.name,
        priceRyos: grant.priceRyos,
        grantedAt: grant.grantedAt.toISOString(),
        revokedAt: grant.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  return {
    dossier,
    relations,
    viewer,
    internal,
    requestableGroups,
    myPendingRequest,
    sealedCount,
    lastPrice,
    estimate,
    access,
    title: profile.title ?? formatDossierTitle(profile.characterFirstName, profile.characterLastName),
    // Le nom du groupe propriétaire n'est montré qu'à qui voit le dossier :
    // savoir QUI a ouvert une fiche est déjà un renseignement.
    ownerGroupName: canView ? (profile.createdByGroup?.name ?? null) : null,
  };
}

/** « Dossier — Akira Hoki » : le titre par défaut, jamais vide. */
export function formatDossierTitle(firstName: string, lastName: string | null | undefined): string {
  return `Dossier — ${[firstName, lastName].filter(Boolean).join(" ")}`;
}

// ── Doublons potentiels ──

export async function findSimilarProfiles(firstName: string, excludeId?: string) {
  const norm = normalizeRefLabel(firstName);
  return prisma.characterProfile.findMany({
    where: {
      // « startsWith » et non égalité stricte : « Aki » doit faire ressortir
      // « Akira », sinon le doublon n'est signalé que si l'on tape le prénom
      // exact — c'est-à-dire quasiment jamais.
      //
      // Mais PAS « contains » non plus : cette recherche BLOQUE la création
      // jusqu'à confirmation, donc un « Ran » qui ressortirait dans « Kiran »
      // ferait réclamer une confirmation à presque chaque ouverture de
      // dossier, et l'avertissement finirait par être cliqué sans être lu.
      // Les doublons RP se ressemblent par le début du prénom.
      firstNameNorm: { startsWith: norm },
      archivedAt: null,
      mergedIntoId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, code: true, characterFirstName: true, characterLastName: true },
    take: 5,
  });
}
