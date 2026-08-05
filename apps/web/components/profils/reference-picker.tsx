"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { normalizeRefLabel } from "@toile/shared";
import { createInlineReferenceOptionAction } from "@/server/profiles/profile-actions";
import type { RefOption } from "./edit-form";

/** Types pour lesquels une teinte est proposée à la création. */
const COLOR_TYPES = new Set(["HAIR_COLOR", "SKIN_TONE"]);

/**
 * Sélecteur de référentiel : recherche tolérante aux accents et aux alias,
 * sélection multiple sous forme de tags, navigation clavier complète
 * (↑ ↓ Entrée Échap ⌫).
 *
 * Une valeur absente peut être AJOUTÉE directement lorsque le rédacteur
 * administre les référentiels (`canCreate`) ; sinon elle est proposée et
 * attend une validation. Sans cette saisie directe, compléter un dossier
 * butait sur toute valeur non prévue.
 */
export function ReferencePicker({
  legend,
  options,
  selected,
  onChange,
  onSuggest,
  referenceType,
  canCreate = false,
  onCreated,
  hideLegend = false,
  placeholder = "Rechercher…",
}: {
  legend: string;
  options: RefOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Ouvre la proposition d'une nouvelle entrée avec le texte saisi */
  onSuggest?: (label: string) => void;
  /** Référentiel visé (HAIR_COLOR, CLAN_FAMILY…) — requis pour créer */
  referenceType?: string;
  /** Le rédacteur peut-il créer l'entrée sans validation ? */
  canCreate?: boolean;
  /** Remonte l'entrée créée pour l'ajouter aux options affichées */
  onCreated?: (option: RefOption) => void;
  /**
   * Masque visuellement la légende sans la retirer de l'arbre d'accessibilité.
   * Utile lorsque le champ est déjà titré par son encadré d'état, où le
   * libellé apparaîtrait sinon deux fois de suite.
   */
  hideLegend?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const keepOpen = useRef(false);
  const [newColor, setNewColor] = useState("#8a7f6d");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, startCreate] = useTransition();

  const wantsColor = referenceType != null && COLOR_TYPES.has(referenceType);
  const directCreate = canCreate && referenceType != null;

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

  // Une saisie qui correspond exactement à une entrée existante ne doit pas
  // proposer de la recréer — c'est ainsi qu'on évite Uchiha / UCHIWA / Uchïha.
  const exactMatch = useMemo(() => {
    const q = normalizeRefLabel(query);
    return q.length > 0 && options.some((o) => normalizeRefLabel(o.label) === q);
  }, [options, query]);

  const add = (id: string) => {
    onChange([...selected, id]);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  };
  const remove = (id: string) => onChange(selected.filter((s) => s !== id));

  /** Crée l'entrée puis la sélectionne — l'action est idempotente. */
  const create = (label: string) => {
    if (!referenceType || isCreating) return;
    startCreate(async () => {
      const res = await createInlineReferenceOptionAction({
        type: referenceType,
        label,
        ...(wantsColor ? { colorHex: newColor } : {}),
      });
      if (!res.ok || !res.option) {
        setCreateError(res.error ?? "La création a échoué.");
        return;
      }
      setCreateError(null);
      onCreated?.({
        id: res.option.id,
        label: res.option.label,
        category: null,
        colorHex: res.option.colorHex,
        sourceScopeLabel: "Serveur",
      });
      onChange([...selected, res.option.id]);
      setQuery("");
      setOpen(false);
      inputRef.current?.focus();
    });
  };

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
      <legend
        className={
          hideLegend
            ? "sr-only"
            : "mb-1 block text-xs uppercase tracking-wider text-ink-faint"
        }
      >
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
          onBlur={() =>
            setTimeout(() => {
              // Le sélecteur de teinte vole le focus sans que la liste doive
              // se refermer : il a posé ce drapeau au mousedown.
              if (keepOpen.current) {
                keepOpen.current = false;
                inputRef.current?.focus();
                return;
              }
              setOpen(false);
            }, 150)
          }
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
            {/* Ajout d'une valeur absente, en pied de liste. Créée directement
                par qui administre les référentiels, proposée sinon. */}
            {query.trim().length >= 2 && !exactMatch && (directCreate || onSuggest) && (
              <li className="border-t border-border-default">
                {directCreate ? (
                  <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    {wantsColor && (
                      <label className="flex items-center gap-1 text-[0.65rem] text-ink-faint">
                        Teinte
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          // Ouvre le nuancier sans refermer la liste
                          onMouseDown={() => { keepOpen.current = true; }}
                          aria-label={`Teinte de « ${query.trim()} »`}
                          className="h-6 w-8 cursor-pointer border border-border-default bg-transparent p-0"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => create(query.trim())}
                      disabled={isCreating}
                      className="text-left text-xs text-gold hover:underline disabled:opacity-60"
                    >
                      {isCreating ? "Ajout…" : `Ajouter « ${query.trim()} » au référentiel`}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onSuggest?.(query.trim()); setQuery(""); setOpen(false); }}
                    className="w-full px-3 py-1.5 text-left text-xs text-copper hover:bg-hover-bg"
                  >
                    Proposer « {query.trim()} » comme nouvelle entrée…
                  </button>
                )}
                {createError && (
                  <p role="alert" className="px-3 pb-1.5 text-[0.65rem] text-blood-bright">
                    {createError}
                  </p>
                )}
              </li>
            )}
          </ul>
        )}
      </div>
    </fieldset>
  );
}
