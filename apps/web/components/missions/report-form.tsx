"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitReportAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

export function ReportForm({ missionId }: { missionId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isFinal, setIsFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await submitReportAction({ missionId, content, isFinal });
      if (!res.ok) {
        setError(res.error ?? "Échec de l'envoi.");
      } else {
        setError(null);
        setContent("");
        setIsFinal(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor="report-content" className="block text-xs text-ink-faint uppercase tracking-wider">
        Nouveau rapport
      </label>
      <textarea
        id="report-content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        maxLength={20000}
        placeholder="Ce qui a été vu, fait, et ce qu'il en coûte…"
        className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
      />
      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={isFinal}
          onChange={(e) => setIsFinal(e.target.checked)}
          className="accent-[var(--toile-gold)]"
        />
        Rapport final (notifie les tisseurs)
      </label>
      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}
      <Button variant="outline" onClick={submit} disabled={isPending || content.trim().length < 10}>
        {isPending ? "Transmission…" : "Transmettre le rapport"}
      </Button>
    </div>
  );
}
