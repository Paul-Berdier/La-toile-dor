"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface FilterOption {
  value: string;
  label: string;
}

export interface ProfileFilterState {
  q: string;
  faction: string;
  clan: string;
  etat: string;
  acces: string;
  // ── Recherche avancée (modération) ──
  nature: string;
  kg: string;
  technique: string;
  artefact: string;
  style: string;
  grade: string;
  sexe: string;
  portrait: string;
}

/** Champs avancés : repliés par défaut, ils n'encombrent pas la recherche courante. */
const ADVANCED_KEYS = [
  "nature",
  "kg",
  "technique",
  "artefact",
  "style",
  "grade",
  "sexe",
  "portrait",
] as const;

/**
 * Filtres de la liste des dossiers, appliqués au fil de la frappe.
 *
 * La recherche textuelle est temporisée (250 ms) puis poussée dans l'URL par
 * `router.replace` : l'adresse reste partageable et le retour arrière ne se
 * remplit pas d'un état par caractère. Les listes déroulantes s'appliquent
 * immédiatement — l'utilisateur a fini de choisir.
 *
 * Les filtres révélant une information protégée (faction, clan, état) ne sont
 * rendus que pour la modération ; le serveur les ignore de toute façon pour
 * les autres lecteurs.
 */
export function ProfileFilters({
  initial,
  canViewAll,
  factions,
  clans,
  lifeStatuses,
  natures,
  kekkeiGenkai,
  clanTechniques,
  artifacts,
  combatStyles,
  ranks,
  missionId,
}: {
  initial: ProfileFilterState;
  canViewAll: boolean;
  factions: FilterOption[];
  clans: FilterOption[];
  lifeStatuses: FilterOption[];
  natures: FilterOption[];
  kekkeiGenkai: FilterOption[];
  clanTechniques: FilterOption[];
  artifacts: FilterOption[];
  combatStyles: FilterOption[];
  ranks: FilterOption[];
  missionId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProfileFilterState>(initial);
  const [isPending, startTransition] = useTransition();
  const firstRender = useRef(true);
  // Ouvert d'emblée si une recherche avancée est déjà en cours : sinon les
  // critères actifs seraient invisibles et les résultats inexplicables.
  const [advancedOpen, setAdvancedOpen] = useState(
    ADVANCED_KEYS.some((key) => Boolean(initial[key])),
  );

  const apply = (next: ProfileFilterState) => {
    const sp = new URLSearchParams();
    if (missionId) sp.set("mission", missionId);
    if (next.q.trim()) sp.set("q", next.q.trim());
    if (canViewAll) {
      if (next.faction) sp.set("faction", next.faction);
      if (next.clan) sp.set("clan", next.clan);
      if (next.etat) sp.set("etat", next.etat);
      for (const key of ADVANCED_KEYS) {
        if (next[key]) sp.set(key, next[key]);
      }
    } else if (next.acces) {
      sp.set("acces", next.acces);
    }
    const query = sp.toString();
    startTransition(() => {
      router.replace(query ? `/profils?${query}` : "/profils", { scroll: false });
    });
  };

  // Recherche textuelle : temporisée pour ne pas requêter à chaque touche
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => apply(state), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.q]);

  /** Les listes déroulantes s'appliquent sans délai. */
  const setNow = (patch: Partial<ProfileFilterState>) => {
    const next = { ...state, ...patch };
    setState(next);
    apply(next);
  };

  const selectCls =
    "border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink focus:border-gold";

  const activeAdvanced = ADVANCED_KEYS.filter((key) => Boolean(state[key])).length;

  /** Un critère avancé : liste déroulante étiquetée, appliquée sans délai. */
  const advanced = (
    key: (typeof ADVANCED_KEYS)[number],
    label: string,
    options: FilterOption[],
  ) => (
    <div key={key}>
      <label
        htmlFor={`prf-${key}`}
        className="mb-1 block text-[0.6rem] uppercase tracking-wider text-ink-faint"
      >
        {label}
      </label>
      <select
        id={`prf-${key}`}
        value={state[key]}
        onChange={(e) => setNow({ [key]: e.target.value } as Partial<ProfileFilterState>)}
        className={`${selectCls} w-full`}
      >
        <option value="">— indifférent —</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="mt-5 border border-border-default bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <label htmlFor="prf-q" className="sr-only">
            Rechercher un dossier
          </label>
          <input
            id="prf-q"
            type="search"
            value={state.q}
            onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))}
            placeholder={canViewAll ? "Prénom, nom ou code (PRF-…)" : "Prénom ou code (PRF-…)"}
            autoComplete="off"
            className="w-full border border-border-default bg-elevated px-3 py-1.5 pr-8 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
          />
          {/* Témoin d'activité : la recherche est vivante, sans bouton */}
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-display text-xs transition-opacity ${
              isPending ? "animate-pulse text-gold opacity-100" : "text-ink-faint opacity-40"
            }`}
          >
            探
          </span>
        </div>

        {canViewAll && (
          <>
            <select
              value={state.faction}
              onChange={(e) => setNow({ faction: e.target.value })}
              aria-label="Faction"
              className={selectCls}
            >
              <option value="">Faction — toutes</option>
              {factions.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={state.clan}
              onChange={(e) => setNow({ clan: e.target.value })}
              aria-label="Clan"
              className={selectCls}
            >
              <option value="">Clan — tous</option>
              {clans.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={state.etat}
              onChange={(e) => setNow({ etat: e.target.value })}
              aria-label="État"
              className={selectCls}
            >
              <option value="">État — tous</option>
              {lifeStatuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        )}

        {!canViewAll && (
          <select
            value={state.acces}
            onChange={(e) => setNow({ acces: e.target.value })}
            aria-label="Accès"
            className={selectCls}
          >
            <option value="">Tous les dossiers</option>
            <option value="granted">Accès obtenu</option>
            <option value="pending">Demande en attente</option>
            <option value="refused">Demande refusée</option>
          </select>
        )}

        {canViewAll && (
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className={`border px-2 py-1.5 text-xs transition-colors ${
              advancedOpen || activeAdvanced > 0
                ? "border-gold text-gold"
                : "border-border-default text-ink-faint hover:border-border-gold hover:text-ink"
            }`}
          >
            Recherche avancée
            {activeAdvanced > 0 && (
              <span className="ml-1.5 font-mono-toile text-[0.65rem]">{activeAdvanced}</span>
            )}
          </button>
        )}

        {(state.q || state.faction || state.clan || state.etat || state.acces || activeAdvanced > 0) && (
          <button
            type="button"
            onClick={() => {
              const cleared: ProfileFilterState = {
                q: "", faction: "", clan: "", etat: "", acces: "",
                nature: "", kg: "", technique: "", artefact: "",
                style: "", grade: "", sexe: "", portrait: "",
              };
              setState(cleared);
              apply(cleared);
            }}
            className="px-2 py-1.5 text-xs text-ink-faint underline-offset-2 hover:text-gold hover:underline"
          >
            Effacer
          </button>
        )}
      </div>

      {/* Recherche avancée : les critères se cumulent en ET — « Fûton ET
          Sharingan » répond à une vraie question d'enquête, là où un OU
          noierait le résultat. */}
      {canViewAll && advancedOpen && (
        <div className="mt-3 grid gap-3 border-t border-border-default pt-3 sm:grid-cols-3 lg:grid-cols-4">
          {advanced("nature", "Nature de chakra", natures)}
          {advanced("kg", "Kekkei Genkai", kekkeiGenkai)}
          {advanced("technique", "Technique de clan", clanTechniques)}
          {advanced("artefact", "Artefact", artifacts)}
          {advanced("style", "Style de combat", combatStyles)}
          {advanced("grade", "Grade", ranks)}
          {advanced("sexe", "Sexe", [
            { value: "MALE", label: "Masculin" },
            { value: "FEMALE", label: "Féminin" },
            { value: "OTHER", label: "Autre" },
          ])}
          {advanced("portrait", "Portrait", [{ value: "1", label: "Avec portrait" }])}
          <p className="text-[0.65rem] leading-relaxed text-ink-faint sm:col-span-3 lg:col-span-4">
            Les critères se cumulent : un dossier doit satisfaire tous ceux qui sont
            renseignés.
          </p>
        </div>
      )}
    </div>
  );
}
