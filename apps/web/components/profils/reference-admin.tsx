"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  toggleReferenceOptionAction,
  createReferenceOptionAction,
  reviewSuggestionAction,
} from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

const input = "border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink focus:border-gold";

export function ToggleOptionButton({ optionId, isActive }: { optionId: string; isActive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button size="sm" variant={isActive ? "ghost" : "outline"} disabled={isPending}
      onClick={() => startTransition(async () => {
        await toggleReferenceOptionAction({ optionId, isActive: !isActive });
        router.refresh();
      })}>
      {isActive ? "Désactiver" : "Réactiver"}
    </Button>
  );
}

export function CreateOptionForm({ types }: { types: { value: string; label: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState(types[0]?.value ?? "");
  const [labelText, setLabelText] = useState("");
  const [scope, setScope] = useState("SERVER_CUSTOM");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={input}>
        {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Nouveau libellé"
        aria-label="Libellé" maxLength={120} className={input} />
      <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Provenance" className={input}>
        <option value="SERVER_CUSTOM">Serveur</option>
        <option value="MANGA_CANON">Manga</option>
        <option value="ANIME">Anime</option>
        <option value="FILM">Film</option>
        <option value="GAME">Jeu</option>
      </select>
      <Button size="sm" variant="gold" disabled={isPending || !labelText.trim()}
        onClick={() => startTransition(async () => {
          const res = await createReferenceOptionAction({ type, proposedLabel: labelText, sourceScope: scope });
          if (!res.ok) setError(res.error ?? "Échec.");
          else { setLabelText(""); setError(null); router.refresh(); }
        })}>
        Créer l&rsquo;option
      </Button>
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
    </div>
  );
}

export function SuggestionReview({
  suggestionId,
  sameTypeOptions,
}: {
  suggestionId: string;
  sameTypeOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [mergedIntoId, setMergedIntoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (decision: "APPROVED" | "REJECTED" | "MERGED") => {
    if (isPending) return;
    startTransition(async () => {
      const res = await reviewSuggestionAction({
        suggestionId,
        decision,
        mergedIntoId: decision === "MERGED" ? mergedIntoId : undefined,
      });
      if (!res.ok) setError(res.error ?? "Échec.");
      else { setError(null); router.refresh(); }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="gold" onClick={() => decide("APPROVED")} disabled={isPending}>Approuver</Button>
      <Button size="sm" variant="danger" onClick={() => decide("REJECTED")} disabled={isPending}>Refuser</Button>
      <select value={mergedIntoId} onChange={(e) => setMergedIntoId(e.target.value)}
        aria-label="Fusionner avec" className={input}>
        <option value="">Fusionner avec…</option>
        {sameTypeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => decide("MERGED")} disabled={isPending || !mergedIntoId}>
        Fusionner (alias)
      </Button>
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
    </div>
  );
}
