import Link from "next/link";
import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Libellés des événements — remplace les DM Discord (mode sans bot). */
const EVENT_LABELS: Record<string, { glyph: string; text: string }> = {
  MISSION_AVAILABLE: { glyph: "🕸", text: "Un nouveau fil a été tendu sur la Toile" },
  CLAIM_ACCEPTED: { glyph: "承", text: "Votre revendication a été acceptée — le dossier vous est ouvert" },
  CLAIM_REJECTED: { glyph: "断", text: "Votre revendication a été refusée" },
  CLAIM_INFO_REQUESTED: { glyph: "問", text: "Le tisseur demande des précisions sur votre revendication" },
  MISSION_UPDATED: { glyph: "筆", text: "Le dossier d'un contrat attribué a été mis à jour" },
  MISSION_STATUS_CHANGED: { glyph: "変", text: "Le statut d'un contrat suivi a changé" },
  MISSION_DEADLINE_SOON: { glyph: "刻", text: "Un délai approche — moins d'un jour réel" },
  MISSION_EXPIRED: { glyph: "灰", text: "Un contrat a expiré" },
  MISSION_CANCELLED: { glyph: "断", text: "Un fil a été rompu — contrat annulé" },
  NEW_CLAIM: { glyph: "願", text: "Nouvelle revendication à examiner" },
  CLAIM_WITHDRAWN: { glyph: "退", text: "Une cellule retire sa revendication" },
  FINAL_REPORT_SUBMITTED: { glyph: "書", text: "Un rapport final a été transmis" },
  SYNC_ISSUE: { glyph: "乱", text: "Problème de synchronisation Discord" },
  ACCESS_DENIED_ALERT: { glyph: "警", text: "Tentatives d'accès refusées répétées" },
};

export default async function NotificationsPage() {
  const current = await requireUser();
  const userId = current.session.userId;

  const notifications = await prisma.notificationDelivery.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { mission: { select: { id: true } } },
  });

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
