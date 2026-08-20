"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Slider from "@radix-ui/react-slider";
import { MISSION_CATEGORIES, RANK_ORDER } from "@toile/shared";

const RYO_MAX = 20_000_000;

/** Barre de filtres du tableau — l'état vit dans l'URL (partageable). */
export function BoardFilters({ levels }: { levels: { slug: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const setParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const toggleCsv = (key: string, value: string) => {
    setParams((p) => {
      const list = p.get(key)?.split(",").filter(Boolean) ?? [];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      if (next.length > 0) p.set(key, next.join(","));
      else p.delete(key);
    });
  };

  const toggleFlag = (key: string) => {
    setParams((p) => {
      if (p.get(key) === "1") p.delete(key);
      else p.set(key, "1");
    });
  };

  // Recherche textuelle avec anti-rebond
  const [search, setSearch] = useState(params.get("q") ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setParams((p) => {
        if (value.trim()) p.set("q", value.trim());
        else p.delete("q");
      });
    }, 350);
  };

  // Fourchette de ryōs : double curseur + champs numériques
  const urlRyoMin = Number(params.get("ryoMin") ?? 0) || 0;
  const urlRyoMax = Number(params.get("ryoMax") ?? RYO_MAX) || RYO_MAX;
  const [ryo, setRyo] = useState<[number, number]>([urlRyoMin, urlRyoMax]);
  useEffect(() => setRyo([urlRyoMin, urlRyoMax]), [urlRyoMin, urlRyoMax]);
  const commitRyo = (range: [number, number]) => {
    setParams((p) => {
      if (range[0] > 0) p.set("ryoMin", String(range[0]));
      else p.delete("ryoMin");
      if (range[1] < RYO_MAX) p.set("ryoMax", String(range[1]));
      else p.delete("ryoMax");
    });
  };

  const selectedRanks = params.get("rank")?.split(",").filter(Boolean) ?? [];
  const selectedCategories = params.get("category")?.split(",").filter(Boolean) ?? [];
  const selectedLevels = params.get("level")?.split(",").filter(Boolean) ?? [];

  const activeFilters = useMemo(() => {
    const chips: { label: string; clear: () => void }[] = [];
    if (params.get("q")) chips.push({ label: `« ${params.get("q")} »`, clear: () => { setSearch(""); setParams((p) => p.delete("q")); } });
    for (const r of selectedRanks) chips.push({ label: `Rang ${r}`, clear: () => toggleCsv("rank", r) });
    for (const c of selectedCategories) {
      const label = MISSION_CATEGORIES.find((mc) => mc.value === c)?.label ?? c;
      chips.push({ label, clear: () => toggleCsv("category", c) });
    }
    for (const l of selectedLevels) {
      chips.push({ label: levels.find((lv) => lv.slug === l)?.label ?? l, clear: () => toggleCsv("level", l) });
    }
    if (params.get("ryoMin") || params.get("ryoMax")) {
      chips.push({ label: `Ryōs ${urlRyoMin.toLocaleString("fr-FR")} – ${urlRyoMax.toLocaleString("fr-FR")}`, clear: () => commitRyo([0, RYO_MAX]) });
    }
    if (params.get("compatible") === "1") chips.push({ label: "Compatibles avec mon groupe", clear: () => toggleFlag("compatible") });
    if (params.get("claimed") === "1") chips.push({ label: "Revendiquées", clear: () => toggleFlag("claimed") });
    if (params.get("noLimit") === "1") chips.push({ label: "Sans limite de temps", clear: () => toggleFlag("noLimit") });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, levels]);

  return (
    <div className="mb-4 border border-border-default bg-raised">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <label htmlFor="board-search" className="sr-only">
          Recherche
        </label>
        <input
          id="board-search"
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Chercher un fil — code, titre, résumé…"
          className="w-full max-w-xs border border-border-default bg-elevated px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold sm:w-auto"
        />

        {/* Rangs en accès direct */}
        <div className="flex gap-1" role="group" aria-label="Filtrer par rang">
          {RANK_ORDER.map((rank) => (
            <button
              key={rank}
              type="button"
              onClick={() => toggleCsv("rank", rank)}
              aria-pressed={selectedRanks.includes(rank)}
              className={`border px-2 py-1 font-display text-xs transition-colors ${
                selectedRanks.includes(rank)
                  ? "border-gold bg-gold text-obsidian"
                  : "border-border-default text-ink-muted hover:border-border-gold hover:text-gold"
              }`}
            >
              {rank}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="ml-auto border border-border-default px-3 py-1.5 text-xs text-ink-muted hover:border-border-gold hover:text-gold"
        >
          {open ? "Replier les filtres" : "Filtres avancés"}
        </button>
      </div>

      {/* Filtres RAPIDES : les trois questions qu'on se pose vraiment devant
          un tableau — qu'est-ce qui presse, qu'est-ce qui attend une équipe,
          qu'est-ce qui a déjà des candidats. Un clic, pas un panneau. */}
      <div className="flex flex-wrap gap-1.5 border-t border-border-default px-3 py-2" role="group" aria-label="Filtres rapides">
        {([
          ["urgent", "⏳ Expire sous 48 h"],
          ["sansEquipe", "Sans équipe"],
          ["claimed", "Avec candidatures"],
          ["compatible", "Pour mes groupes"],
          ["noLimit", "Sans limite de temps"],
        ] as const).map(([key, label]) => {
          const active = params.get(key) === "1";
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleFlag(key)}
              aria-pressed={active}
              className={`border px-2 py-1 text-[0.7rem] transition-colors ${
                active
                  ? "border-gold bg-gold-faint/20 text-gold"
                  : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="grid gap-4 border-t border-border-default p-3 sm:grid-cols-2 lg:grid-cols-3">
          <fieldset>
            <legend className="mb-1 text-xs text-ink-faint uppercase tracking-wider">Catégorie</legend>
            <div className="flex flex-wrap gap-1">
              {MISSION_CATEGORIES.map((category) => (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => toggleCsv("category", category.value)}
                  aria-pressed={selectedCategories.includes(category.value)}
                  className={`border px-2 py-1 text-[0.7rem] transition-colors ${
                    selectedCategories.includes(category.value)
                      ? "border-gold text-gold"
                      : "border-border-default text-ink-muted hover:text-ink"
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-xs text-ink-faint uppercase tracking-wider">Niveau cible</legend>
            <div className="flex flex-wrap gap-1">
              {levels.map((level) => (
                <button
                  key={level.slug}
                  type="button"
                  onClick={() => toggleCsv("level", level.slug)}
                  aria-pressed={selectedLevels.includes(level.slug)}
                  className={`border px-2 py-1 text-[0.7rem] transition-colors ${
                    selectedLevels.includes(level.slug)
                      ? "border-gold text-gold"
                      : "border-border-default text-ink-muted hover:text-ink"
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <p className="mb-1 text-xs text-ink-faint uppercase tracking-wider">Fourchette de ryōs</p>
            <Slider.Root
              className="relative flex h-5 w-full touch-none items-center select-none"
              min={0}
              max={RYO_MAX}
              step={10_000}
              value={ryo}
              onValueChange={(v) => setRyo(v as [number, number])}
              onValueCommit={(v) => commitRyo(v as [number, number])}
            >
              <Slider.Track className="relative h-px flex-1 bg-border-strong">
                <Slider.Range className="absolute h-px bg-gold" />
              </Slider.Track>
              {[0, 1].map((i) => (
                <Slider.Thumb
                  key={i}
                  aria-label={i === 0 ? "Ryōs minimum" : "Ryōs maximum"}
                  className="block h-3.5 w-3.5 rotate-45 border border-gold bg-elevated hover:bg-gold focus:outline-2 focus:outline-gold-bright"
                />
              ))}
            </Slider.Root>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                aria-label="Ryōs minimum"
                value={ryo[0]}
                min={0}
                max={RYO_MAX}
                step={10_000}
                onChange={(e) => setRyo([Number(e.target.value) || 0, ryo[1]])}
                onBlur={() => commitRyo(ryo)}
                className="w-28 border border-border-default bg-elevated px-2 py-1 text-xs text-ink"
              />
              <span aria-hidden className="text-ink-faint">–</span>
              <input
                type="number"
                aria-label="Ryōs maximum"
                value={ryo[1]}
                min={0}
                max={RYO_MAX}
                step={10_000}
                onChange={(e) => setRyo([ryo[0], Number(e.target.value) || RYO_MAX])}
                onBlur={() => commitRyo(ryo)}
                className="w-28 border border-border-default bg-elevated px-2 py-1 text-xs text-ink"
              />
            </div>
          </div>

          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="sr-only">Options</legend>
            <div className="flex flex-wrap gap-3">
              {[
                { key: "compatible", label: "Compatibles avec mon groupe" },
                { key: "claimed", label: "Revendiquées" },
                { key: "noLimit", label: "Sans limite de temps" },
              ].map((option) => (
                <label key={option.key} className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={params.get(option.key) === "1"}
                    onChange={() => toggleFlag(option.key)}
                    className="accent-[var(--toile-gold)]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-default p-2">
          <span className="text-[0.65rem] uppercase tracking-wider text-ink-faint">Fils tendus :</span>
          {activeFilters.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={chip.clear}
              className="group flex items-center gap-1.5 border border-gold-dim bg-elevated px-2 py-0.5 text-[0.7rem] text-gold hover:border-blood-bright hover:text-blood-bright"
            >
              {chip.label}
              <span aria-hidden>✕</span>
              <span className="sr-only">Retirer le filtre</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => router.replace(pathname, { scroll: false })}
            className="ml-1 text-[0.7rem] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
          >
            Tout couper
          </button>
        </div>
      )}
    </div>
  );
}
