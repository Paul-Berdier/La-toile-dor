import "server-only";
import { prisma } from "@toile/database";
import type { Prisma } from "@toile/database";
import { normalizeRefLabel } from "@toile/shared";
import type { CurrentUser } from "@/lib/session";
import { getRpTimeConfig } from "@/server/rp-config";
import { getProfileViewer, canViewProfileValues, type ProfileViewer } from "./access";
import { dossierInclude, serializeDossier, type SerializedDossier } from "./serializer";

// ── Liste des dossiers ──

export interface ProfileListFilters {
  q?: string;
  /** Filtres réservés à la modération (ignorés sinon — anti-fuite) */
  factionId?: string;
  clanOptionId?: string;
  lifeStatus?: string;
  rankId?: string;
  /** Filtres sans fuite pour chefs/agents */
  access?: "granted" | "pending" | "refused";
}

export interface ProfileListRow {
  id: string;
  code: string;
  firstName: string;
  canViewValues: boolean;
  hasVisiblePortrait: boolean;
  updatedAt: string;
  /** Chefs/agents : état d'accès de leurs groupes */
  accessBadge: "granted" | "pending" | "refused" | null;
  /** Modération uniquement */
  intelCount?: number;
  pendingRequests?: number;
}

export async function listProfiles(
  current: CurrentUser,
  filters: ProfileListFilters,
): Promise<{ rows: ProfileListRow[]; viewer: ProfileViewer }> {
  const viewer = await getProfileViewer(current);

  const where: Prisma.CharacterProfileWhereInput = {
    archivedAt: null,
    mergedIntoId: null,
  };

  if (filters.q) {
    const norm = normalizeRefLabel(filters.q);
    where.OR = [
      { firstNameNorm: { contains: norm } },
      { code: { contains: filters.q.toUpperCase() } },
    ];
  }

  // Filtres avancés : STRICTEMENT modération — un chef ne peut pas déduire
  // une faction protégée via un filtre ou un compteur.
  if (viewer.canViewAll) {
    if (filters.factionId) where.factionId = filters.factionId;
    if (filters.rankId) where.rankId = filters.rankId;
    if (filters.lifeStatus) where.lifeStatus = filters.lifeStatus as never;
    if (filters.clanOptionId) {
      where.traits = { some: { optionId: filters.clanOptionId } };
    }
  }

  // Filtre d'accès pour chefs/agents (basé sur LEURS groupes uniquement)
  if (!viewer.canViewAll && filters.access) {
    if (filters.access === "granted") {
      where.id = { in: [...viewer.grantedProfileIds] };
    } else {
      where.purchaseRequests = {
        some: {
          groupId: { in: viewer.groupIds },
          status: filters.access === "pending" ? "PENDING" : "REFUSED",
        },
      };
    }
  }

  const profiles = await prisma.characterProfile.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      code: true,
      characterFirstName: true,
      imageMime: true,
      updatedAt: true,
      _count: { select: { fieldIntel: true } },
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
    const canView = canViewProfileValues(viewer, profile.id);
    let accessBadge: ProfileListRow["accessBadge"] = null;
    if (!viewer.canViewAll) {
      if (viewer.grantedProfileIds.has(profile.id)) accessBadge = "granted";
      else {
        const last = profile.purchaseRequests[0] as { status?: string } | undefined;
        if (last?.status === "PENDING") accessBadge = "pending";
        else if (last?.status === "REFUSED") accessBadge = "refused";
      }
    }
    return {
      id: profile.id,
      code: profile.code,
      firstName: profile.characterFirstName,
      canViewValues: canView,
      hasVisiblePortrait: canView && profile.imageMime != null,
      updatedAt: profile.updatedAt.toISOString(),
      accessBadge,
      ...(viewer.canViewAll
        ? {
            intelCount: profile._count.fieldIntel,
            pendingRequests: profile.purchaseRequests.length,
          }
        : {}),
    };
  });

  return { rows, viewer };
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
    },
  });
  if (!profile) return null;
  // Un dossier fusionné est aussi archivé : la redirection doit donc être
  // évaluée AVANT le test d'archivage, sinon l'ancien code renverrait 404.
  if (profile.mergedIntoId) {
    return getDossierDetail(current, profile.mergedIntoId);
  }
  if (profile.archivedAt) return null;

  const canView = canViewProfileValues(viewer, profile.id);
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
  // déjà déductible des « ??? » affichés, et motive la demande d'accès.
  const sealedCount = profile.fieldIntel.filter(
    (row) => row.knowledgeState !== "UNKNOWN",
  ).length;
  // Dernier tarif consenti (indicatif) : le prix reste fixé par la modération
  const lastGrant = canView
    ? null
    : await prisma.profileAccessGrant.findFirst({
        where: { profileId: profile.id, priceRyos: { not: null } },
        orderBy: { grantedAt: "desc" },
        select: { priceRyos: true },
      });
  const lastPrice = lastGrant?.priceRyos ?? null;

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
  };
}

// ── Doublons potentiels ──

export async function findSimilarProfiles(firstName: string, excludeId?: string) {
  const norm = normalizeRefLabel(firstName);
  return prisma.characterProfile.findMany({
    where: {
      firstNameNorm: norm,
      archivedAt: null,
      mergedIntoId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, code: true, characterFirstName: true, characterLastName: true },
    take: 5,
  });
}
