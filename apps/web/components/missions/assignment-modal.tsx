"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignMissionAction } from "@/server/assignment-actions";
import type { CardAssignmentInfo, CardClaimInfo } from "@/server/missions";
import { Button } from "@/components/ui/button";

export interface GroupCatalogEntry {
  id: string;
  name: string;
  factionName: string | null;
  memberCount: number;
  members: { id: string; displayName: string; levelLabel: string | null }[];
}

interface SelectedGroup {
  groupId: string;
  label: string;
  participantIds: string[];
  fromClaim: boolean;
}

/**
 * Modale d'attribution multi-groupes : ouverte AVANT tout passage
 * « en cours » (et depuis le détail d'une mission). Le statut n'est modifié
 * qu'après confirmation ; en cas d'échec la carte reste dans sa colonne.
 */
export function AssignmentModal({
  missionCode,
  missionRank,
  missionId,
  claims,
  assignments,
  catalog,
  start,
  onClose,
  onDone,
}: {
  missionCode: string;
  missionRank: string;
  missionId: string;
  claims: CardClaimInfo[];
  assignments: CardAssignmentInfo[];
  catalog: GroupCatalogEntry[];
  /** true : confirmer démarre la mission (En cours) */
  start: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const router = useRouter();

  // Pré-sélection : attributions actives, sinon revendications en attente
  const [selected, setSelected] = useState<SelectedGroup[]>(() =>
    assignments.length > 0
      ? assignments.map((a) => ({
          groupId: a.groupId,
          label: `${a.groupName}${a.factionName ? ` · ${a.factionName}` : ""}`,
          participantIds: a.participantIds,
          fromClaim: false,
        }))
      : [],
  );
  const [leadId, setLeadId] = useState<string | null>(
    assignments.find((a) => a.isLead)?.groupId ?? null,
  );
  const [addingId, setAddingId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSelected = (groupId: string) => selected.some((s) => s.groupId === groupId);

  const toggleClaim = (claim: CardClaimInfo) => {
    setSelected((prev) =>
      prev.some((s) => s.groupId === claim.groupId)
        ? prev.filter((s) => s.groupId !== claim.groupId)
        : [
            ...prev,
            {
              groupId: claim.groupId,
              label: `${claim.groupName}${claim.factionName ? ` · ${claim.factionName}` : ""}`,
              participantIds: claim.participantIds,
              fromClaim: true,
            },
          ],
    );
  };

  const addFromCatalog = () => {
    const entry = catalog.find((c) => c.id === addingId);
    if (!entry || isSelected(entry.id)) return;
    setSelected((prev) => [
      ...prev,
      {
        groupId: entry.id,
        label: `${entry.name}${entry.factionName ? ` · ${entry.factionName}` : ""}`,
        participantIds: [],
        fromClaim: false,
      },
    ]);
    setAddingId("");
  };

  const toggleParticipant = (groupId: string, userId: string) =>
    setSelected((prev) =>
      prev.map((entry) =>
        entry.groupId === groupId
          ? {
              ...entry,
              participantIds: entry.participantIds.includes(userId)
                ? entry.participantIds.filter((id) => id !== userId)
                : [...entry.participantIds, userId],
            }
          : entry,
      ),
    );

  const total = useMemo(
    () => selected.reduce((sum, entry) => sum + entry.participantIds.length, 0),
    [selected],
  );
  const missingParticipants = selected.some((entry) => entry.participantIds.length === 0);

  const confirm = () => {
    if (isPending || selected.length === 0 || missingParticipants) return;
    startTransition(async () => {
      const res = await assignMissionAction({
        missionId,
        start,
        reason: reason || undefined,
        assignments: selected.map((s) => ({
          groupId: s.groupId,
          participantIds: s.participantIds,
          isLead: s.groupId === leadId,
        })),
      });
      if (!res.ok) {
        setError(res.error ?? "L'attribution a échoué.");
      } else {
        onDone?.();
        onClose();
        router.refresh();
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Attribuer la mission ${missionCode}`}
      className="fixed inset-0 z-[90] flex items-end justify-center bg-obsidian/80 sm:items-center sm:px-4"
    >
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto border border-border-gold bg-raised p-5 shadow-modal sm:max-h-[85dvh]">
        <h2 className="font-display text-base tracking-widest text-gold uppercase">
          Constituer l&rsquo;équipe — [{missionRank}] {missionCode}
        </h2>
        <p className="mt-1 text-xs text-ink-faint">
          {start
            ? "La mission ne passera « en cours » qu'après confirmation."
            : "Les groupes sélectionnés recevront l'accès au dossier."}
        </p>

        {/* Revendications en attente, mises en avant */}
        {claims.length > 0 && (
          <fieldset className="mt-4">
            <legend className="mb-1 text-xs uppercase tracking-wider text-ink-faint">
              Groupes ayant revendiqué
            </legend>
            <div className="space-y-1.5">
              {claims.map((claim) => (
                <label
                  key={claim.groupId}
                  className="flex cursor-pointer items-center gap-2 border border-border-default bg-elevated px-3 py-2 text-sm text-ink-muted has-[:checked]:border-gold"
                >
                  <input
                    type="checkbox"
                    checked={isSelected(claim.groupId)}
                    onChange={() => toggleClaim(claim)}
                    className="accent-[var(--toile-gold)]"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {claim.groupName}{claim.factionName ? ` · ${claim.factionName}` : ""}
                  </span>
                  <span className="font-mono-toile text-xs text-ink-faint">
                    propose {claim.headcount}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* Ajout manuel */}
        <div className="mt-4 flex gap-2">
          <label htmlFor="assign-add" className="sr-only">
            Ajouter un autre groupe
          </label>
          <select
            id="assign-add"
            value={addingId}
            onChange={(e) => setAddingId(e.target.value)}
            className="min-w-0 flex-1 border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink"
          >
            <option value="">Ajouter un autre groupe…</option>
            {catalog
              .filter((entry) => !isSelected(entry.id))
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}{entry.factionName ? ` · ${entry.factionName}` : ""} ({entry.memberCount} membres)
                </option>
              ))}
          </select>
          <Button variant="outline" size="sm" onClick={addFromCatalog} disabled={!addingId}>
            Ajouter
          </Button>
        </div>

        {/* Effectifs par groupe + groupe principal */}
        {selected.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-ink-faint">
              Agents par groupe · groupe principal
            </p>
            {selected.map((entry) => {
              const agents = catalog.find((group) => group.id === entry.groupId)?.members ?? [];
              return (
                <fieldset key={entry.groupId} className="border border-border-default bg-elevated p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <legend className="min-w-0 flex-1 truncate text-sm text-ink">{entry.label}</legend>
                    <span className="font-mono-toile text-xs text-gold">
                      {entry.participantIds.length} agent{entry.participantIds.length > 1 ? "s" : ""}
                    </span>
                    <label className="flex items-center gap-1 text-[0.7rem] text-ink-muted">
                      <input
                        type="radio"
                        name="lead-group"
                        checked={leadId === entry.groupId}
                        onChange={() => setLeadId(entry.groupId)}
                        className="accent-[var(--toile-gold)]"
                      />
                      principal
                    </label>
                    <button
                      type="button"
                      onClick={() => setSelected((prev) => prev.filter((s) => s.groupId !== entry.groupId))}
                      aria-label={`Retirer ${entry.label}`}
                      className="text-ink-faint hover:text-blood-bright"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-border-default pt-2">
                    {agents.map((agent) => (
                      <label key={agent.id} className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                        <input
                          type="checkbox"
                          checked={entry.participantIds.includes(agent.id)}
                          onChange={() => toggleParticipant(entry.groupId, agent.id)}
                          className="accent-[var(--toile-gold)]"
                        />
                        <span className="min-w-0 flex-1 truncate">{agent.displayName}</span>
                        <span className={agent.levelLabel ? "text-ink-faint" : "text-warning"}>
                          {agent.levelLabel ?? "niveau manquant"}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}

        {/* Résumé de confirmation */}
        <div className="mt-4 border-t border-border-default pt-3 text-sm">
          {selected.length === 0 ? (
            <p className="text-ink-faint italic">Aucun groupe sélectionné.</p>
          ) : (
            <>
              <ul className="space-y-0.5 text-xs text-ink-muted">
                {selected.map((entry) => (
                  <li key={entry.groupId}>
                    · {entry.label} : {entry.participantIds.length} agent{entry.participantIds.length > 1 ? "s" : ""}
                    {leadId === entry.groupId ? " — principal" : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-mono-toile text-gold">
                Effectif total : {total}
              </p>
            </>
          )}
        </div>

        <label htmlFor="assign-reason" className="mt-3 block text-xs text-ink-faint">
          Note (facultative, journalisée)
        </label>
        <input
          id="assign-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          className="mt-1 w-full border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink"
        />

        {error && (
          <p role="alert" className="mt-3 border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button
            variant="gold"
            onClick={confirm}
            disabled={isPending || selected.length === 0 || missingParticipants}
          >
            {isPending
              ? "Tissage…"
              : start
                ? "Confirmer l'attribution et démarrer la mission"
                : "Confirmer l'attribution"}
          </Button>
        </div>
      </div>
    </div>
  );
}
