"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMissionTargetAction,
  removeMissionTargetAction,
  setMissionTargetOutcomeAction,
} from "@/server/missions/target-actions";
import { Button } from "@/components/ui/button";

export interface MissionTargetRow {
  id: string;
  profileId: string | null;
  profileCode: string | null;
  profileName: string | null;
  label: string | null;
  outcome: string;
  note: string | null;
  /** Renseignements déjà acquis sur ce dossier */
  knownFields: number;
}

const OUTCOMES: [string, string][] = [
  ["UNKNOWN", "Sort inconnu"],
  ["ELIMINATED", "Éliminée"],
  ["CAPTURED", "Capturée vivante"],
  ["ESCAPED", "En fuite"],
  ["UNHARMED", "Épargnée"],
  ["MISSING", "Disparue"],
];

/**
 * Cibles d'une mission et leur sort.
 *
 * Une mission peut en viser plusieurs, et « accomplie » ne veut pas dire que
 * toutes sont mortes : chaque cible a donc son propre sort. C'est ce sort qui,
 * à la clôture, met à jour l'état vital du dossier et ouvre l'accès aux
 * groupes qui ont fait le travail.
 */
export function MissionTargets({
  missionId,
  targets,
  minFields,
}: {
  missionId: string;
  targets: MissionTargetRow[];
  /** Renseignements attendus par cible, selon la règle en vigueur */
  minFields: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; code: string; firstName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profils/recherche?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) setResults(await res.json());
      } catch {
        // Frappe suivante : requête annulée
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "L'opération a échoué.");
      else {
        setError(null);
        setQuery("");
        setResults([]);
        router.refresh();
      }
    });

  return (
    <section className="border border-border-default bg-raised p-4">
      <h2 className="mb-1 font-display text-sm tracking-widest text-gold uppercase">
        Cibles de la mission
      </h2>
      <p className="mb-3 text-xs text-ink-faint">
        Les groupes attribués lisent les dossiers des cibles pendant la mission. À la clôture,
        le sort de chaque cible met son dossier à jour et l&rsquo;accès leur reste acquis.
      </p>

      <ul className="space-y-2">
        {targets.map((target) => (
          <li key={target.id} className="border border-border-default bg-elevated p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                {target.profileId ? (
                  <Link
                    href={`/profils/${target.profileId}`}
                    className="text-sm text-ink hover:text-gold"
                  >
                    {target.profileName}
                    <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">
                      {target.profileCode}
                    </span>
                  </Link>
                ) : (
                  <span className="text-sm text-ink-muted">
                    {target.label}
                    <span className="ml-1.5 text-[0.65rem] text-warning">sans dossier</span>
                  </span>
                )}
                {target.profileId && (
                  <p
                    className={`text-[0.65rem] ${
                      target.knownFields < minFields ? "text-warning" : "text-ink-faint"
                    }`}
                  >
                    {target.knownFields} renseignement{target.knownFields > 1 ? "s" : ""} acquis
                    {target.knownFields < minFields && ` — ${minFields} attendus`}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Retirer cette cible"
                disabled={isPending}
                onClick={() => run(() => removeMissionTargetAction(target.id))}
                className="text-ink-faint hover:text-blood-bright"
              >
                ✕
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`outcome-${target.id}`}>
                Sort de la cible
              </label>
              <select
                id={`outcome-${target.id}`}
                value={target.outcome}
                disabled={isPending}
                onChange={(e) =>
                  run(() =>
                    setMissionTargetOutcomeAction({
                      targetId: target.id,
                      outcome: e.target.value,
                    }),
                  )
                }
                className={`border bg-raised px-2 py-1 text-xs ${
                  target.outcome === "UNKNOWN"
                    ? "border-warning/60 text-warning"
                    : target.outcome === "ELIMINATED"
                      ? "border-blood/60 text-blood-bright"
                      : "border-border-gold text-ink-muted"
                }`}
              >
                {OUTCOMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {target.note && (
                <span className="text-[0.65rem] text-ink-faint italic">{target.note}</span>
              )}
            </div>
          </li>
        ))}
        {targets.length === 0 && (
          <li className="border border-dashed border-border-default p-3 text-center text-xs text-ink-faint italic">
            Aucune cible rattachée.
          </li>
        )}
      </ul>

      {/* Ajout d'une cible */}
      <div className="mt-3 space-y-2 border-t border-border-default pt-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ajouter une cible — prénom ou code"
          aria-label="Ajouter une cible"
          autoComplete="off"
          className="w-full border border-border-default bg-elevated px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
        />
        {results.length > 0 && (
          <ul className="max-h-32 space-y-0.5 overflow-y-auto">
            {results.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(() => addMissionTargetAction({ missionId, profileId: profile.id }))
                  }
                  className="w-full px-2 py-1 text-left text-xs text-ink-muted hover:bg-hover-bg hover:text-gold"
                >
                  {profile.firstName}
                  <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">
                    {profile.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() =>
                addMissionTargetAction({ missionId, newProfileFirstName: query.trim() }),
              )
            }
          >
            Ouvrir un dossier « {query.trim()} » et le viser
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-blood-bright">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
