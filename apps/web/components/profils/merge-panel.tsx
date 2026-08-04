"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeProfilesAction, archiveProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

interface Candidate {
  id: string;
  code: string;
  firstName: string;
  lastName: string | null;
}

/**
 * Fusion de doublons (super-modérateurs). Le dossier COURANT est absorbé dans
 * le dossier cible : rien n'est perdu, et l'ancien code redirige vers la cible.
 */
export function MergePanel({
  profileId,
  profileCode,
  profileName,
}: {
  profileId: string;
  profileCode: string;
  profileName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const doSearch = async (q: string) => {
    setSearch(q);
    setTarget(null);
    if (q.trim().length < 2) return setResults([]);
    const res = await fetch(
      `/api/profils/recherche?q=${encodeURIComponent(q)}&exclude=${profileId}`,
    );
    if (res.ok) setResults(await res.json());
  };

  const merge = () => {
    if (!target || isPending) return;
    startTransition(async () => {
      const res = await mergeProfilesAction({ sourceId: profileId, targetId: target.id });
      if (!res.ok) setError(res.error ?? "La fusion a échoué.");
      else router.push(`/profils/${res.profileId}`);
    });
  };

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Fusionner avec un autre dossier
        </Button>
        <ArchiveButton profileId={profileId} />
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-border-gold bg-elevated p-3">
      <p className="text-xs text-ink-muted">
        Ce dossier ({profileCode} — {profileName}) sera <strong>absorbé</strong> dans le
        dossier que vous choisissez. Valeurs, relations, sources, historiques et
        accès sont conservés ; l&rsquo;ancien code redirigera vers la cible.
      </p>

      <div>
        <label htmlFor="merge-search" className="mb-1 block text-xs uppercase tracking-wider text-ink-faint">
          Dossier à conserver
        </label>
        <input
          id="merge-search"
          value={search}
          onChange={(e) => doSearch(e.target.value)}
          placeholder="Rechercher (prénom, code)…"
          className="w-full border border-border-default bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
        />
      </div>

      {results.length > 0 && !target && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
          {results.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => { setTarget(candidate); setResults([]); setSearch(""); }}
                className="w-full px-2 py-1.5 text-left text-ink-muted hover:bg-hover-bg hover:text-gold"
              >
                {candidate.firstName}
                {candidate.lastName ? ` ${candidate.lastName}` : ""} — {candidate.code}
              </button>
            </li>
          ))}
        </ul>
      )}

      {target && (
        <div className="border border-border-default bg-raised p-3 text-xs">
          <p className="text-ink-faint">Fusion prévue :</p>
          <p className="mt-1 text-ink">
            {profileCode} — {profileName}
            <span className="mx-2 text-gold">→</span>
            {target.code} — {target.firstName}
            {target.lastName ? ` ${target.lastName}` : ""}
          </p>
          <p className="mt-1 text-ink-faint">
            Le dossier de gauche disparaît de la liste et redirige vers celui de droite.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {confirming ? (
          <>
            <Button size="sm" variant="seal" onClick={merge} disabled={isPending || !target}>
              {isPending ? "Fusion…" : "Confirmer la fusion"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={isPending}>
              Renoncer
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={!target}>
            Fusionner
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTarget(null); setConfirming(false); }}>
          Fermer
        </Button>
      </div>
    </div>
  );
}

function ArchiveButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Archiver
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">
        Le dossier disparaîtra des listes (données conservées).
      </span>
      <Button
        variant="seal"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await archiveProfileAction(profileId);
            router.push("/profils");
          })
        }
      >
        Confirmer l&rsquo;archivage
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={isPending}>
        Renoncer
      </Button>
    </span>
  );
}
