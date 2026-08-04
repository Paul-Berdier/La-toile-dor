"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

/** « Nouveau profil » : modale minimale (prénom seul), doublons avertis sans blocage. */
export function QuickCreateProfile({ sourceMissionId }: { sourceMissionId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [duplicates, setDuplicates] = useState<{ id: string; code: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
