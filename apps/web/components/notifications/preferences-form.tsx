"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveNotificationPreferencesAction } from "@/server/notification-preference-actions";
import { Button } from "@/components/ui/button";

export interface EventSetting {
  event: string;
  glyph: string;
  label: string;
  enabled: boolean;
}

const RANKS = ["D", "C", "B", "A", "S", "SS"] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function PreferencesForm({
  baseEvents,
  moderationEvents,
  missionAvailableRanks,
  quietHourStart,
  quietHourEnd,
}: {
  baseEvents: EventSetting[];
  /** Vide pour les non-modérateurs. */
  moderationEvents: EventSetting[];
  missionAvailableRanks: string[];
  quietHourStart: number | null;
  quietHourEnd: number | null;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...baseEvents, ...moderationEvents].map((e) => [e.event, e.enabled]),
    ),
  );
  const [ranks, setRanks] = useState<Set<string>>(new Set(missionAvailableRanks));
  const [quietOn, setQuietOn] = useState(quietHourStart !== null);
  const [start, setStart] = useState(quietHourStart ?? 23);
  const [end, setEnd] = useState(quietHourEnd ?? 8);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (event: string) => {
    setFeedback(null);
    setEnabled((current) => ({ ...current, [event]: !current[event] }));
  };

  const toggleRank = (rank: string) => {
    setFeedback(null);
    setRanks((current) => {
      const next = new Set(current);
      if (next.has(rank)) next.delete(rank);
      else next.add(rank);
      return next;
    });
  };

  const save = () => {
    startTransition(async () => {
      const res = await saveNotificationPreferencesAction({
        events: Object.entries(enabled).map(([event, value]) => ({ event, enabled: value })),
        missionAvailableRanks: [...ranks],
        quietHourStart: quietOn ? start : null,
        quietHourEnd: quietOn ? end : null,
      });
      if (res.ok) {
        setFeedback({ ok: true, text: "Réglages tissés. La Toile s'en souviendra." });
        router.refresh();
      } else {
        setFeedback({ ok: false, text: res.error ?? "Échec de l'enregistrement." });
      }
    });
  };

  const renderEvent = (setting: EventSetting) => (
    <li key={setting.event}>
      <label className="flex cursor-pointer items-start gap-3 py-1.5">
        <input
          type="checkbox"
          checked={enabled[setting.event] ?? true}
          onChange={() => toggle(setting.event)}
          className="mt-0.5 accent-[var(--toile-gold)]"
        />
        <span aria-hidden className="w-5 shrink-0 text-center font-display text-gold-dim">
          {setting.glyph}
        </span>
        <span className={`text-sm ${enabled[setting.event] ? "text-ink-muted" : "text-ink-faint line-through"}`}>
          {setting.label}
        </span>
      </label>
      {setting.event === "MISSION_AVAILABLE" && enabled[setting.event] && (
        <div className="mt-1 mb-2 ml-8 flex flex-wrap items-center gap-2">
          <span className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
            Rangs surveillés
          </span>
          {RANKS.map((rank) => (
            <label
              key={rank}
              className={`cursor-pointer border px-2 py-0.5 font-mono-toile text-xs ${
                ranks.has(rank)
                  ? "border-gold text-gold"
                  : "border-border-default text-ink-faint hover:border-border-gold"
              }`}
            >
              <input
                type="checkbox"
                checked={ranks.has(rank)}
                onChange={() => toggleRank(rank)}
                className="sr-only"
              />
              {rank}
            </label>
          ))}
          <span className="text-[0.6rem] text-ink-faint italic">aucun coché = tous</span>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <ul>{baseEvents.map(renderEvent)}</ul>

      {moderationEvents.length > 0 && (
        <div>
          <p className="mb-1 border-t border-border-default pt-3 text-[0.65rem] uppercase tracking-widest text-ink-faint">
            Échos de modération
          </p>
          <ul>{moderationEvents.map(renderEvent)}</ul>
        </div>
      )}

      <div className="border-t border-border-default pt-3">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={quietOn}
            onChange={(e) => {
              setFeedback(null);
              setQuietOn(e.target.checked);
            }}
            className="accent-[var(--toile-gold)]"
          />
          <span className="text-sm text-ink-muted">Période silencieuse (heure de Paris du serveur)</span>
        </label>
        {quietOn && (
          <div className="mt-2 ml-8 flex items-center gap-2 text-sm text-ink-muted">
            de
            <select
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              className="border border-border-default bg-elevated px-2 py-1 text-sm text-ink"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h} h</option>
              ))}
            </select>
            à
            <select
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
              className="border border-border-default bg-elevated px-2 py-1 text-sm text-ink"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{h} h</option>
              ))}
            </select>
          </div>
        )}
        <p className="mt-2 text-[0.65rem] text-ink-faint">
          Pendant cette fenêtre, les messages Discord attendent la fin du silence ;
          les échos restent visibles ici.
        </p>
      </div>

      {feedback && (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={`border px-3 py-2 text-xs ${
            feedback.ok
              ? "border-gold-dim bg-gold/5 text-gold"
              : "border-blood bg-blood/10 text-blood-bright"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <Button variant="outline" onClick={save} disabled={isPending}>
        {isPending ? "Tissage…" : "Enregistrer mes réglages"}
      </Button>
    </div>
  );
}
