import type { Client } from "discord.js";
import { prisma } from "@toile/database";
import { formatDigest, formatNotification, type NotificationPayload } from "./messages.js";

const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BATCH_WINDOW_MS = 60_000; // regroupement des notifications d'un même lot

/** Backoff exponentiel : 1 min, 4 min, 16 min, ~1 h, ~4 h. */
function backoffMs(attempts: number): number {
  return 60_000 * 4 ** Math.min(attempts, 4);
}

function inQuietHours(pref: { quietHourStart: number | null; quietHourEnd: number | null }): boolean {
  if (pref.quietHourStart == null || pref.quietHourEnd == null) return false;
  const hour = new Date().getHours();
  if (pref.quietHourStart <= pref.quietHourEnd) {
    return hour >= pref.quietHourStart && hour < pref.quietHourEnd;
  }
  return hour >= pref.quietHourStart || hour < pref.quietHourEnd; // fenêtre traversant minuit
}

/**
 * Consomme la file NotificationDelivery : regroupe par utilisateur,
 * respecte les préférences, envoie en DM, applique retries + backoff.
 */
export function startDispatcher(client: Client): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const due = await prisma.notificationDelivery.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: 50,
        include: { user: { include: { discordAccount: true } } },
      });
      if (due.length === 0) return;

      // Laisser une fenêtre de regroupement aux lots récents (anti-spam)
      const ready = due.filter(
        (d) => !d.batchKey || Date.now() - d.createdAt.getTime() > BATCH_WINDOW_MS,
      );

      const byUser = new Map<string, typeof ready>();
      for (const delivery of ready) {
        const list = byUser.get(delivery.userId) ?? [];
        list.push(delivery);
        byUser.set(delivery.userId, list);
      }

      for (const [userId, deliveries] of byUser) {
        const account = deliveries[0]!.user.discordAccount;
        if (!account || deliveries[0]!.user.status !== "ACTIVE") {
          await prisma.notificationDelivery.updateMany({
            where: { id: { in: deliveries.map((d) => d.id) } },
            data: { status: "CANCELLED", lastError: "compte inactif ou non lié" },
          });
          continue;
        }

        // Période silencieuse : reporter à la fin de la fenêtre
        const prefs = await prisma.notificationPreference.findMany({ where: { userId } });
        const quiet = prefs.find((p) => inQuietHours(p));
        if (quiet) {
          const resume = new Date();
          resume.setHours(quiet.quietHourEnd ?? 8, 0, 0, 0);
          if (resume <= new Date()) resume.setDate(resume.getDate() + 1);
          await prisma.notificationDelivery.updateMany({
            where: { id: { in: deliveries.map((d) => d.id) } },
            data: { nextAttemptAt: resume },
          });
          continue;
        }

        const content =
          deliveries.length === 1
            ? formatNotification(deliveries[0]!.event, deliveries[0]!.payload as NotificationPayload)
            : formatDigest(
                deliveries.map((d) => ({
                  event: d.event,
                  payload: d.payload as NotificationPayload,
                })),
              );

        try {
          const discordUser = await client.users.fetch(account.discordId);
          await discordUser.send(content);
          await prisma.notificationDelivery.updateMany({
            where: { id: { in: deliveries.map((d) => d.id) } },
            data: { status: "SENT", sentAt: new Date() },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 300) : "erreur inconnue";
          for (const delivery of deliveries) {
            const attempts = delivery.attempts + 1;
            await prisma.notificationDelivery.update({
              where: { id: delivery.id },
              data: {
                attempts,
                lastError: message,
                status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
                nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
              },
            });
          }
          console.error(`[dispatcher] DM impossible vers ${account.discordId}: ${message}`);
        }
      }
    } catch (error) {
      console.error("[dispatcher] erreur de boucle :", error);
    } finally {
      running = false;
    }
  };

  setInterval(tick, POLL_INTERVAL_MS);
  void tick();
  console.log("[dispatcher] démarré (poll 15 s)");
}
