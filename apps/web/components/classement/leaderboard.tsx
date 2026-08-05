"use client";

import { useMemo, useState } from "react";

export interface LeaderRow {
  id: string;
  name: string;
  /** Rattachement ou précision affichée sous le nom */
  subtitle?: string | null;
  points: number;
  ryos: number;
  missions: number;
  /** Missions échouées — pour le taux de réussite (groupes et factions) */
  failed?: number;
  /** Nombre de groupes rassemblés (factions uniquement) */
  groupCount?: number;
}

type Scope = "groups" | "factions" | "agents";
type SortKey = "points" | "ryos";

const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ"];

/** Format compact des sommes : 1 240 000 → « 1,24 M ». */
function formatRyos(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(".", ",")} M`;
  if (value >= 10_000) return `${Math.round(value / 1000)} k`;
  return value.toLocaleString("fr-FR");
}

/**
 * Classement à trois échelles — agent, groupe, faction — car chacun veut
 * savoir ce qu'il a rapporté ET ce que les siens ont rapporté.
 *
 * Le tri bascule entre points et ryōs : les points mesurent le mérite accordé
 * par la Toile, les ryōs ce qui a réellement été touché. Les deux ne classent
 * pas dans le même ordre, et c'est justement l'information intéressante.
 */
export function Leaderboard({
  groups,
  factions,
  agents,
}: {
  groups: LeaderRow[];
  factions: LeaderRow[];
  agents: LeaderRow[];
}) {
  const [scope, setScope] = useState<Scope>("groups");
  const [sort, setSort] = useState<SortKey>("points");

  const rows = scope === "groups" ? groups : scope === "factions" ? factions : agents;

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (sort === "points" ? b.points - a.points : b.ryos - a.ryos) ||
          (sort === "points" ? b.ryos - a.ryos : b.points - a.points) ||
          a.name.localeCompare(a.name),
      ),
    [rows, sort],
  );
  const max = Math.max(1, ...sorted.map((r) => (sort === "points" ? r.points : r.ryos)));

  const tab = (value: Scope, label: string, glyph: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setScope(value)}
      aria-pressed={scope === value}
      className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors ${
        scope === value
          ? "border-gold text-gold"
          : "border-transparent text-ink-faint hover:text-ink"
      }`}
    >
      <span aria-hidden className="font-display text-base">
        {glyph}
      </span>
      {label}
      <span className="font-mono-toile text-[0.65rem] text-ink-faint">{count}</span>
    </button>
  );

  return (
    <section aria-label="Classements" className="border border-border-gold bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-gold px-2">
        <div className="flex flex-wrap">
          {tab("groups", "Groupes", "組", groups.length)}
          {tab("factions", "Factions", "旗", factions.length)}
          {tab("agents", "Agents", "者", agents.length)}
        </div>
        <div className="flex items-center gap-1 px-2 py-1.5">
          <span className="text-[0.6rem] uppercase tracking-wider text-ink-faint">Classer par</span>
          {(
            [
              ["points", "Points"],
              ["ryos", "Ryōs"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={`border px-2 py-0.5 text-[0.7rem] transition-colors ${
                sort === key
                  ? "border-gold bg-gold-faint/40 text-gold"
                  : "border-border-default text-ink-faint hover:border-border-gold hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-faint italic">
          Rien à départager pour cette période.
        </p>
      ) : (
        <ol className="divide-y divide-border-default">
          {sorted.map((row, index) => {
            const value = sort === "points" ? row.points : row.ryos;
            const share = Math.max(1.5, (value / max) * 100);
            const total = row.missions + (row.failed ?? 0);
            const successRate = total > 0 ? Math.round((row.missions / total) * 100) : null;
            return (
              <li key={row.id} className="relative">
                {/* Jauge en fond : la part se lit d'un coup d'œil, sans
                    colonne supplémentaire à déchiffrer. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-gold-faint/40"
                  style={{ width: `${share}%` }}
                />
                <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <span
                    className={`w-7 shrink-0 text-center font-display ${
                      index < 3 ? "text-lg text-gold" : "text-sm text-ink-faint"
                    }`}
                  >
                    {ROMAN[index] ?? index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{row.name}</span>
                    <span className="block truncate text-[0.65rem] text-ink-faint">
                      {[
                        row.subtitle,
                        row.groupCount != null
                          ? `${row.groupCount} groupe${row.groupCount > 1 ? "s" : ""}`
                          : null,
                        successRate !== null ? `${successRate} % de réussite` : null,
                        `${row.missions} mission${row.missions > 1 ? "s" : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block font-mono-toile text-sm ${
                        sort === "points" ? "text-gold" : "text-ink-muted"
                      }`}
                    >
                      {row.points.toLocaleString("fr-FR")} pts
                    </span>
                    <span
                      className={`block font-mono-toile text-xs ${
                        sort === "ryos" ? "text-gold" : "text-ink-faint"
                      }`}
                    >
                      <span aria-hidden className="mr-0.5">
                        両
                      </span>
                      {formatRyos(row.ryos)}
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
