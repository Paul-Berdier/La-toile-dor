import "server-only";
import { prisma } from "@toile/database";

/**
 * Expiration automatique des missions — version « sans bot » : exécutée
 * paresseusement par le service web (au plus une fois par minute), lors des
 * chargements du tableau. Les délais suspendus ne courent pas.
 */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60_000;

export async function maybeExpireMissions(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  try {
    const expired = await prisma.mission.findMany({
      where: {
        expiresAt: { lte: new Date(now) },
        timerSuspendedAt: null,
        status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
      include: { assignments: { where: { active: true }, select: { groupId: true, factionId: true } } },
    });

    for (const mission of expired) {
      await prisma.$transaction([
        prisma.mission.update({
          where: { id: mission.id },
          data: { status: "EXPIRED", resolvedAt: new Date(now) },
        }),
        prisma.missionStatusHistory.create({
          data: {
            missionId: mission.id,
            fromStatus: mission.status,
            toStatus: "EXPIRED",
            changedById: "system",
            reason: "Expiration automatique du délai réel",
          },
        }),
      ]);

      // Prévenir tous les groupes assignés et les chefs des factions concernées
      const targets = new Set<string>();
      const groupIds = mission.assignments.map((a) => a.groupId);
      const factionIds = mission.assignments.map((a) => a.factionId);
      if (groupIds.length > 0) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: { in: groupIds }, user: { status: "ACTIVE" } },
          select: { userId: true },
        });
        members.forEach((m) => targets.add(m.userId));
      }
      const leaders = await prisma.factionMember.findMany({
        where: {
          isLeader: true,
          user: { status: "ACTIVE" },
          ...(factionIds.length > 0 ? { factionId: { in: factionIds } } : {}),
        },
        select: { userId: true },
      });
      leaders.forEach((l) => targets.add(l.userId));

      if (targets.size > 0) {
        await prisma.notificationDelivery.createMany({
          data: [...targets].map((userId) => ({
            userId,
            event: "MISSION_EXPIRED" as const,
            payload: { code: mission.code, rank: mission.rank, title: mission.publicTitle },
            missionId: mission.id,
          })),
        });
      }
    }

    // Alerte « délai proche » (24 h), une seule fois par mission
    const soonThreshold = new Date(now + 24 * 3600 * 1000);
    const closing = await prisma.mission.findMany({
      where: {
        expiresAt: { gt: new Date(now), lte: soonThreshold },
        timerSuspendedAt: null,
        status: { in: ["ASSIGNED", "IN_PROGRESS"] },
        assignments: { some: { active: true } },
      },
      include: { assignments: { where: { active: true }, select: { groupId: true } } },
    });
    for (const mission of closing) {
      const alreadyWarned = await prisma.notificationDelivery.findFirst({
        where: { missionId: mission.id, event: "MISSION_DEADLINE_SOON" },
        select: { id: true },
      });
      if (alreadyWarned) continue;
      const members = await prisma.groupMember.findMany({
        where: {
          groupId: { in: mission.assignments.map((a) => a.groupId) },
          user: { status: "ACTIVE" },
        },
        select: { userId: true },
      });
      if (members.length > 0) {
        await prisma.notificationDelivery.createMany({
          data: members.map((m) => ({
            userId: m.userId,
            event: "MISSION_DEADLINE_SOON" as const,
            payload: { code: mission.code, rank: mission.rank, title: mission.publicTitle },
            missionId: mission.id,
          })),
        });
      }
    }
  } catch (error) {
    console.error("[expiration] balayage impossible :", error);
  }
}
