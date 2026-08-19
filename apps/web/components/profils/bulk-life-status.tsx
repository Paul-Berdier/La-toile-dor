"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetLifeStatusAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

/**
 * Sélection multiple des dossiers — MODÉRATION.
 *
 * Après un événement RP (bataille, purge), la modération coche une série de
 * dossiers sur la liste et fixe leur état vital d'un geste, sans ouvrir
 * chaque formulaire. Le provider enveloppe la grille (rendue côté serveur) ;
 * chaque carte y insère une case ; la barre d'action apparaît dès qu'un
 * dossier est coché. La règle serveur (`bulkSetLifeStatusAction`) revérifie
 * tout — la sélection n'est qu'une commodité d'interface.
 */

interface BulkSelection {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

const BulkSelectContext = createContext<BulkSelection | null>(null);

export function BulkSelectProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo(() => ({ selected, toggle, clear }), [selected, toggle, clear]);
  return <BulkSelectContext.Provider value={value}>{children}</BulkSelectContext.Provider>;
}

/** Case à cocher d'une carte. Ne rend rien hors d'un provider (non-modérateur). */
export function BulkSelectCheckbox({ profileId, name }: { profileId: string; name: string }) {
  const ctx = useContext(BulkSelectContext);
  if (!ctx) return null;
  return (
    <label className="flex min-h-[1.75rem] cursor-pointer items-center gap-1.5 text-[0.65rem] uppercase tracking-wider text-ink-faint hover:text-ink">
      <input
        type="checkbox"
        checked={ctx.selected.has(profileId)}
        onChange={() => ctx.toggle(profileId)}
        aria-label={`Sélectionner ${name}`}
      />
      Sélection
    </label>
  );
}

/** Barre d'action flottante : visible dès qu'au moins un dossier est coché. */
export function BulkLifeStatusBar() {
  const ctx = useContext(BulkSelectContext);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (!ctx) return null;
  const count = ctx.selected.size;
  if (count === 0 && !done) return null;

  const apply = (lifeStatus: "DEAD" | "ALIVE") => {
    const verb = lifeStatus === "DEAD" ? "MORT" : "VIVANT";
    if (!window.confirm(`Passer ${count} dossier${count > 1 ? "s" : ""} à l'état « ${verb} » ?`)) return;
    startTransition(async () => {
      const res = await bulkSetLifeStatusAction({ profileIds: [...ctx.selected], lifeStatus });
      if (!res.ok) {
        setError(res.error ?? "Le traitement a échoué.");
        setDone(null);
        return;
      }
      setError(null);
      setDone(
        `${res.updated ?? 0} dossier${(res.updated ?? 0) > 1 ? "s" : ""} passé${(res.updated ?? 0) > 1 ? "s" : ""} à « ${verb} »` +
          ((res.skipped ?? 0) > 0 ? ` — ${res.skipped} inchangé${(res.skipped ?? 0) > 1 ? "s" : ""}` : ""),
      );
      ctx.clear();
      router.refresh();
    });
  };

  return (
    <div
      role="region"
      aria-label="Actions sur la sélection"
      className="sticky bottom-16 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 border border-border-gold bg-obsidian/95 px-3 py-2 shadow-card backdrop-blur md:bottom-4"
    >
      <p className="text-xs text-ink">
        {count > 0 ? (
          <>
            <span className="font-mono-toile text-gold">{count}</span> dossier{count > 1 ? "s" : ""} sélectionné
            {count > 1 ? "s" : ""}
          </>
        ) : (
          <span className="text-gold">{done}</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
        {count > 0 ? (
          <>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => apply("DEAD")}>
              <span aria-hidden className="mr-1 text-blood-bright">✕</span>
              Marquer mort{count > 1 ? "s" : ""}
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => apply("ALIVE")}>
              Rétablir vivant{count > 1 ? "s" : ""}
            </Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => { ctx.clear(); setDone(null); }}>
              Annuler
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setDone(null)}>
            Fermer
          </Button>
        )}
      </div>
    </div>
  );
}
