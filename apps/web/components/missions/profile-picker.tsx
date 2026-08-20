"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  MISSION_PROFILE_ROLE_LABELS,
  type MissionProfileRole,
} from "@toile/shared";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

/**
 * Choisir des DOSSIERS comme cibles et comme commanditaires.
 *
 * Avant, une cible était du texte libre — « Akira Hoki », ressaisi à chaque
 * mission, sans lien avec sa fiche, sans grade, sans village. Ici, une cible
 * EST un dossier : le grade, la classe et l'origine viennent de lui, le titre
 * public s'en déduit, et le rapport de fin de mission sait déjà à qui il a
 * affaire. Si le ninja n'a pas encore de fiche, on l'ouvre sans quitter la
 * page — prénom obligatoire, le reste attendra.
 */

export interface PickedProfile {
  profileId: string;
  role: MissionProfileRole;
  isPrimary: boolean;
  /** Affichage seulement — la vérité vit dans le dossier */
  code: string;
  name: string;
  gradeLabel: string | null;
  classLabel: string | null;
  originLabel: string | null;
  lifeStatus: string | null;
}

interface SearchHit {
  id: string;
  code: string;
  title: string | null;
  firstName: string;
  lastName: string | null;
}

const inputCls =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";

export function ProfilePicker({
  role,
  picked,
  onChange,
  describeProfile,
}: {
  role: MissionProfileRole;
  picked: PickedProfile[];
  onChange: (next: PickedProfile[]) => void;
  /** Complète un dossier choisi (grade, classe, origine) côté serveur */
  describeProfile: (profileId: string) => Promise<Omit<PickedProfile, "role" | "isPrimary"> | null>;
}) {
  const mine = picked.filter((p) => p.role === role);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [creating, setCreating] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profils/recherche?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) setHits(await res.json());
      } catch {
        // frappe suivante : requête annulée
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const add = (profileId: string) => {
    if (picked.some((p) => p.profileId === profileId && p.role === role)) {
      setError("Ce dossier est déjà rattaché avec ce rôle.");
      return;
    }
    startTransition(async () => {
      const described = await describeProfile(profileId);
      if (!described) {
        setError("Ce dossier est introuvable ou archivé.");
        return;
      }
      setError(null);
      setQuery("");
      setHits([]);
      onChange([
        ...picked,
        // La première personne d'un rôle devient la principale : dans neuf cas
        // sur dix il n'y en a qu'une, et on ne fera pas cliquer pour rien.
        { ...described, role, isPrimary: mine.length === 0 },
      ]);
    });
  };

  const remove = (profileId: string) =>
    onChange(picked.filter((p) => !(p.profileId === profileId && p.role === role)));

  const setPrimary = (profileId: string) =>
    onChange(
      picked.map((p) =>
        p.role === role ? { ...p, isPrimary: p.profileId === profileId } : p,
      ),
    );

  const createInline = () => {
    if (!firstName.trim()) return;
    startTransition(async () => {
      const res = await quickCreateProfileAction({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        // Une cible ouverte depuis une mission n'a pas à buter sur un
        // homonyme : la liste de recherche est juste au-dessus, on a vu.
        confirmDespiteDuplicates: true,
      });
      if (!res.ok || !res.profileId) {
        setError(res.error ?? "L'ouverture du dossier a échoué.");
        return;
      }
      setError(null);
      setFirstName("");
      setLastName("");
      setCreating(false);
      add(res.profileId);
      searchRef.current?.focus();
    });
  };

  const roleLabel = MISSION_PROFILE_ROLE_LABELS[role];

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {mine.map((p) => (
          <li
            key={p.profileId}
            className="flex flex-wrap items-start justify-between gap-2 border border-border-default bg-elevated p-2.5"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                {p.isPrimary && mine.length > 1 && (
                  <span aria-label={`${roleLabel} principale`} title={`${roleLabel} principale`} className="text-gold">
                    ★
                  </span>
                )}
                <span className="text-sm text-ink">{p.name}</span>
                <span className="font-mono-toile text-[0.65rem] text-ink-faint">{p.code}</span>
                {p.lifeStatus === "DEAD" && (
                  <span className="border border-blood/60 px-1 text-[0.6rem] uppercase tracking-wider text-blood-bright">
                    ✕ Mort
                  </span>
                )}
              </span>
              {/* Ce que la mission retiendra du dossier : lu, jamais ressaisi */}
              <span className="mt-0.5 block text-[0.7rem] text-ink-faint">
                {[p.gradeLabel, p.classLabel, p.originLabel].filter(Boolean).join(" · ") ||
                  "Aucun grade ni origine connus"}
                <span className="ml-1.5 text-ink-faint/70">— repris de {p.code}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-[0.7rem]">
              <Link
                href={`/profils/${p.profileId}`}
                target="_blank"
                className="text-gold underline-offset-2 hover:underline"
              >
                諜 dossier
              </Link>
              {mine.length > 1 && !p.isPrimary && (
                <button
                  type="button"
                  onClick={() => setPrimary(p.profileId)}
                  className="text-ink-faint underline hover:text-gold"
                >
                  principale
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(p.profileId)}
                className="min-h-[1.75rem] text-ink-faint underline hover:text-blood-bright"
              >
                retirer
              </button>
            </span>
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="space-y-2 border border-border-gold bg-elevated p-3">
          <p className="font-display text-xs tracking-widest text-gold uppercase">
            Nouveau dossier
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              autoFocus
              aria-label="Prénom du ninja"
              placeholder="Prénom *"
              className={inputCls}
              maxLength={80}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createInline();
                }
              }}
            />
            <input
              aria-label="Nom du ninja"
              placeholder="Nom (facultatif)"
              className={inputCls}
              maxLength={80}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gold" disabled={isPending || !firstName.trim()} onClick={createInline}>
              Créer et sélectionner
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`+ Ajouter ${role === "CLIENT" ? "un commanditaire" : "une cible"} — prénom, nom ou code`}
            aria-label={`Rechercher un dossier pour l'ajouter comme ${roleLabel.toLowerCase()}`}
            autoComplete="off"
            className={inputCls}
          />
          {hits.length > 0 && (
            <ul className="max-h-44 space-y-0.5 overflow-y-auto border border-border-default bg-raised p-1">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => add(hit.id)}
                    className="w-full px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-hover-bg hover:text-gold"
                  >
                    {[hit.firstName, hit.lastName].filter(Boolean).join(" ")}
                    <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{hit.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFirstName(query.trim());
                setCreating(true);
              }}
            >
              + Créer le dossier « {query.trim()} »
            </Button>
          )}
          {query.trim().length < 2 && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              + Nouveau dossier
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-blood-bright">
          {error}
        </p>
      )}
    </div>
  );
}
