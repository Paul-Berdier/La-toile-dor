import "server-only";
import { prisma } from "@toile/database";
import { isMissionEligibleForExpiration } from "@/server/expiration-policy";

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
  const sweepAt = new Date(now);

  try {
    const expired = await prisma.mission.findMany({
      where: {
        expiresAt: { lte: sweepAt },
        timerSuspendedAt: null,
        status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"] },
      },
      select: { id: true },
    });

    for (const candidate of expired) {
      let mission:
        | {
            id: string;
            code: string;
            rank: string;
            publicTitle: string;
            assignments: { groupId: string }[];
          }
        | null = null;

      try {
        mission = await prisma.$transaction(
          async (tx) => {
            const liveMission = await tx.mission.findUnique({
              where: { id: candidate.id },
              select: {
                id: true,
                code: true,
                rank: true,
                publicTitle: true,
                status: true,
                expiresAt: true,
                timerSuspendedAt: true,
                assignments: {
                  where: { active: true },
                  select: { groupId: true },
                },
              },
            });
            if (!liveMission || !isMissionEligibleForExpiration(liveMission, sweepAt)) {
              return null;
            }

            const updated = await tx.mission.updateMany({
              where: {
                id: liveMission.id,
                status: liveMission.status,
                expiresAt: { lte: sweepAt },
                timerSuspendedAt: null,
              },
              data: { status: "EXPIRED", resolvedAt: sweepAt },
            });
            if (updated.count !== 1) return null;

            await tx.missionStatusHistory.create({
              data: {
                missionId: liveMission.id,
                fromStatus: liveMission.status,
                toStatus: "EXPIRED",
                changedById: "system",
                reason: "Expiration automatique du délai réel",
              },
            });

            return {
              id: liveMission.id,
              code: liveMission.code,
              rank: liveMission.rank,
              publicTitle: liveMission.publicTitle,
              assignments: liveMission.assignments,
            };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        // Deux instances peuvent balayer au même instant. Une transaction
        // perdante ne notifie personne ; le gagnant possède seul le commit.
        if ((error as { code?: string }).code === "P2034") continue;
        throw error;
      }

      if (!mission) continue;

      // Prévenir les membres des groupes assignés. Une faction ne confère
      // aucun droit et ne reçoit donc aucune notification d'autorité.
      const targets = new Set<string>();
      const groupIds = mission.assignments.map((a) => a.groupId);
      if (groupIds.length > 0) {
        const members = await prisma.groupMember.findMany({
          where: { groupId: { in: groupIds }, user: { status: "ACTIVE" } },
          select: { userId: true },
        });
        members.forEach((m) => targets.add(m.userId));
      }
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
