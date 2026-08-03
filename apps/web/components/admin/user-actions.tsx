"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserStatusAction, setUserRoleAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";

export function UserActions({
  userId,
  status,
  roles,
  allRoles,
}: {
  userId: string;
  status: string;
  roles: string[];
  allRoles: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setStatus = (next: "ACTIVE" | "SUSPENDED" | "REVOKED") => {
    startTransition(async () => {
      const res = await setUserStatusAction({ userId, status: next, reason: reason || undefined });
      if (!res.ok) setError(res.error ?? "Échec.");
      else {
        setError(null);
        setConfirmRevoke(false);
        router.refresh();
      }
    });
  };

  const toggleRole = (slug: string, grant: boolean) => {
    startTransition(async () => {
      const res = await setUserRoleAction({ userId, roleSlug: slug, grant });
      if (!res.ok) setError(res.error ?? "Échec.");
      else router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {status === "PENDING" && (
          <Button size="sm" variant="gold" onClick={() => setStatus("ACTIVE")} disabled={isPending}>
            Approuver
          </Button>
        )}
        {status === "ACTIVE" && (
          <Button size="sm" variant="outline" onClick={() => setStatus("SUSPENDED")} disabled={isPending}>
            Suspendre
          </Button>
        )}
        {(status === "SUSPENDED" || status === "REVOKED") && (
          <Button size="sm" variant="outline" onClick={() => setStatus("ACTIVE")} disabled={isPending}>
            Réactiver
          </Button>
        )}
        {status !== "REVOKED" &&
          (confirmRevoke ? (
            <>
              <Button size="sm" variant="seal" onClick={() => setStatus("REVOKED")} disabled={isPending}>
                Confirmer la révocation
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                Annuler
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirmRevoke(true)} disabled={isPending}>
              Révoquer
            </Button>
          ))}
      </div>

      {confirmRevoke && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motif (journalisé)"
          aria-label="Motif de révocation"
          className="w-full border border-border-default bg-elevated px-2 py-1 text-xs text-ink"
        />
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-ink-faint hover:text-ink">Rôles</summary>
        <div className="mt-1 flex flex-wrap gap-2">
          {allRoles.map((role) => {
            const has = roles.includes(role.slug);
            return (
              <label key={role.slug} className="flex items-center gap-1 text-ink-muted">
                <input
                  type="checkbox"
                  checked={has}
                  onChange={() => toggleRole(role.slug, !has)}
                  disabled={isPending}
                  className="accent-[var(--toile-gold)]"
                />
                {role.name}
              </label>
            );
          })}
        </div>
      </details>

      {error && <p className="text-xs text-blood-bright">{error}</p>}
    </div>
  );
}
