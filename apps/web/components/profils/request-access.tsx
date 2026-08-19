"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestProfileAccessAction,
  revokeGrantAction,
  decidePurchaseAction,
} from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

/** Chef de groupe : demander l'accès au dossier pour l'un de SES groupes. */
export function RequestAccessPanel({
  profileId,
  groups,
}: {
  profileId: string;
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) return null;

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await requestProfileAccessAction({
        profileId,
        groupId,
        message: message || undefined,
      });
      if (!res.ok) setError(res.error ?? "La demande a échoué.");
      else {
        setError(null);
        setDone(true);
        router.refresh();
      }
    });
  };

  if (done) {
    return (
      <p className="border border-gold-dim bg-gold-faint/20 px-3 py-2 text-xs text-gold">
        Demande transmise. Un tisseur fixera le prix du dossier.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.length > 1 && (
        <div>
          <label htmlFor="req-group" className="mb-1 block text-xs uppercase tracking-wider text-ink-faint">
            Groupe concerné
          </label>
          <select
            id="req-group"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink"
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="req-message" className="mb-1 block text-xs uppercase tracking-wider text-ink-faint">
          Message au tisseur (facultatif)
        </label>
        <textarea
          id="req-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          maxLength={2000}
          className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink"
        />
      </div>
      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}
      <Button variant="gold" className="w-full" onClick={submit} disabled={isPending}>
        {isPending ? "Le fil se tend…" : "Demander l'accès pour mon groupe"}
      </Button>
    </div>
  );
}

/**
 * Modération : révoquer un accès actif — avec MOTIF et confirmation. Un accès
 * payé est une dette de la Toile : on ne le retire pas d'un clic distrait.
 */
export function RevokeGrantButton({
  grantId,
  groupName,
  disabled,
  disabledReason,
}: {
  grantId: string;
  groupName?: string;
  /** Accès non révocable (groupe créateur) */
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (disabled) {
    return (
      <span className="text-[0.65rem] text-ink-faint" title={disabledReason}>
        {disabledReason ?? "Non révocable"}
      </span>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Révoquer
      </Button>
    );
  }
  return (
    <div className="w-full space-y-1.5 border border-blood/50 bg-blood/5 p-2">
      <p className="text-[0.7rem] text-ink-muted">
        Retirer l&rsquo;accès{groupName ? ` de ${groupName}` : ""} ? Le groupe sera prévenu, avec le motif.
      </p>
      <input
        aria-label="Motif de la révocation"
        placeholder="Motif (obligatoire)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        className="w-full border border-border-default bg-elevated px-2 py-1 text-xs text-ink"
      />
      {error && <p role="alert" className="text-[0.7rem] text-blood-bright">{error}</p>}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="danger"
          disabled={isPending || reason.trim().length < 3}
          onClick={() =>
            startTransition(async () => {
              const res = await revokeGrantAction(grantId, reason);
              if (!res.ok) setError(res.error ?? "Échec.");
              else { setOpen(false); router.refresh(); }
            })
          }
        >
          Confirmer la révocation
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setReason(""); setError(null); }} disabled={isPending}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/** Modération : décision sur une demande (prix en Ryōs, réponse). */
export function DecideRequestPanel({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [price, setPrice] = useState<number>(100_000);
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "APPROVED" | "REFUSED") => {
    if (isPending) return;
    startTransition(async () => {
      const res = await decidePurchaseAction({
        requestId,
        decision,
        priceRyos: decision === "APPROVED" ? price : null,
        moderatorResponse: response || undefined,
      });
      if (!res.ok) setError(res.error ?? "Échec de la décision.");
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`price-${requestId}`} className="text-xs text-ink-faint">
          Prix (ryōs)
        </label>
        <input
          id={`price-${requestId}`}
          type="number"
          min={0}
          step={10_000}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value) || 0)}
          className="w-32 border border-border-default bg-elevated px-2 py-1 text-sm text-ink"
        />
      </div>
      <input
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        maxLength={2000}
        placeholder="Réponse au chef (facultative)"
        aria-label="Réponse au chef"
        className="w-full border border-border-default bg-elevated px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint"
      />
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="gold" onClick={() => decide("APPROVED")} disabled={isPending}>
          Approuver
        </Button>
        <Button size="sm" variant="danger" onClick={() => decide("REFUSED")} disabled={isPending}>
          Refuser
        </Button>
      </div>
      <p className="text-[0.65rem] text-ink-faint">
        Aucun portefeuille de Ryōs n&rsquo;existe : le prix est consigné, le règlement
        se fait en RP.
      </p>
    </div>
  );
}
