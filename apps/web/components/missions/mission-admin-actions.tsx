"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveMissionAction } from "@/server/mission-actions";
import { Button, buttonClasses } from "@/components/ui/button";

export function MissionAdminActions({
  missionId,
  canEdit,
  canDelete,
}: {
  missionId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const archive = () => {
    startTransition(async () => {
      const result = await archiveMissionAction({
        missionId,
        reason: reason.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "La suppression a échoué.");
        return;
      }
      router.push("/missions");
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && (
          <Link href={`/missions/${missionId}/modifier`} className={buttonClasses("outline", "sm")}>
            Modifier la mission
          </Link>
        )}
        {canDelete && !confirmDelete && (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            Supprimer la mission
          </Button>
        )}
      </div>

      {canDelete && confirmDelete && (
        <div className="ml-auto max-w-md border border-blood bg-blood/10 p-3">
          <p className="text-xs leading-relaxed text-blood-bright">
            La mission disparaîtra du tableau. Son historique et son audit seront conservés.
          </p>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
            placeholder="Motif de la suppression (facultatif)"
            aria-label="Motif de la suppression"
            className="mt-2 w-full border border-border-default bg-elevated px-2 py-1.5 text-xs text-ink"
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={isPending}>
              Annuler
            </Button>
            <Button variant="seal" size="sm" onClick={archive} disabled={isPending}>
              {isPending ? "Suppression…" : "Confirmer la suppression"}
            </Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-right text-xs text-blood-bright">{error}</p>}
    </div>
  );
}
