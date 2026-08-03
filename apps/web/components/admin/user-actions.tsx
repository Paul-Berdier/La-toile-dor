"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setUserGroupMembershipAction,
  setUserRoleAction,
  setUserStatusAction,
  setUserLevelAction,
} from "@/server/admin-actions";
import { Button } from "@/components/ui/button";

export function UserActions({
  userId,
  status,
  roles,
  allRoles,
  groupMemberships,
  allGroups,
  playerLevelId,
  allLevels,
}: {
  userId: string;
  status: string;
  roles: string[];
  allRoles: { slug: string; name: string }[];
  groupMemberships: { groupId: string; isLeader: boolean }[];
  allGroups: { id: string; name: string; factionName: string | null }[];
  playerLevelId: string | null;
  allLevels: { id: string; label: string }[];
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

  const toggleGroup = (groupId: string, member: boolean) => {
    startTransition(async () => {
      const res = await setUserGroupMembershipAction({ userId, groupId, member });
      if (!res.ok) setError(res.error ?? "Échec.");
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  const setLevel = (nextPlayerLevelId: string) => {
    startTransition(async () => {
      const res = await setUserLevelAction({ userId, playerLevelId: nextPlayerLevelId });
      if (!res.ok) setError(res.error ?? "Échec.");
      else {
        setError(null);
        router.refresh();
      }
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

      <details className="text-xs">
        <summary className="cursor-pointer text-ink-faint hover:text-ink">
          Groupes ({groupMemberships.length})
        </summary>
        <div className="mt-1 max-h-48 space-y-1 overflow-y-auto border border-border-default bg-elevated p-2">
          {allGroups.map((group) => {
            const membership = groupMemberships.find((item) => item.groupId === group.id);
            return (
              <label key={group.id} className="flex items-start gap-1.5 text-ink-muted">
                <input
                  type="checkbox"
                  checked={Boolean(membership)}
                  onChange={() => toggleGroup(group.id, !membership)}
                  disabled={isPending || membership?.isLeader === true}
                  className="mt-0.5 accent-[var(--toile-gold)]"
                />
                <span>
                  {group.name}{group.factionName ? ` · ${group.factionName}` : ""}
                  {membership?.isLeader && <span className="ml-1 text-gold">(chef)</span>}
                </span>
              </label>
            );
          })}
          {allGroups.length === 0 && <p className="text-ink-faint italic">Aucun groupe actif.</p>}
        </div>
      </details>

      <label className="block text-xs text-ink-faint">
        Niveau
        <select
          value={playerLevelId ?? ""}
          onChange={(event) => setLevel(event.target.value)}
          disabled={isPending}
          className="mt-1 w-full border border-border-default bg-elevated px-2 py-1 text-xs text-ink"
        >
          <option value="" disabled>Choisir…</option>
          {allLevels.map((level) => (
            <option key={level.id} value={level.id}>{level.label}</option>
          ))}
        </select>
      </label>

      {error && <p className="text-xs text-blood-bright">{error}</p>}
    </div>
  );
}
