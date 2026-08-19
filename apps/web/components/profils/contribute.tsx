"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CONTRIBUTABLE_FIELD_KEYS,
  CONTRIBUTION_DECISION_LABELS,
  CONTRIBUTION_STATUS_LABELS,
  LIST_FIELD_KEYS,
  PROFILE_FIELD_LABELS,
  canMergeField,
  type ContributionDecision,
  type ProfileFieldKey,
} from "@toile/shared";
import {
  reviewIntelContributionAction,
  submitIntelContributionAction,
} from "@/server/profiles/contribution-actions";
import type { ContributionView } from "@/server/profiles/queries";
import { Button } from "@/components/ui/button";
import { INTEL_PALETTE, IntelValueEditor, canDeclareNone, type IntelRefs } from "./intel-value-editor";

/** Référentiels nécessaires à la palette — même forme que `loadProfileRefs()`. */
export type ContributeRefs = IntelRefs;
const PALETTE = INTEL_PALETTE;

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const labelCls = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * « + Ajouter un renseignement » — pour tout lecteur AUTORISÉ.
 *
 * Le message de confirmation est le MÊME que la valeur en place soit d'accord
 * ou non : le contributeur ne doit pas pouvoir sonder le dossier en proposant
 * des valeurs et en regardant lesquelles « passent ».
 */
export function ContributeIntel({
  profileId,
  refs,
  groups,
  directWrite,
  sourceMissionId,
}: {
  profileId: string;
  refs: ContributeRefs;
  /** Groupes du lecteur (si plusieurs, il choisit au nom duquel il parle) */
  groups: { id: string; name: string }[];
  /** Le lecteur écrit directement (modération, groupe créateur) */
  directWrite: boolean;
  sourceMissionId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState<ProfileFieldKey | null>(null);
  const [noneConfirmed, setNoneConfirmed] = useState(false);
  const [value, setValue] = useState<unknown>(undefined);
  const [confidence, setConfidence] = useState("PROBABLE");
  const [note, setNote] = useState("");
  const [groupId, setGroupId] = useState(groups.length === 1 ? groups[0]!.id : "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"APPLIED" | "PENDING_REVIEW" | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setFieldKey(null);
    setNoneConfirmed(false);
    setValue(undefined);
    setNote("");
    setError(null);
  };

  const submit = () => {
    if (!fieldKey || isPending) return;
    if (groups.length > 1 && !groupId && !directWrite) {
      setError("Précisez au nom de quel groupe vous contribuez.");
      return;
    }
    startTransition(async () => {
      const res = await submitIntelContributionAction({
        profileId,
        fieldKey,
        knowledgeState: noneConfirmed ? "NONE_CONFIRMED" : "KNOWN",
        value: noneConfirmed ? undefined : value,
        confidence,
        note: note || undefined,
        groupId: groupId || undefined,
        sourceMissionId,
      });
      if (!res.ok) {
        setError(res.error ?? "L'envoi a échoué.");
        return;
      }
      setDone(res.status ?? "PENDING_REVIEW");
      reset();
      router.refresh();
    });
  };

  const valueEditor =
    fieldKey && !noneConfirmed ? (
      <IntelValueEditor fieldKey={fieldKey} value={value} onChange={setValue} refs={refs} />
    ) : null;

  const canNone = fieldKey ? canDeclareNone(fieldKey) : false;


  return (
    <div className="space-y-3">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => { setOpen(true); setDone(null); }}>
            + Ajouter un renseignement
          </Button>
          {done === "APPLIED" && <p role="status" className="text-xs text-gold">Renseignement enregistré dans le dossier.</p>}
          {done === "PENDING_REVIEW" && (
            <p role="status" className="text-xs text-gold">
              Renseignement transmis. La modération le vérifiera avant de l&rsquo;inscrire.
            </p>
          )}
        </div>
      ) : (
        <div className="border border-border-gold bg-raised p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-sm tracking-widest text-gold uppercase">Ajouter un renseignement</h3>
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); reset(); }}>Fermer</Button>
          </div>
          {!directWrite && (
            <p className="mt-1 text-[0.7rem] text-ink-faint">
              Votre proposition sera vérifiée par la modération avant d&rsquo;être inscrite au dossier.
            </p>
          )}

          {!fieldKey ? (
            <div className="mt-3 space-y-3">
              {PALETTE.map((section) => (
                <div key={section.title}>
                  <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-ink-faint">{section.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {section.keys.filter((k) => CONTRIBUTABLE_FIELD_KEYS.includes(k)).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setFieldKey(k); setValue(undefined); setNoneConfirmed(false); }}
                        className="border border-border-default px-2 py-1 text-xs text-ink-muted hover:border-gold hover:text-gold"
                      >
                        {PROFILE_FIELD_LABELS[k]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-ink-muted">
                  Champ : <span className="text-gold">{PROFILE_FIELD_LABELS[fieldKey]}</span>
                </p>
                <button type="button" onClick={reset} className="text-[0.7rem] text-ink-faint underline hover:text-gold">
                  changer de champ
                </button>
              </div>
              {canNone && (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={noneConfirmed} onChange={(e) => { setNoneConfirmed(e.target.checked); setValue(undefined); }} />
                  Vérifié : il n&rsquo;y en a pas (absence confirmée)
                </label>
              )}
              {valueEditor}
              {LIST_FIELD_KEYS.includes(fieldKey) && !noneConfirmed && (
                <p className="text-[0.65rem] text-ink-faint">Une contribution ajoute à la liste — elle ne retire rien.</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={labelCls}>
                  Confiance
                  <select className={`${input} mt-1`} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                    <option value="RUMOR">Rumeur</option>
                    <option value="UNCONFIRMED">Non confirmé</option>
                    <option value="PROBABLE">Probable</option>
                    <option value="CONFIRMED">Confirmé</option>
                  </select>
                </label>
                {groups.length > 1 && (
                  <label className={labelCls}>
                    Au nom du groupe
                    <select className={`${input} mt-1`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                      <option value="">— choisir —</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <label className={labelCls}>
                Source / précision (facultatif)
                <textarea className={`${input} mt-1 min-h-[3rem]`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={reset} disabled={isPending}>Annuler</Button>
                <Button variant="gold" size="sm" onClick={submit} disabled={isPending || (!noneConfirmed && value === undefined)}>
                  {isPending ? "Envoi…" : directWrite ? "Inscrire au dossier" : "Proposer"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Les contributions du lecteur et leur sort. */
export function MyContributions({ rows }: { rows: ContributionView[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {rows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-default/60 pb-1.5 text-xs last:border-b-0">
          <span className="text-ink-muted">
            <span className="text-ink">{c.fieldLabel}</span> — {c.proposedLabel}
            {c.sourceMissionCode && <span className="ml-1 text-ink-faint">(mission {c.sourceMissionCode})</span>}
          </span>
          <span className={`font-mono-toile text-[0.65rem] uppercase tracking-wider ${
            c.status === "PENDING_REVIEW" ? "text-warning" : c.status === "REJECTED" ? "text-blood-bright" : "text-gold"
          }`}>
            {CONTRIBUTION_STATUS_LABELS[c.status as keyof typeof CONTRIBUTION_STATUS_LABELS] ?? c.status}
            {c.reviewNote && <span className="ml-1 normal-case tracking-normal text-ink-faint">— {c.reviewNote}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Revue des contributions en attente — modération et groupe créateur. La
 * valeur EN PLACE n'est pas répétée ici : le relecteur a le dossier sous les
 * yeux, et ce composant ne reçoit que la proposition et l'indicateur de
 * conflit.
 */
export function PendingContributions({ rows }: { rows: ContributionView[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) return null;

  const decide = (id: string, decision: ContributionDecision) =>
    startTransition(async () => {
      const res = await reviewIntelContributionAction({ contributionId: id, decision, reviewNote: notes[id] || undefined });
      if (!res.ok) setError(res.error ?? "Échec.");
      else { setError(null); router.refresh(); }
    });

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      {rows.map((c) => {
        const decisions: ContributionDecision[] = ["ACCEPT", "REJECT", "MARK_CONTRADICTORY"];
        if (canMergeField(c.fieldKey as ProfileFieldKey)) decisions.push("MERGE");
        // Une proposition de DÉCÈS n'est pas un renseignement comme un autre :
        // elle saute aux yeux du relecteur, cadre rouge et croix.
        const proposesDeath = c.fieldKey === "lifeStatus" && c.proposedLabel === "Mort";
        return (
          <article
            key={c.id}
            className={`border bg-elevated p-3 ${proposesDeath ? "border-blood" : "border-border-gold"}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-ink">
                <span className="text-gold">{c.fieldLabel}</span> →{" "}
                {proposesDeath ? (
                  <span className="font-medium text-blood-bright">✕ {c.proposedLabel}</span>
                ) : (
                  c.proposedLabel
                )}
              </p>
              {proposesDeath && (
                <span className="border border-blood px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-blood-bright">
                  Décès proposé
                </span>
              )}
              {c.conflictsWithExisting && (
                <span className="border border-blood/60 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-blood-bright">
                  Contredit la valeur en place
                </span>
              )}
            </div>
            <p className="mt-1 text-[0.7rem] text-ink-faint">
              {c.contributorName}
              {c.groupName ? ` · ${c.groupName}` : ""}
              {c.sourceMissionCode ? ` · mission ${c.sourceMissionCode}` : ""}
              {c.confidence ? ` · ${c.confidence.toLowerCase()}` : ""}
              {" · "}{new Date(c.createdAt).toLocaleDateString("fr-FR")}
            </p>
            {c.note && <p className="mt-1 text-xs text-ink-muted">« {c.note} »</p>}
            <input
              aria-label="Note de revue"
              placeholder="Note pour le contributeur (facultative)"
              className={`${input} mt-2`}
              maxLength={2000}
              value={notes[c.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {decisions.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={d === "ACCEPT" ? "gold" : d === "REJECT" ? "ghost" : "outline"}
                  onClick={() => decide(c.id, d)}
                  disabled={isPending}
                >
                  {CONTRIBUTION_DECISION_LABELS[d]}
                </Button>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
