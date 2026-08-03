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

/** Carte Kanban : la vue sérialisée + méta d'affichage non confidentielles. */
export interface BoardCard {
  view: MissionView;
  column: KanbanColumnKey;
  assignedLabel: string | null; // faction/groupe si l'utilisateur peut le voir
  targetLevelLabel: string | null;
  pendingNotifications: number;
  canOpen: boolean;
}

export interface BoardData {
  columns: { key: KanbanColumnKey; label: string; cards: BoardCard[] }[];
  isModerator: boolean;
  myGroups: { id: string; name: string; factionId: string; memberCount: number }[];
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

export function viewLevelFor(
  ctx: AccessContext,
  mission: { id: string; assignedGroupId: string | null },
): MissionViewLevel {
  if (ctx.isModerator) return "moderator";
  if (mission.assignedGroupId && ctx.groupIds.has(mission.assignedGroupId)) return "assigned";
  if (ctx.participantMissionIds.has(mission.id)) return "assigned";
  return "public";
}

const missionInclude = {
  visibility: true,
  assignedFaction: { select: { name: true } },
  assignedGroup: { select: { name: true, factionId: true } },
  targetLevel: { select: { label: true, slug: true } },
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

    // Étiquette du groupe attribué : modérateurs, membres de la faction concernée
    let assignedLabel: string | null = null;
    const maySeeAssignee =
      ctx.isModerator ||
      level === "assigned" ||
      (mission.assignedGroup && ctx.factionIds.has(mission.assignedGroup.factionId));
    if (maySeeAssignee && mission.assignedFaction && mission.assignedGroup) {
      assignedLabel = streamer
        ? maskValue("GRP", mission.assignedGroupId ?? "")
        : `${mission.assignedFaction.name} — ${mission.assignedGroup.name}`;
    }

    cards.push({
      view,
      column,
      assignedLabel,
      targetLevelLabel:
        "targetLevelId" in view && view.targetLevelId ? mission.targetLevel?.label ?? null : null,
      pendingNotifications: 0,
      canOpen: true,
    });
  }

  return {
    columns: KANBAN_COLUMNS.map((col) => ({
      key: col.key,
      label: col.label,
      cards: cards.filter((c) => c.column === col.key),
    })),
    isModerator: ctx.isModerator,
    myGroups: ctx.ledGroups,
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

  return { mission, view, level, ctx };
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
