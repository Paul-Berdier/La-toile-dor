"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideUserLevelChangeAction } from "@/server/user-level-actions";
import { Button } from "@/components/ui/button";

export function GradeDecisionCard({
  request,
  requiresAnotherReviewer,
}: {
  request: {
    id: string;
    targetName: string;
    requesterName: string | null;
    currentLevelLabel: string | null;
    requestedLevelLabel: string;
    groupName: string | null;
    reason: string;
    requestedAtLabel: string;
  };
  requiresAnotherReviewer: boolean;
}) {
  const router = useRouter();
  const [reviewNote, setReviewNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "APPROVED" | "REJECTED") => {
    startTransition(async () => {
      const result = await decideUserLevelChangeAction({
        requestId: request.id,
        decision,
        reviewNote,
      });
      if (result.ok) router.refresh();
      else setFeedback(result.error ?? "La décision n'a pas pu être enregistrée.");
    });
  };

  return (
    <li className="border border-border-default bg-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm text-ink">{request.targetName}</h3>
          <p className="font-mono-toile text-xs text-gold">
            {request.currentLevelLabel ?? "Sans grade"} → {request.requestedLevelLabel}
          </p>
        </div>
        <time className="font-mono-toile text-[0.6rem] text-ink-faint">{request.requestedAtLabel}</time>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Demandé par {request.requesterName ?? "un compte supprimé"}
        {request.groupName ? ` au nom de ${request.groupName}` : " pour son propre personnage"}.
      </p>
      <blockquote className="mt-2 border-l-2 border-gold-dim pl-3 text-sm text-ink-muted italic">
        {request.reason}
      </blockquote>

      {requiresAnotherReviewer ? (
        <p className="mt-3 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          Vous ne pouvez pas trancher une demande qui vous concerne ou que vous avez déposée : un autre modérateur est requis.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-xs uppercase tracking-wider text-ink-faint">
            Motif de la décision *
            <textarea
              value={reviewNote}
              onChange={(event) => {
                setReviewNote(event.target.value);
                setFeedback(null);
              }}
              rows={3}
              maxLength={2000}
              className="mt-1 w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold"
              placeholder="Décision RP, correction demandée, raison du refus…"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="gold"
              size="sm"
              disabled={isPending || reviewNote.trim().length < 3}
              onClick={() => decide("APPROVED")}
            >
              Approuver le grade
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isPending || reviewNote.trim().length < 3}
              onClick={() => decide("REJECTED")}
            >
              Refuser
            </Button>
          </div>
        </div>
      )}

      {feedback && <p role="alert" className="mt-2 text-xs text-blood-bright">{feedback}</p>}
    </li>
  );
}
