import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import {
  EVENT_LABELS,
  BASE_CONFIGURABLE_EVENTS,
  MODERATION_CONFIGURABLE_EVENTS,
} from "@/lib/notification-events";
import { PreferencesForm, type EventSetting } from "@/components/notifications/preferences-form";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const current = await requireUser();
  const userId = current.session.userId;

  const [notifications, preferences] = await Promise.all([
    prisma.notificationDelivery.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { mission: { select: { id: true } } },
    }),
    prisma.notificationPreference.findMany({ where: { userId } }),
  ]);

  // Réglages : sans ligne en base, un événement est actif par défaut
  const prefByEvent = new Map(preferences.map((p) => [p.event as string, p]));
  const toSetting = (event: string): EventSetting => ({
    event,
    glyph: EVENT_LABELS[event]?.glyph ?? "糸",
    label: EVENT_LABELS[event]?.text ?? event,
    enabled: prefByEvent.get(event)?.enabled ?? true,
  });
  const isModerator =
    current.permissions.has(PERMISSIONS.CLAIM_REVIEW) ||
    current.permissions.has(PERMISSIONS.USER_LEVEL_MANAGE);
  const baseEvents = BASE_CONFIGURABLE_EVENTS.map(toSetting);
  const moderationEvents = isModerator ? MODERATION_CONFIGURABLE_EVENTS.map(toSetting) : [];
  const quietRow = preferences.find((p) => p.quietHourStart !== null);

  // Les échos affichés sont considérés comme lus
  const unreadIds = notifications.filter((n) => n.status === "PENDING").map((n) => n.id);
  if (unreadIds.length > 0) {
    await prisma.notificationDelivery.updateMany({
      where: { id: { in: unreadIds } },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Échos de la Toile
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Chaque frémissement du réseau qui vous concerne est consigné ici.
      </p>

      {/* Choix des échos reçus — appliqué ici comme en messages privés Discord */}
      <details className="mb-6 border border-border-default bg-raised">
        <summary className="cursor-pointer px-4 py-3 font-display text-sm tracking-widest text-gold uppercase hover:bg-hover-bg">
          Choisir mes échos
        </summary>
        <div className="border-t border-border-default p-4">
          <PreferencesForm
            baseEvents={baseEvents}
            moderationEvents={moderationEvents}
            missionAvailableRanks={(prefByEvent.get("MISSION_AVAILABLE")?.rankFilter ?? []) as string[]}
            quietHourStart={quietRow?.quietHourStart ?? null}
            quietHourEnd={quietRow?.quietHourEnd ?? null}
          />
        </div>
      </details>

      {notifications.length === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          La Toile est silencieuse. Aucun écho pour l&rsquo;instant.
        </p>
      )}

      <ol className="space-y-2">
        {notifications.map((notification) => {
          const label = EVENT_LABELS[notification.event] ?? {
            glyph: "糸",
            text: notification.event,
          };
          const payload = notification.payload as {
            code?: string;
            rank?: string;
            title?: string;
            note?: string | null;
          };
          const isNew = unreadIds.includes(notification.id);
          const body = (
            <>
              <span aria-hidden className="w-6 shrink-0 text-center font-display text-gold-dim">
                {label.glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${isNew ? "text-ink" : "text-ink-muted"}`}>
                  {label.text}
                  {isNew && (
                    <span className="ml-2 align-middle font-mono-toile text-[0.6rem] uppercase tracking-widest text-gold">
                      nouveau
                    </span>
                  )}
                </span>
                {(payload.code || payload.title) && (
                  <span className="block truncate text-xs text-ink-faint">
                    {[payload.rank ? `[${payload.rank}]` : null, payload.code, payload.title]
                      .filter(Boolean)
                      .join(" ")}
                  </span>
                )}
                {payload.note && (
                  <span className="block text-xs text-ink-faint italic">« {payload.note} »</span>
                )}
                <span className="block font-mono-toile text-[0.6rem] text-ink-faint">
                  {notification.createdAt.toLocaleString("fr-FR")}
                </span>
              </span>
            </>
          );

          return (
            <li key={notification.id}>
              {notification.mission ? (
                <Link
                  href={`/missions/${notification.mission.id}`}
                  className={`flex items-start gap-3 border p-3 transition-colors hover:border-border-gold hover:bg-hover-bg ${
                    isNew ? "border-gold-dim bg-raised" : "border-border-default bg-raised"
                  }`}
                >
                  {body}
                </Link>
              ) : (
                <div
                  className={`flex items-start gap-3 border p-3 ${
                    isNew ? "border-gold-dim bg-raised" : "border-border-default bg-raised"
                  }`}
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
