import "server-only";
import { prisma } from "@toile/database";
import type { Prisma } from "@toile/database";
import {
  computeTimeRemaining,
  serializeMission,
  toPublicView,
  KANBAN_COLUMNS,
  type MissionFilters,
  type MissionView,
  type MissionViewLevel,
  type KanbanColumnKey,
  PERMISSIONS,
} from "@toile/shared";
import type { CurrentUser } from "@/lib/session";
import { maskValue } from "@/lib/streamer";
import { getRpTimeConfig } from "@/server/rp-config";
import { maybeExpireMissions } from "@/server/expiration";

/** Équipe assignée, visible selon les mêmes règles que l'attribution. */
export interface TeamSummary {
  groupsCount: number;
  totalHeadcount: number;
  label: string; // « Faction — Groupe » (1 groupe) ou « 2 groupes · 7 participants »
}

export interface CardClaimInfo {
  groupId: string;
  groupName: string;
  factionName: string;
  headcount: number;
}

export interface CardAssignmentInfo {
  groupId: string;
  groupName: string;
  factionName: string;
  headcount: number;
  isLead: boolean;
}

/** Carte Kanban : la vue sérialisée + méta d'affichage non confidentielles. */
export interface BoardCard {
  view: MissionView;
  column: KanbanColumnKey;
  team: TeamSummary | null; // null si non autorisé
  targetLevelLabel: string | null;
  pendingNotifications: number;
  canOpen: boolean;
  /** Modération uniquement : alimentent la modale d'attribution */
  pendingClaims?: CardClaimInfo[];
  activeAssignments?: CardAssignmentInfo[];
}

export interface BoardData {
  columns: { key: KanbanColumnKey; label: string; cards: BoardCard[] }[];
  isModerator: boolean;
  myGroups: { id: string; name: string; factionId: string; memberCount: number }[];
  /** Modération uniquement : catalogue pour l'ajout manuel d'un groupe */
  groupsCatalog: { id: string; name: string; factionName: string; memberCount: number }[];
}

function columnOf(status: string): KanbanColumnKey | null {
  for (const col of KANBAN_COLUMNS) {
    if ((col.statuses as readonly string[]).includes(status)) return col.key;
  }
  return null;
}

/** Contexte d'accès pré-calculé pour éviter les requêtes N+1 par mission. */
export async function getAccessContext(current: CurrentUser) {
  const userId = current.session.userId;
  const isModerator =
    current.permissions.has(PERMISSIONS.MISSION_VIEW_ALL) &&
    current.permissions.has(PERMISSIONS.MISSION_VIEW_CONFIDENTIAL);

  const [groupMemberships, participations, factionMemberships] = await Promise.all([
    prisma.groupMember.findMany({
      where: { userId },
      include: { group: { include: { _count: { select: { members: true } } } } },
    }),
    prisma.missionParticipant.findMany({ where: { userId }, select: { missionId: true } }),
    prisma.factionMember.findMany({ where: { userId } }),
  ]);

  return {
    userId,
    isModerator,
    groupIds: new Set(groupMemberships.map((m) => m.groupId)),
    ledGroups: groupMemberships
      .filter((m) => m.isLeader)
      .map((m) => ({
        id: m.groupId,
        name: m.group.name,
        factionId: m.group.factionId,
        memberCount: m.group._count.members,
      })),
    participantMissionIds: new Set(participations.map((p) => p.missionId)),
    factionIds: new Set(factionMemberships.map((f) => f.factionId)),
  };
}

export type AccessContext = Awaited<ReturnType<typeof getAccessContext>>;

/**
 * Niveau de vue sur une mission. L'accès confidentiel passe par les
 * ATTRIBUTIONS ACTIVES (multi-groupes) — un groupe simplement candidat
 * n'obtient rien ; l'ancienne colonne assignedGroupId sert de filet
 * de compatibilité.
 */
export function viewLevelFor(
  ctx: AccessContext,
  mission: {
    id: string;
    assignedGroupId: string | null;
    assignments?: { groupId: string; active: boolean }[];
  },
): MissionViewLevel {
  if (ctx.isModerator) return "moderator";
  const assignedGroupIds = (mission.assignments ?? [])
    .filter((a) => a.active)
    .map((a) => a.groupId);
  if (assignedGroupIds.some((groupId) => ctx.groupIds.has(groupId))) return "assigned";
  if (mission.assignedGroupId && ctx.groupIds.has(mission.assignedGroupId)) return "assigned";
  if (ctx.participantMissionIds.has(mission.id)) return "assigned";
  return "public";
}

/** Vrai si l'utilisateur peut voir les détails confidentiels de la mission. */
export function canViewMissionConfidentialDetails(
  ctx: AccessContext,
  mission: {
    id: string;
    assignedGroupId: string | null;
    assignments?: { groupId: string; active: boolean }[];
  },
): boolean {
  return viewLevelFor(ctx, mission) !== "public";
}

const missionInclude = {
  visibility: true,
  assignedFaction: { select: { name: true } },
  assignedGroup: { select: { name: true, factionId: true } },
  targetLevel: { select: { label: true, slug: true } },
  assignments: {
    where: { active: true },
    include: {
      group: { select: { name: true, factionId: true } },
      faction: { select: { name: true } },
    },
  },
  claims: {
    where: { status: { in: ["PENDING", "INFO_REQUESTED"] } },
    include: { group: { select: { name: true, factionId: true, faction: { select: { name: true } } } } },
  },
  _count: { select: { claims: { where: { status: "PENDING" } } } },
} satisfies Prisma.MissionInclude;

/** Construit la clause WHERE des filtres — UNIQUEMENT sur des champs publics. */
function filtersToWhere(filters: MissionFilters): Prisma.MissionWhereInput {
  const where: Prisma.MissionWhereInput = {};
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: "insensitive" } },
      { publicTitle: { contains: filters.q, mode: "insensitive" } },
      { publicSummary: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.rank?.length) where.rank = { in: filters.rank };
  if (filters.category?.length) where.category = { in: filters.category };
  if (filters.factionId) where.assignedFactionId = filters.factionId;
  if (filters.groupId) where.assignedGroupId = filters.groupId;
  if (filters.publishedAfter) where.publishedAt = { gte: new Date(filters.publishedAfter) };
  if (filters.expiresBefore) where.expiresAt = { lte: new Date(filters.expiresBefore) };
  if (filters.ryoMin != null) where.rewardRyoMax = { gte: filters.ryoMin };
  if (filters.ryoMax != null) where.rewardRyoMin = { lte: filters.ryoMax };
  if (filters.noTimeLimit) where.expiresAt = null;
  if (filters.claimed) where.claims = { some: { status: "PENDING" } };
  if (filters.targetLevel?.length) {
    where.targetLevel = { slug: { in: filters.targetLevel } };
  }
  return where;
}

export async function getBoard(
  current: CurrentUser,
  filters: MissionFilters,
  streamer: boolean,
): Promise<BoardData> {
  // Sans bot Discord, l'expiration automatique est balayée ici (throttlée à 1/min)
  await maybeExpireMissions();

  const [ctx, rpConfig] = await Promise.all([getAccessContext(current), getRpTimeConfig()]);
  const now = new Date();

  const where: Prisma.MissionWhereInput = {
    AND: [
      filtersToWhere(filters),
      // Brouillons et archives réservés aux modérateurs
      ctx.isModerator ? {} : { status: { notIn: ["DRAFT", "ARCHIVED"] } },
      filters.status?.length ? { status: { in: filters.status } } : {},
    ],
  };

  const missions = await prisma.mission.findMany({
    where,
    include: missionInclude,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const cards: BoardCard[] = [];
  for (const mission of missions) {
    const column = columnOf(mission.status);
    if (!column) continue;

    const level = viewLevelFor(ctx, mission);
    const timeRemaining = computeTimeRemaining(mission, now, rpConfig);
    const view = serializeMission(mission, level, {
      timeRemaining,
      claimCount: mission._count.claims,
    });

    // Filtre « compatibles avec mon groupe » (taille uniquement — le niveau
    // moyen relève de l'appréciation du chef, signalé dans le détail)
    if (filters.compatibleWithMyGroup && ctx.ledGroups.length > 0) {
      const fits = ctx.ledGroups.some(
        (g) => g.memberCount >= mission.groupSizeMin && g.memberCount <= mission.groupSizeMax,
      );
      if (!fits) continue;
    }

    // Équipe assignée : modérateurs, membres attribués, factions concernées
    let team: TeamSummary | null = null;
    const maySeeAssignee =
      ctx.isModerator ||
      level === "assigned" ||
      mission.assignments.some((a) => ctx.factionIds.has(a.group.factionId));
    if (maySeeAssignee && mission.assignments.length > 0) {
      const totalHeadcount = mission.assignments.reduce((sum, a) => sum + a.assignedHeadcount, 0);
      const label =
        mission.assignments.length === 1
          ? streamer
            ? maskValue("GRP", mission.assignments[0]!.groupId)
            : `${mission.assignments[0]!.faction.name} — ${mission.assignments[0]!.group.name}`
          : `${mission.assignments.length} groupes · ${totalHeadcount} participants`;
      team = { groupsCount: mission.assignments.length, totalHeadcount, label };
    }

    cards.push({
      view,
      column,
      team,
      targetLevelLabel:
        "targetLevelId" in view && view.targetLevelId ? mission.targetLevel?.label ?? null : null,
      pendingNotifications: 0,
      canOpen: true,
      // Données d'attribution : STRICTEMENT réservées à la modération
      ...(ctx.isModerator
        ? {
            pendingClaims: mission.claims.map((claim) => ({
              groupId: claim.groupId,
              groupName: claim.group.name,
              factionName: claim.group.faction.name,
              headcount: claim.proposedHeadcount ?? 1,
            })),
            activeAssignments: mission.assignments.map((assignment) => ({
              groupId: assignment.groupId,
              groupName: assignment.group.name,
              factionName: assignment.faction.name,
              headcount: assignment.assignedHeadcount,
              isLead: assignment.isLeadGroup,
            })),
          }
        : {}),
    });
  }

  // Catalogue des groupes pour l'attribution manuelle (modération)
  const groupsCatalog = ctx.isModerator
    ? (
        await prisma.group.findMany({
          where: { isActive: true },
          include: { faction: { select: { name: true } }, _count: { select: { members: true } } },
          orderBy: [{ faction: { name: "asc" } }, { name: "asc" }],
        })
      ).map((group) => ({
        id: group.id,
        name: group.name,
        factionName: group.faction.name,
        memberCount: group._count.members,
      }))
    : [];

  return {
    columns: KANBAN_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      cards: cards.filter((c) => c.column === col.key),
    })),
    isModerator: ctx.isModerator,
    myGroups: ctx.ledGroups,
    groupsCatalog,
  };
}

/** Détail d'une mission, sérialisé au niveau exact de l'utilisateur. */
export async function getMissionDetail(current: CurrentUser, missionId: string) {
  const ctx = await getAccessContext(current);
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: {
      ...missionInclude,
      claims: {
        include: { group: { include: { faction: true } }, leader: true },
        orderBy: { createdAt: "desc" },
      },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 30 },
      participants: { include: { user: { select: { displayName: true } } } },
      reports: { orderBy: { submittedAt: "desc" } },
      attachments: true,
      minRecommendedLevel: { select: { label: true } },
    },
  });
  if (!mission) return null;
  if (!ctx.isModerator && ["DRAFT", "ARCHIVED"].includes(mission.status)) return null;

  const level = viewLevelFor(ctx, mission);
  const rpConfig = await getRpTimeConfig();
  const view = serializeMission(mission, level, {
    timeRemaining: computeTimeRemaining(mission, new Date(), rpConfig),
    claimCount: mission.claims.filter((c) => c.status === "PENDING").length,
  });

  // Catalogue des groupes pour la modale d'attribution (modération uniquement)
  const groupsCatalog =
    level === "moderator"
      ? (
          await prisma.group.findMany({
            where: { isActive: true },
            include: { faction: { select: { name: true } }, _count: { select: { members: true } } },
            orderBy: [{ faction: { name: "asc" } }, { name: "asc" }],
          })
        ).map((group) => ({
          id: group.id,
          name: group.name,
          factionName: group.faction.name,
          memberCount: group._count.members,
        }))
      : [];

  return { mission, view, level, ctx, groupsCatalog };
}

/** Vue publique d'une mission arbitraire (aperçus de création). */
export function previewPublic(mission: Parameters<typeof toPublicView>[0]) {
  return toPublicView(mission, {
    timeRemaining: computeTimeRemaining(
      { expiresAt: mission.expiresAt ?? null },
      new Date(),
    ),
    claimCount: 0,
  });
}
