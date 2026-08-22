"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestUserLevelChangeAction } from "@/server/user-level-actions";
import { Button } from "@/components/ui/button";

export interface GradeLevelOption {
  id: string;
  label: string;
  order: number;
}

export interface GradeCandidateOption {
  key: string;
  targetUserId: string;
  groupId: string | null;
  displayName: string;
  groupName: string | null;
  currentLevelId: string | null;
  currentLevelLabel: string | null;
  hasPendingRequest: boolean;
}

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";

export function GradeRequestForm({
  title,
  description,
  candidates,
  levels,
}: {
  title: string;
  description: string;
  candidates: GradeCandidateOption[];
  levels: GradeLevelOption[];
}) {
  const router = useRouter();
  const [candidateKey, setCandidateKey] = useState(candidates[0]?.key ?? "");
  const [requestedLevelId, setRequestedLevelId] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const candidate = candidates.find((option) => option.key === candidateKey) ?? candidates[0];
  const availableLevels = useMemo(
    () => levels.filter((level) => level.id !== candidate?.currentLevelId),
    [candidate?.currentLevelId, levels],
  );

  const submit = () => {
    if (!candidate) return;
    startTransition(async () => {
      const result = await requestUserLevelChangeAction({
        targetUserId: candidate.targetUserId,
        requestedLevelId,
        groupId: candidate.groupId ?? undefined,
        reason,
      });
      if (result.ok) {
        setFeedback({ ok: true, text: "Demande transmise. Un autre tisseur doit maintenant la trancher." });
        setReason("");
        setRequestedLevelId("");
        router.refresh();
      } else {
        setFeedback({ ok: false, text: result.error ?? "La demande n'a pas pu être transmise." });
      }
    });
  };

  if (candidates.length === 0) {
    return (
      <section className="border border-border-default bg-raised p-5">
        <h2 className="font-display text-sm tracking-widest text-gold uppercase">{title}</h2>
        <p className="mt-2 text-sm text-ink-faint italic">Aucun membre actif ne peut faire l&rsquo;objet de cette demande.</p>
      </section>
    );
  }

  return (
    <section className="border border-border-gold bg-raised p-5">
      <h2 className="font-display text-sm tracking-widest text-gold uppercase">{title}</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-ink-muted">{description}</p>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {candidates.length > 1 && (
          <label className="block text-xs uppercase tracking-wider text-ink-faint">
            Membre concerné
            <select
              value={candidateKey}
              onChange={(event) => {
                setCandidateKey(event.target.value);
                setRequestedLevelId("");
                setFeedback(null);
              }}
              className={`mt-1 ${input}`}
            >
              {candidates.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.displayName}
                  {option.groupName ? ` · ${option.groupName}` : ""}
                  {option.hasPendingRequest ? " · demande en attente" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {candidate && (
          <p className="border border-border-default bg-elevated px-3 py-2 text-xs text-ink-muted">
            {candidate.displayName} — grade actuel : {candidate.currentLevelLabel ?? "non déclaré"}
            {candidate.groupName ? ` · ${candidate.groupName}` : ""}
          </p>
        )}

        <label className="block text-xs uppercase tracking-wider text-ink-faint">
          Grade demandé
          <select
            value={requestedLevelId}
            onChange={(event) => {
              setRequestedLevelId(event.target.value);
              setFeedback(null);
            }}
            required
            className={`mt-1 ${input}`}
          >
            <option value="">— choisir un grade —</option>
            {availableLevels.map((level) => (
              <option key={level.id} value={level.id}>{level.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-xs uppercase tracking-wider text-ink-faint">
          Motif de la demande *
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setFeedback(null);
            }}
            rows={4}
            maxLength={2000}
            required
            placeholder="Évolution RP, correction du grade actuel, décision du serveur…"
            className={`mt-1 ${input}`}
          />
        </label>

        {candidate?.hasPendingRequest && (
          <p className="text-xs text-warning">Une demande est déjà en attente pour ce membre.</p>
        )}
        {feedback && (
          <p
            role="status"
            className={`border px-3 py-2 text-xs ${
              feedback.ok
                ? "border-gold-dim bg-gold-faint/30 text-gold"
                : "border-blood bg-blood/10 text-blood-bright"
            }`}
          >
            {feedback.text}
          </p>
        )}
        <Button
          type="submit"
          variant="gold"
          disabled={
            isPending ||
            !candidate ||
            candidate.hasPendingRequest ||
            !requestedLevelId ||
            reason.trim().length < 3
          }
        >
          {isPending ? "Transmission…" : "Transmettre la demande"}
        </Button>
      </form>
    </section>
  );
}
