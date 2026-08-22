import "server-only";
import { prisma } from "@toile/database";
import { PERMISSIONS, type UserIdentityView } from "@toile/shared";
import type { CurrentUser } from "@/lib/session";
import { getIdentityViewer, serializeUsersForViewer } from "@/server/identity-server";
import {
  aggregateMemberMissionStats,
  EMPTY_MEMBER_MISSION_STATS,
  visibleMemberGroups,
  type MemberGroupRecord,
  type MemberMissionStats,
} from "@/server/member-views";

export const MEMBERS_PAGE_SIZE = 36;

export interface MemberView {
  id: string;
  displayName: string;
  realName?: string;
  publicBio: string | null;
  specialties: string[];
  hasPortrait: boolean;
  levelLabel: string | null;
  roles: { slug: string; name: string }[];
  groups: MemberGroupRecord[];
  stats: MemberMissionStats;
}

interface MemberRecord {
  id: string;
  displayName: string;
  publicBio: string | null;
  specialties: string[];
  portraitMime: string | null;
  playerLevel: { label: string } | null;
  roles: { role: { slug: string; name: string } }[];
  groupMemberships: MemberGroupRecord[];
}

function toMemberView(input: {
  user: MemberRecord;
  identity: UserIdentityView | undefined;
  viewerUserId: string;
  viewerGroupIds: ReadonlySet<string>;
  canViewAllGroups: boolean;
  stats: MemberMissionStats | undefined;
}): MemberView {
  const identity = input.identity ?? { id: input.user.id, displayName: input.user.displayName };
  return {
    id: input.user.id,
    displayName: identity.displayName,
    ...(identity && "realName" in identity && identity.realName
      ? { realName: identity.realName }
      : {}),
    publicBio: input.user.publicBio,
    specialties: input.user.specialties,
    // Les octets du portrait ne font volontairement pas partie de MemberRecord.
    hasPortrait: input.user.portraitMime !== null,
    levelLabel: input.user.playerLevel?.label ?? null,
    roles: input.user.roles
      .map(({ role }) => role)
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    groups: visibleMemberGroups({
      viewerUserId: input.viewerUserId,
      viewerGroupIds: input.viewerGroupIds,
      canViewAllGroups: input.canViewAllGroups,
      targetUserId: input.user.id,
      groups: input.user.groupMemberships,
    }).sort((a, b) => a.group.name.localeCompare(b.group.name, "fr")),
    stats: input.stats ?? { ...EMPTY_MEMBER_MISSION_STATS },
  };
}

async function missionStatsFor(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, MemberMissionStats>();
  const rows = await prisma.missionParticipant.findMany({
    where: {
      userId: { in: userIds },
      mission: { status: { in: ["COMPLETED", "FAILED"] } },
    },
    select: {
      userId: true,
      pointsAwarded: true,
      ryoAwarded: true,
      mission: { select: { status: true } },
    },
  });
  return aggregateMemberMissionStats(
    rows as {
      userId: string;
      pointsAwarded: number;
      ryoAwarded: number;
      mission: { status: "COMPLETED" | "FAILED" };
    }[],
  );
}

const memberSelect = {
  id: true,
  displayName: true,
  publicBio: true,
  specialties: true,
  portraitMime: true,
  playerLevel: { select: { label: true } },
  roles: { select: { role: { select: { slug: true, name: true } } } },
  groupMemberships: {
    where: { group: { isActive: true } },
    select: {
      groupId: true,
      isLeader: true,
      group: {
        select: {
          id: true,
          name: true,
          faction: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

export async function listMembers(
  current: CurrentUser,
  input: { q?: string; page?: number },
): Promise<{ members: MemberView[]; total: number; page: number; pageCount: number }> {
  const q = input.q?.trim().slice(0, 60) ?? "";
  const where = {
    status: "ACTIVE" as const,
    profileCompleted: true,
    ...(q ? { displayName: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const total = await prisma.user.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(input.page ?? 1)), pageCount);
  const users = await prisma.user.findMany({
    where,
    select: memberSelect,
    orderBy: { displayName: "asc" },
    skip: (page - 1) * MEMBERS_PAGE_SIZE,
    take: MEMBERS_PAGE_SIZE,
  });
  const userIds = users.map(({ id }) => id);
  const [identities, identityViewer, stats] = await Promise.all([
    serializeUsersForViewer(current, userIds),
    getIdentityViewer(current),
    missionStatsFor(userIds),
  ]);
  const canViewAllGroups = current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY);

  return {
    members: users.map((user) =>
      toMemberView({
        user,
        identity: identities.get(user.id),
        viewerUserId: current.session.userId,
        viewerGroupIds: identityViewer.groupIds,
        canViewAllGroups,
        stats: stats.get(user.id),
      }),
    ),
    total,
    page,
    pageCount,
  };
}

export async function getMember(current: CurrentUser, userId: string): Promise<MemberView | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, status: "ACTIVE", profileCompleted: true },
    select: memberSelect,
  });
  if (!user) return null;
  const [identities, identityViewer, stats] = await Promise.all([
    serializeUsersForViewer(current, [user.id]),
    getIdentityViewer(current),
    missionStatsFor([user.id]),
  ]);
  return toMemberView({
    user,
    identity: identities.get(user.id),
    viewerUserId: current.session.userId,
    viewerGroupIds: identityViewer.groupIds,
    canViewAllGroups: current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY),
    stats: stats.get(user.id),
  });
}
