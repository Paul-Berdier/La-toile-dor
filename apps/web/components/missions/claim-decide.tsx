"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideClaimAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

/** Boutons de décision d'une revendication (modérateurs). */
export function ClaimDecide({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "ACCEPTED" | "REJECTED" | "INFO_REQUESTED") => {
    startTransition(async () => {
      const res = await decideClaimAction({ claimId, decision, note: note || undefined });
      if (!res.ok) setError(res.error ?? "Échec de la décision.");
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`note-${claimId}`} className="sr-only">
        Note au chef de groupe
      </label>
      <input
        id={`note-${claimId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        placeholder="Note (facultative, transmise au chef)"
        className="w-full border border-border-default bg-elevated px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-gold"
      />
      {error && (
        <p role="alert" className="text-xs text-blood-bright">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="gold" onClick={() => decide("ACCEPTED")} disabled={isPending}>
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
