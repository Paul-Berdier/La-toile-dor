"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

interface ExistingProfile {
  id: string;
  code: string;
  firstName: string;
}

/** « Nouveau profil » : modale minimale (prénom seul), doublons avertis sans blocage. */
export function QuickCreateProfile({ sourceMissionId }: { sourceMissionId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; code: string; name: string }[]>([]);
  const [existing, setExisting] = useState<ExistingProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /**
   * Dossiers déjà ouverts, cherchés au fil de la frappe : le doublon se
   * repère AVANT la création, pas après coup dans un message d'erreur.
   */
  useEffect(() => {
    if (!open || firstName.trim().length < 2) {
      setExisting([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/profils/recherche?q=${encodeURIComponent(firstName.trim())}`,
          { signal: controller.signal },
        );
        if (res.ok) setExisting(await res.json());
      } catch {
        // Requête annulée par une frappe suivante : rien à signaler
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [firstName, open]);

  const submit = (thenEdit: boolean, confirmDespiteDuplicates = false) => {
    if (isPending) return;
    startTransition(async () => {
      const res = await quickCreateProfileAction({
        firstName,
        sourceMissionId,
        confirmDespiteDuplicates,
      });
      if (!res.ok) {
        if (res.duplicates) {
          setDuplicates(res.duplicates);
          setError(null);
        } else {
          setError(res.error ?? "La création a échoué.");
        }
        return;
      }
      setOpen(false);
      setFirstName("");
      setDuplicates([]);
      if (thenEdit && res.profileId) {
        router.push(`/profils/${res.profileId}/modifier${sourceMissionId ? `?mission=${sourceMissionId}` : ""}`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button variant="gold" size="md" onClick={() => setOpen(true)}>
        Nouveau profil
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nouveau profil"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-obsidian/80 px-4"
        >
          <div className="w-full max-w-md border border-border-gold bg-raised p-6 shadow-modal">
            <h2 className="font-display text-base tracking-widest text-gold uppercase">
              Ouvrir un dossier
            </h2>
            <p className="mt-2 text-xs text-ink-faint">
              Seul le prénom est nécessaire. Tout le reste restera « Inconnu » et
              pourra être complété au fil des renseignements.
            </p>
            <label htmlFor="qc-firstname" className="mt-4 block text-xs uppercase tracking-wider text-ink-faint">
              Prénom du personnage *
            </label>
            <input
              id="qc-firstname"
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setDuplicates([]); }}
              maxLength={80}
              autoFocus
              className="mt-1 w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold"
            />

            {/* Dossiers existants : ouvrir plutôt que dupliquer */}
            {existing.length > 0 && duplicates.length === 0 && (
              <div className="mt-3 border border-border-gold bg-elevated p-2">
                <p className="text-[0.7rem] uppercase tracking-wider text-ink-faint">
                  Dossiers déjà ouverts
                </p>
                <ul className="mt-1 space-y-0.5">
                  {existing.map((profile) => (
                    <li key={profile.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(
                            `/profils/${profile.id}${sourceMissionId ? `?mission=${sourceMissionId}` : ""}`,
                          );
                        }}
                        className="w-full px-1.5 py-1 text-left text-xs text-ink-muted hover:bg-hover-bg hover:text-gold"
                      >
                        {profile.firstName}
                        <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">
                          {profile.code}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {duplicates.length > 0 && (
              <div className="mt-3 border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
                <p className="font-medium">Des profils ressemblants existent déjà :</p>
                <ul className="mt-1 space-y-0.5">
                  {duplicates.map((dup) => (
                    <li key={dup.id}>· {dup.code} — {dup.name}</li>
                  ))}
                </ul>
                <p className="mt-1">Vérifiez qu&rsquo;il ne s&rsquo;agit pas du même personnage.</p>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Annuler
              </Button>
              <Button
                variant="outline"
                onClick={() => submit(false, duplicates.length > 0)}
                disabled={isPending || firstName.trim().length === 0}
              >
                {duplicates.length > 0 ? "Créer quand même" : "Créer le profil minimal"}
              </Button>
              <Button
                variant="gold"
                onClick={() => submit(true, duplicates.length > 0)}
                disabled={isPending || firstName.trim().length === 0}
              >
                Créer et compléter maintenant
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
