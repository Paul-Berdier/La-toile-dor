"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDossierTitle } from "@toile/shared";
import { quickCreateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

interface ExistingProfile {
  id: string;
  code: string;
  title: string | null;
  firstName: string;
  lastName: string | null;
}

export interface QuickCreateGroup {
  id: string;
  name: string;
}

const inputCls =
  "mt-1 w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const labelCls = "mt-3 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * « Nouveau dossier » : modale courte — Prénom (seul obligatoire), Nom,
 * Titre, Groupe propriétaire. Les doublons sont montrés avant la création,
 * sans jamais révéler plus que ce que tout le monde voit (code, titre, nom).
 *
 * Le groupe : un seul → pré-sélectionné et affiché ; plusieurs → à choisir ;
 * aucun → la modération seule peut créer (dossier sans propriétaire).
 */
export function QuickCreateProfile({
  sourceMissionId,
  groups,
  canCreateWithoutGroup = false,
}: {
  sourceMissionId?: string;
  /** Groupes actifs du lecteur, candidats à la propriété du dossier */
  groups: QuickCreateGroup[];
  /** Modération : peut ouvrir un dossier qui n'appartient à aucun groupe */
  canCreateWithoutGroup?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0]!.id : "");
  const [duplicates, setDuplicates] = useState<{ id: string; code: string; name: string }[]>([]);
  const [existing, setExisting] = useState<ExistingProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Titre proposé tant que l'utilisateur ne l'a pas touché : « Dossier — Akira Hoki »
  const suggestedTitle = formatDossierTitle(firstName.trim(), lastName.trim() || null);
  const effectiveTitle = titleTouched ? title : suggestedTitle;

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
        if (res.ok) {
          const rows = (await res.json()) as ExistingProfile[];
          // Si un nom est saisi, on resserre sur ceux qui le portent aussi
          const last = lastName.trim().toLowerCase();
          setExisting(
            last ? rows.filter((r) => !r.lastName || r.lastName.toLowerCase().includes(last)) : rows,
          );
        }
      } catch {
        // Requête annulée par une frappe suivante : rien à signaler
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [firstName, lastName, open]);

  // « Aucun groupe » (modération) est un choix explicite, distinct de « pas
  // encore choisi » — sinon le sélecteur ne peut pas les distinguer.
  const NO_GROUP = "__none__";
  const needsGroupChoice = groups.length > 1 && !groupId;
  const noGroupAtAll = groups.length === 0 && !canCreateWithoutGroup;
  const canSubmit =
    !isPending && firstName.trim().length > 0 && !needsGroupChoice && !noGroupAtAll;

  const reset = () => {
    setOpen(false);
    setFirstName("");
    setLastName("");
    setTitle("");
    setTitleTouched(false);
    setGroupId(groups.length === 1 ? groups[0]!.id : "");
    setDuplicates([]);
    setError(null);
  };

  const submit = (thenEdit: boolean, confirmDespiteDuplicates = false) => {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await quickCreateProfileAction({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        title: effectiveTitle.trim() || undefined,
        groupId: groupId && groupId !== NO_GROUP ? groupId : undefined,
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
      const createdId = res.profileId;
      reset();
      if (thenEdit && createdId) {
        router.push(`/profils/${createdId}/modifier${sourceMissionId ? `?mission=${sourceMissionId}` : ""}`);
      } else if (createdId) {
        router.push(`/profils/${createdId}`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button variant="gold" size="md" onClick={() => setOpen(true)}>
        Nouveau dossier
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qc-title"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-obsidian/80 px-4"
          onKeyDown={(e) => { if (e.key === "Escape" && !isPending) reset(); }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto border border-border-gold bg-raised p-6 shadow-modal">
            <h2 id="qc-title" className="font-display text-base tracking-widest text-gold uppercase">
              Ouvrir un dossier
            </h2>
            <p className="mt-2 text-xs text-ink-faint">
              Seul le prénom est nécessaire. Tout le reste restera « Inconnu » et
              pourra être complété au fil des renseignements.
            </p>

            <label htmlFor="qc-firstname" className={labelCls}>Prénom du personnage *</label>
            <input
              id="qc-firstname"
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setDuplicates([]); }}
              maxLength={80}
              autoFocus
              required
              className={inputCls}
            />

            <label htmlFor="qc-lastname" className={labelCls}>Nom (facultatif)</label>
            <input
              id="qc-lastname"
              value={lastName}
              onChange={(e) => { setLastName(e.target.value); setDuplicates([]); }}
              maxLength={80}
              className={inputCls}
            />

            <label htmlFor="qc-dossier-title" className={labelCls}>Titre du dossier</label>
            <input
              id="qc-dossier-title"
              value={effectiveTitle}
              onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
              maxLength={120}
              placeholder="Dossier — Prénom Nom"
              className={inputCls}
            />
            {titleTouched && title.trim() === "" && (
              <p className="mt-1 text-[0.65rem] text-ink-faint">
                Vide : le titre « {suggestedTitle} » sera retenu.
              </p>
            )}

            {/* Groupe propriétaire : le dossier appartient au groupe, pas à la personne */}
            {groups.length === 1 && (
              <p className="mt-3 text-xs text-ink-muted">
                Groupe propriétaire :{" "}
                <span className="text-gold">{groups[0]!.name}</span>
              </p>
            )}
            {groups.length > 1 && (
              <>
                <label htmlFor="qc-group" className={labelCls}>Pour quel groupe ? *</label>
                <select
                  id="qc-group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className={inputCls}
                  required
                >
                  <option value="">— choisir —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                  {canCreateWithoutGroup && <option value={NO_GROUP}>Aucun (dossier de la Toile)</option>}
                </select>
              </>
            )}
            {groups.length === 0 && canCreateWithoutGroup && (
              <p className="mt-3 text-xs text-ink-muted">
                Dossier de la Toile — sans groupe propriétaire.
              </p>
            )}
            {noGroupAtAll && (
              <p role="alert" className="mt-3 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
                Vous n&rsquo;appartenez à aucun groupe actif : un dossier appartient toujours
                à un groupe. Rejoignez-en un, ou demandez à la modération.
              </p>
            )}

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
                          reset();
                          router.push(
                            `/profils/${profile.id}${sourceMissionId ? `?mission=${sourceMissionId}` : ""}`,
                          );
                        }}
                        className="w-full px-1.5 py-1 text-left text-xs text-ink-muted hover:bg-hover-bg hover:text-gold"
                      >
                        {profile.title ?? [profile.firstName, profile.lastName].filter(Boolean).join(" ")}
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
                <p className="font-medium">Des dossiers ressemblants existent déjà :</p>
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
              <Button variant="ghost" onClick={reset} disabled={isPending}>
                Annuler
              </Button>
              <Button
                variant="outline"
                onClick={() => submit(false, duplicates.length > 0)}
                disabled={!canSubmit}
              >
                {duplicates.length > 0 ? "Créer quand même" : "Créer rapidement"}
              </Button>
              <Button
                variant="gold"
                onClick={() => submit(true, duplicates.length > 0)}
                disabled={!canSubmit}
              >
                Créer et compléter
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
