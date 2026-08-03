"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimMissionAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

interface GroupOption {
  id: string;
  name: string;
  memberCount: number;
}

/** Panneau « Réclamer la mission » — réservé aux chefs de faction. */
export function ClaimPanel({
  missionId,
  groups,
  levelWarning,
}: {
  missionId: string;
  groups: GroupOption[];
  levelWarning: string | null;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ error?: string; warnings?: string[]; ok?: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) {
    return (
      <p className="text-sm text-ink-faint italic">
        Vous ne dirigez aucun groupe actif : seules les cellules constituées peuvent saisir un fil.
      </p>
    );
  }

  const submit = () => {
    startTransition(async () => {
      const res = await claimMissionAction({ missionId, groupId, message: message || undefined });
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {levelWarning && (
        <p className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          {levelWarning}
        </p>
      )}

      <div>
        <label htmlFor="claim-group" className="mb-1 block text-xs text-ink-faint uppercase tracking-wider">
          Cellule candidate
        </label>
        <select
          id="claim-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold"
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {group.memberCount} membre{group.memberCount > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="claim-message" className="mb-1 block text-xs text-ink-faint uppercase tracking-wider">
          Message au tisseur (facultatif)
        </label>
        <textarea
          id="claim-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Pourquoi votre cellule mérite ce fil…"
          className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
        />
      </div>

      {result?.error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {result.error}
        </p>
      )}
      {result?.warnings && result.warnings.length > 0 && (
        <ul className="space-y-1 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          {result.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      {result?.ok && (
        <p className="border border-gold-dim bg-gold-faint/30 px-3 py-2 text-xs text-gold">
          Revendication déposée. Le fil vibre — un tisseur l&rsquo;examinera.
        </p>
      )}

      {!result?.ok && (
        <Button variant="gold" size="lg" onClick={submit} disabled={isPending} className="w-full">
          {isPending ? "Le fil se tend…" : "Réclamer la mission"}
        </Button>
      )}
    </div>
  );
}
