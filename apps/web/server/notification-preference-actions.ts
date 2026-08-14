"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@toile/database";
import type { MissionRank, NotificationEvent } from "@toile/database";
import { audit } from "@toile/auth";
import { requireUser, requestMeta } from "@/lib/session";
import { CONFIGURABLE_EVENTS } from "@/lib/notification-events";

interface Result {
  ok: boolean;
  error?: string;
}

const VALID_RANKS = ["D", "C", "B", "A", "S", "SS"] as const;

/**
 * Réglages d'échos de l'utilisateur COURANT uniquement : activation par
 * événement, rangs surveillés pour les annonces de nouveaux fils, période
 * silencieuse (heures locales, honorée par le bot Discord). Le filtrage
 * s'applique à l'enfilage — les échos déjà en file ne sont pas retirés.
 */
export async function saveNotificationPreferencesAction(input: {
  events: { event: string; enabled: boolean }[];
  /** Rangs surveillés pour MISSION_AVAILABLE — vide = tous les rangs. */
  missionAvailableRanks: string[];
  quietHourStart: number | null;
  quietHourEnd: number | null;
}): Promise<Result> {
  const current = await requireUser();
  const userId = current.session.userId;

  const known = new Set(CONFIGURABLE_EVENTS);
  const events = (input.events ?? []).filter(
    (e) => known.has(e.event) && typeof e.enabled === "boolean",
  );
  if (events.length === 0) return { ok: false, error: "Aucun réglage reçu." };

  const start = input.quietHourStart;
  const end = input.quietHourEnd;
  const validHour = (h: number | null) => h === null || (Number.isInteger(h) && h >= 0 && h <= 23);
  if (!validHour(start) || !validHour(end) || (start === null) !== (end === null)) {
    return { ok: false, error: "Période silencieuse invalide : deux heures entre 0 et 23." };
  }
  if (start !== null && start === end) {
    return { ok: false, error: "Période silencieuse invalide : heures de début et de fin identiques." };
  }

  const ranks = [...new Set(input.missionAvailableRanks ?? [])].filter((r) =>
    (VALID_RANKS as readonly string[]).includes(r),
  ) as MissionRank[];

  await prisma.$transaction(
    events.map(({ event, enabled }) => {
      const rankFilter = event === "MISSION_AVAILABLE" ? ranks : [];
      return prisma.notificationPreference.upsert({
        where: { userId_event: { userId, event: event as NotificationEvent } },
        // mutedUntil préservé : la sourdine temporaire (/toile) vit sa vie
        update: { enabled, quietHourStart: start, quietHourEnd: end, rankFilter },
        create: {
          userId,
          event: event as NotificationEvent,
          enabled,
          quietHourStart: start,
          quietHourEnd: end,
          rankFilter,
        },
      });
    }),
  );

  const meta = await requestMeta();
  await audit({
    actorId: userId,
    action: "notification.prefs_updated",
    resourceType: "user",
    resourceId: userId,
    newValues: {
      disabled: events.filter((e) => !e.enabled).map((e) => e.event),
      ranks: ranks.length > 0 ? ranks.join(",") : null,
      quietHours: start !== null ? `${start}h-${end}h` : null,
    },
    ...meta,
  });

  revalidatePath("/notifications");
  return { ok: true };
}
