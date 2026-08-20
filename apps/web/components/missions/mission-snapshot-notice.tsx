"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncMissionSnapshotsAction, type SnapshotDiff } from "@/server/missions/editor-actions";
import { Button } from "@/components/ui/button";

/**
 * « Le dossier a changé depuis la publication. »
 *
 * Un ninja monte en grade, change de village : la mission qui le visait garde
 * ce qu'elle savait à l'époque — sinon un contrat de rang C se retrouverait
 * un beau matin à viser un Sanin, sans que personne ne l'ait décidé. La
 * modération voit l'écart, et choisit de synchroniser ou non.
 */
export function MissionSnapshotNotice({
  missionId,
  diffs,
}: {
  missionId: string;
  diffs: SnapshotDiff[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (diffs.length === 0) return null;

  return (
    <section className="border border-copper/60 bg-raised p-4">
      <h2 className="mb-1 font-display text-sm tracking-widest text-copper uppercase">
        Dossiers mis à jour depuis la publication
      </h2>
      <p className="mb-3 text-xs text-ink-faint">
        La mission conserve l&rsquo;état d&rsquo;alors. Synchroniser réécrit ce qu&rsquo;elle affiche —
        y compris son titre public.
      </p>
      <ul className="mb-3 space-y-1 text-xs text-ink-muted">
        {diffs.map((diff) => (
          <li key={diff.linkId}>
            <span className="text-ink">{diff.profileName}</span>
            <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{diff.profileCode}</span>
            {diff.gradeBefore !== diff.gradeAfter && (
              <span className="ml-2">
                grade : <span className="text-ink-faint">{diff.gradeBefore ?? "inconnu"}</span> →{" "}
                <span className="text-copper">{diff.gradeAfter ?? "inconnu"}</span>
              </span>
            )}
            {diff.factionBefore !== diff.factionAfter && (
              <span className="ml-2">
                origine : <span className="text-ink-faint">{diff.factionBefore ?? "inconnue"}</span> →{" "}
                <span className="text-copper">{diff.factionAfter ?? "inconnue"}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mb-2 text-xs text-blood-bright">{error}</p>}
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await syncMissionSnapshotsAction(missionId);
            if (!res.ok) setError(res.error ?? "La synchronisation a échoué.");
            else router.refresh();
          })
        }
      >
        Synchroniser la mission
      </Button>
    </section>
  );
}
