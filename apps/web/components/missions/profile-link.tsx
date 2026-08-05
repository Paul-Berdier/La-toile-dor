"use client";

import { useEffect, useState, useTransition } from "react";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

interface Found {
  id: string;
  code: string;
  firstName: string;
}

/**
 * Rattache une cible ou un commanditaire à son dossier de renseignement.
 *
 * Le texte libre reste la source d'affichage — une cible peut n'être qu'une
 * rumeur sans dossier. Le lien, lui, permet d'ouvrir la fiche et de verser les
 * renseignements de la mission au bon endroit plutôt que d'ouvrir un second
 * dossier pour le même personnage.
 *
 * La recherche interroge la même route que l'éditeur de dossiers, réservée à
 * la modération : ce composant n'est rendu que dans le formulaire de création,
 * lui-même réservé aux mêmes personnes.
 */
export function ProfileLink({
  label,
  hint,
  value,
  onChange,
  /** Nom saisi dans le champ texte voisin — sert d'amorce à la recherche */
  suggestedName,
}: {
  label: string;
  hint: string;
  value: { id: string; label: string } | null;
  onChange: (next: { id: string; label: string } | null) => void;
  suggestedName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || query.trim().length < 2) {
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
        // Requête annulée par une frappe suivante
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  /** Ouvre un dossier minimal pour une cible qui n'en a pas encore. */
  const createProfile = () => {
    const firstName = query.trim();
    if (!firstName || isPending) return;
    startTransition(async () => {
      const res = await quickCreateProfileAction({ firstName, confirmDespiteDuplicates: true });
      if (!res.ok || !res.profileId) {
        setError(res.error ?? "La création du dossier a échoué.");
        return;
      }
      setError(null);
      onChange({ id: res.profileId, label: firstName });
      setOpen(false);
      setQuery("");
    });
  };

  if (value) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 border border-gold-dim bg-gold-faint/20 px-3 py-2">
        <span aria-hidden className="font-display text-sm text-gold">
          諜
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink">
          Dossier lié — <strong className="text-gold">{value.label}</strong>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[0.7rem] text-ink-faint underline-offset-2 hover:text-blood-bright hover:underline"
        >
          Délier
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery(suggestedName?.split(/[\n,]/)[0]?.trim() ?? "");
        }}
        className="mt-1 text-[0.7rem] text-gold underline-offset-2 hover:underline"
      >
        + Rattacher un dossier de renseignement
      </button>
    );
  }

  return (
    <div className="mt-1 space-y-2 border border-border-gold bg-elevated p-3">
      <p className="text-[0.65rem] text-ink-faint">{hint}</p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Prénom ou code (PRF-…)"
        aria-label={`Rechercher le dossier — ${label}`}
        autoComplete="off"
        className="w-full border border-border-default bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
      />

      {results.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto">
          {results.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: profile.id, label: profile.firstName });
                  setOpen(false);
                  setQuery("");
                }}
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

      {query.trim().length >= 2 && results.length === 0 && (
        <p className="text-[0.65rem] text-ink-faint italic">
          Aucun dossier ne porte ce nom.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[0.65rem] text-blood-bright">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={createProfile}
          disabled={isPending || query.trim().length === 0}
        >
          {isPending ? "Ouverture…" : `Ouvrir un dossier « ${query.trim() || "…"} »`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
