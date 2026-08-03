import type { Client } from "discord.js";
import { prisma } from "@toile/database";

const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Synchronisation des rôles Discord :
 * un utilisateur ACTIF qui a perdu tous les rôles critiques (ou quitté le
 * serveur) est SUSPENDU et ses sessions sont révoquées immédiatement.
 */
export function startRoleSync(client: Client): void {
  const guildId = process.env.DISCORD_GUILD_ID;
  const requiredRoles = (process.env.DISCORD_REQUIRED_ROLE_IDS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  if (!guildId) {
    console.warn("[sync] DISCORD_GUILD_ID absent — synchronisation des rôles désactivée");
    return;
  }

  const tick = async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const accounts = await prisma.discordAccount.findMany({
        where: { user: { status: "ACTIVE" } },
        include: { user: true },
      });

      for (const account of accounts) {
        let roles: string[] | null = null;
        try {
          const member = await guild.members.fetch(account.discordId);
          roles = [...member.roles.cache.keys()];
        } catch {
          roles = null; // a quitté le serveur
        }

        await prisma.discordAccount.update({
          where: { id: account.id },
          data: { guildRoles: roles ?? [], syncedAt: new Date() },
        });

        const lostAccess =
          roles === null ||
          (requiredRoles.length > 0 && !requiredRoles.some((r) => roles!.includes(r)));

        if (lostAccess) {
          await prisma.user.update({
            where: { id: account.userId },
            data: { status: "SUSPENDED", revokedReason: "Synchronisation Discord : rôle critique perdu" },
          });
          await prisma.session.updateMany({
            where: { userId: account.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await prisma.auditLog.create({
            data: {
              action: "access.suspended",
              resourceType: "user",
              resourceId: account.userId,
              reason: roles === null ? "A quitté le serveur Discord" : "Rôles critiques perdus",
            },
          });
          console.log(`[sync] accès suspendu : ${account.username}`);
        }
      }
    } catch (error) {
      console.error("[sync] erreur :", error);
    }
  };

  setInterval(tick, SYNC_INTERVAL_MS);
  void tick();
  console.log("[sync] synchronisation des rôles démarrée (10 min)");
}

/**
 * Expiration automatique des missions dont la date limite réelle est dépassée,
 * et alerte « délai proche » (< 24 h) aux groupes attribués.
 */
export function startExpirationSweep(): void {
  const tick = async () => {
    try {
      const now = new Date();
      const expired = await prisma.mission.findMany({
        where: {
          expiresAt: { lte: now },
          timerSuspendedAt: null,
          status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"] },
        },
      });

      for (const mission of expired) {
        await prisma.$transaction([
          prisma.mission.update({
            where: { id: mission.id },
            data: { status: "EXPIRED", resolvedAt: now },
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

        // Prévenir le groupe attribué et les chefs de la faction concernée
        const targets = new Set<string>();
        if (mission.assignedGroupId) {
          const members = await prisma.groupMember.findMany({
            where: { groupId: mission.assignedGroupId, user: { status: "ACTIVE" } },
          });
          members.forEach((m) => targets.add(m.userId));
        }
        const leaders = await prisma.factionMember.findMany({
          where: {
            isLeader: true,
            user: { status: "ACTIVE" },
            ...(mission.assignedFactionId ? { factionId: mission.assignedFactionId } : {}),
          },
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
        console.log(`[expiration] ${mission.code} expirée`);
      }

      // Alerte délai proche (24 h) — une seule fois par mission
      const soonThreshold = new Date(now.getTime() + 24 * 3600 * 1000);
      const closing = await prisma.mission.findMany({
        where: {
          expiresAt: { gt: now, lte: soonThreshold },
          timerSuspendedAt: null,
          status: { in: ["ASSIGNED", "IN_PROGRESS"] },
          assignedGroupId: { not: null },
        },
      });
      for (const mission of closing) {
        const alreadyWarned = await prisma.notificationDelivery.findFirst({
          where: { missionId: mission.id, event: "MISSION_DEADLINE_SOON" },
        });
        if (alreadyWarned) continue;
        const members = await prisma.groupMember.findMany({
          where: { groupId: mission.assignedGroupId!, user: { status: "ACTIVE" } },
        });
        await prisma.notificationDelivery.createMany({
          data: members.map((m) => ({
            userId: m.userId,
            event: "MISSION_DEADLINE_SOON" as const,
            payload: { code: mission.code, rank: mission.rank, title: mission.publicTitle },
            missionId: mission.id,
          })),
        });
      }
    } catch (error) {
      console.error("[expiration] erreur :", error);
    }
  };

  setInterval(tick, 60_000);
  void tick();
  console.log("[expiration] veille des délais démarrée (1 min)");
}
