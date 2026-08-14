"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideClaimAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

/** Boutons de décision d'une revendication (modérateurs). */
export function ClaimDecide({
  claimId,
  requiresEnhancedReview = false,
}: {
  claimId: string;
  requiresEnhancedReview?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reviewRequired, setReviewRequired] = useState(requiresEnhancedReview);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "ACCEPTED" | "REJECTED" | "INFO_REQUESTED") => {
    startTransition(async () => {
      const res = await decideClaimAction({
        claimId,
        decision,
        note: note || undefined,
        reviewConfirmed,
      });
      setWarnings(res.warnings ?? []);
      if (!res.ok) {
        setError(res.error ?? "Échec de la décision.");
        if (res.needsReviewConfirmation) setReviewRequired(true);
      } else {
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`note-${claimId}`} className="sr-only">
        {reviewRequired ? "Note de contrôle obligatoire" : "Note au chef de groupe"}
      </label>
      <input
        id={`note-${claimId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder={
          reviewRequired
            ? "Note de contrôle obligatoire (transmise au chef)"
            : "Note (facultative, transmise au chef)"
        }
        className="w-full border border-border-default bg-elevated px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-gold"
      />
      {reviewRequired && (
        <label className="flex cursor-pointer items-start gap-2 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          <input
            type="checkbox"
            checked={reviewConfirmed}
            onChange={(event) => setReviewConfirmed(event.target.checked)}
            className="mt-0.5 accent-[var(--toile-gold)]"
          />
          <span>
            Je confirme avoir effectué le contrôle renforcé. Une note expliquant la vérification est obligatoire.
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-blood-bright">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warning">
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>⚠ {warning}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="gold"
          onClick={() => decide("ACCEPTED")}
          disabled={isPending || (reviewRequired && (!reviewConfirmed || !note.trim()))}
        >
          Attribuer
        </Button>
        <Button size="sm" variant="danger" onClick={() => decide("REJECTED")} disabled={isPending}>
          Refuser
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("INFO_REQUESTED")} disabled={isPending}>
          Demander des précisions
        </Button>
      </div>
    </div>
  );
}
