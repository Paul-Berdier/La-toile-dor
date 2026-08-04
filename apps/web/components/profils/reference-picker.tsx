"use client";

import { useId, useMemo, useRef, useState } from "react";
import { normalizeRefLabel } from "@toile/shared";
import type { RefOption } from "./edit-form";

/**
 * Sélecteur de référentiel : recherche tolérante aux accents et aux alias,
 * sélection multiple sous forme de tags, navigation clavier complète
 * (↑ ↓ Entrée Échap ⌫), et proposition d'une valeur absente.
 */
export function ReferencePicker({
  legend,
  options,
  selected,
  onChange,
  onSuggest,
  placeholder = "Rechercher…",
}: {
  legend: string;
  options: RefOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Ouvre la proposition d'une nouvelle entrée avec le texte saisi */
  onSuggest?: (label: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  // Recherche : libellé OU alias, insensible aux accents et à la casse
  const matches = useMemo(() => {
    const q = normalizeRefLabel(query);
    const pool = options.filter((o) => !selected.includes(o.id));
    if (!q) return pool.slice(0, 8);
    return pool
      .filter((o) => {
        const haystack = [o.label, ...(o.aliases ?? [])].map(normalizeRefLabel);
        return haystack.some((h) => h.includes(q));
      })
      .slice(0, 8);
  }, [options, selected, query]);

  const add = (id: string) => {
    onChange([...selected, id]);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  };
  const remove = (id: string) => onChange(selected.filter((s) => s !== id));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = matches[highlight];
      if (option) add(option.id);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && query === "" && selected.length > 0) {
      // Retirer le dernier tag quand le champ est vide
      remove(selected[selected.length - 1]!);
    }
  };

  return (
    <fieldset>
      <legend className="mb-1 block text-xs uppercase tracking-wider text-ink-faint">
        {legend}
      </legend>

      {/* Tags sélectionnés */}
      {selected.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const option = byId.get(id);
            if (!option) return null;
            return (
              <li key={id}>
                <span className="inline-flex items-center gap-1 border border-gold bg-gold-faint/40 px-2 py-1 text-[0.7rem] text-gold">
                  {option.colorHex && (
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 border border-border-strong"
                      style={{ background: option.colorHex }}
                    />
                  )}
                  {option.label}
                  <span className="text-[0.55rem] text-ink-faint">{option.sourceScopeLabel}</span>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    aria-label={`Retirer ${option.label}`}
                    className="ml-0.5 text-gold-dim hover:text-blood-bright"
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={legend}
          value={query}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
        />

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-0.5 max-h-52 w-full overflow-y-auto border border-border-gold bg-elevated shadow-modal"
          >
            {matches.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-faint italic">
                Aucune entrée ne correspond.
              </li>
            )}
            {matches.map((option, index) => (
              <li key={option.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(option.id)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    index === highlight ? "bg-hover-bg text-gold" : "text-ink-muted"
                  }`}
                >
                  {option.colorHex && (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 shrink-0 border border-border-strong"
                      style={{ background: option.colorHex }}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                    {option.kanji && <span className="ml-1.5 text-xs text-ink-faint">{option.kanji}</span>}
                  </span>
                  <span className="shrink-0 text-[0.6rem] text-ink-faint">
                    {option.sourceScopeLabel}
                  </span>
                </button>
              </li>
            ))}
            {onSuggest && query.trim().length >= 2 && (
              <li className="border-t border-border-default">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onSuggest(query.trim()); setQuery(""); setOpen(false); }}
                  className="w-full px-3 py-1.5 text-left text-xs text-copper hover:bg-hover-bg"
                >
                  Proposer « {query.trim()} » comme nouvelle entrée…
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
