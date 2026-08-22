"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { assignMissionAction } from "@/server/assignment-actions";
import type {
  AgentOption,
  CardAssignmentInfo,
  CardClaimInfo,
  MissionEligibilityConfig,
} from "@/server/missions";
import { Button } from "@/components/ui/button";
import { evaluateTeamEligibility } from "@toile/shared";

export interface GroupCatalogEntry {
  id: string;
  name: string;
  factionName: string | null;
  memberCount: number;
  members: AgentOption[];
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
  eligibility,
  start,
  enforceFinalCriteria = false,
  onClose,
  onDone,
}: {
  missionCode: string;
  missionRank: string;
  missionId: string;
  claims: CardClaimInfo[];
  assignments: CardAssignmentInfo[];
  catalog: GroupCatalogEntry[];
  eligibility: MissionEligibilityConfig;
  /** true : confirmer démarre la mission (En cours) */
  start: boolean;
  /** true : la mission est déjà en cours, l'équipe doit donc rester complète. */
  enforceFinalCriteria?: boolean;
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
      : claims.map((claim) => ({
          groupId: claim.groupId,
          label: `${claim.groupName}${claim.factionName ? ` · ${claim.factionName}` : ""}`,
          participantIds: claim.participantIds,
          fromClaim: true,
        })),
  );
  const [leadId, setLeadId] = useState<string | null>(
    assignments.find((a) => a.isLead)?.groupId ?? claims[0]?.groupId ?? null,
  );
  const [addingId, setAddingId] = useState("");
  const [reason, setReason] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isSelected = (groupId: string) => selected.some((s) => s.groupId === groupId);

  const toggleClaim = (claim: CardClaimInfo) => {
    const removing = isSelected(claim.groupId);
    if (removing && leadId === claim.groupId) setLeadId(null);
    if (!removing && leadId == null) setLeadId(claim.groupId);
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
    if (leadId == null) setLeadId(entry.id);
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

  const selectedAgents = useMemo(() => {
    const groups = new Map(catalog.map((entry) => [entry.id, entry]));
    return selected.flatMap((entry) => {
      const agents = new Map(
        (groups.get(entry.groupId)?.members ?? []).map((agent) => [agent.id, agent]),
      );
      return entry.participantIds.map(
        (userId): AgentOption =>
          agents.get(userId) ?? {
            id: userId,
            displayName: "Agent indisponible",
            levelLabel: null,
            levelOrder: null,
          },
      );
    });
  }, [catalog, selected]);

  const eligibilityIssues = useMemo(
    () =>
      evaluateTeamEligibility({
        participantLevels: selectedAgents.map((agent) => agent.levelOrder),
        groupSizeMin: eligibility.groupSizeMin,
        groupSizeMax: eligibility.groupSizeMax,
        minLevel: eligibility.minRecommendedLevel,
      }),
    [eligibility, selectedAgents],
  );
  const missingLevelCount = selectedAgents.filter(
    (agent) => eligibility.minRecommendedLevel && agent.levelOrder == null,
  ).length;
  const belowLevelCount = selectedAgents.filter(
    (agent) =>
      eligibility.minRecommendedLevel != null &&
      agent.levelOrder != null &&
      agent.levelOrder < eligibility.minRecommendedLevel.order,
  ).length;
  const conformingLevelCount = eligibility.minRecommendedLevel
    ? selectedAgents.length - missingLevelCount - belowLevelCount
    : selectedAgents.length;
  const finalTeamRequired = start || enforceFinalCriteria;
  const strictBlockingIssues = eligibilityIssues.filter(
    (issue) => issue.blocksStrict || (finalTeamRequired && issue.code === "below_min"),
  );
  const strictBlocked =
    eligibility.eligibilityMode === "STRICT" && strictBlockingIssues.length > 0;
  const enhancedReviewIncomplete =
    eligibility.requiresEnhancedReview &&
    (!reviewConfirmed || reason.trim().length === 0);
  const totalFits =
    total >= eligibility.groupSizeMin && total <= eligibility.groupSizeMax;
  const criteriaAreAdvisory = eligibility.eligibilityMode === "RECOMMENDATION";
  const confirmDisabled =
    isPending ||
    selected.length === 0 ||
    missingParticipants ||
    strictBlocked ||
    enhancedReviewIncomplete;

  const confirm = () => {
    if (confirmDisabled) return;
    startTransition(async () => {
      const res = await assignMissionAction({
        missionId,
        start,
        reason: reason || undefined,
        reviewConfirmed,
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
                      onClick={() => {
                        setSelected((prev) => prev.filter((s) => s.groupId !== entry.groupId));
                        if (leadId === entry.groupId) setLeadId(null);
                      }}
                      aria-label={`Retirer ${entry.label}`}
                      className="text-ink-faint hover:text-blood-bright"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-border-default pt-2">
                    {agents.map((agent) => {
                      const selectedAgent = entry.participantIds.includes(agent.id);
                      const hasMinimum =
                        eligibility.minRecommendedLevel == null ||
                        (agent.levelOrder != null &&
                          agent.levelOrder >= eligibility.minRecommendedLevel.order);
                      const shouldSignal =
                        selectedAgent &&
                        !hasMinimum &&
                        eligibility.eligibilityMode !== "RECOMMENDATION";
                      return (
                        <label
                          key={agent.id}
                          className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted"
                        >
                          <input
                            type="checkbox"
                            checked={selectedAgent}
                            onChange={() => toggleParticipant(entry.groupId, agent.id)}
                            className="accent-[var(--toile-gold)]"
                          />
                          <Link
                            href={`/membres/${agent.id}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="min-w-0 flex-1 truncate hover:text-gold hover:underline"
                            aria-label={`Voir la fiche de ${agent.displayName}`}
                          >
                            {agent.displayName}
                          </Link>
                          <span className={shouldSignal ? "text-warning" : "text-ink-faint"}>
                            {agent.levelLabel ?? "niveau manquant"}
                            {selectedAgent && eligibility.minRecommendedLevel && (
                              <span className="ml-1" aria-label={hasMinimum ? "conforme" : "écart"}>
                                {hasMinimum ? "✓" : "⚠"}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
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
              <div className="mt-3 space-y-1 border border-border-default bg-elevated px-3 py-2 text-xs">
                <p
                  className={
                    criteriaAreAdvisory ? "text-ink-muted" : totalFits ? "text-success" : "text-warning"
                  }
                >
                  Effectif : {total} / {eligibility.groupSizeMin} à {eligibility.groupSizeMax}{" "}
                  {totalFits
                    ? "✓"
                    : criteriaAreAdvisory
                      ? "— indicatif"
                      : total < eligibility.groupSizeMin
                        ? "— équipe à compléter"
                        : "⚠"}
                </p>
                {eligibility.minRecommendedLevel ? (
                  <p
                    className={
                      criteriaAreAdvisory
                        ? "text-ink-muted"
                        : missingLevelCount + belowLevelCount === 0
                          ? "text-success"
                          : "text-warning"
                    }
                  >
                    Niveau minimal : {eligibility.minRecommendedLevel.label} · {conformingLevelCount}{" "}
                    conforme{conformingLevelCount > 1 ? "s" : ""}
                    {belowLevelCount > 0 && ` · ${belowLevelCount} insuffisant${belowLevelCount > 1 ? "s" : ""}`}
                    {missingLevelCount > 0 && ` · ${missingLevelCount} manquant${missingLevelCount > 1 ? "s" : ""}`}
                  </p>
                ) : (
                  <p className="text-ink-faint">Aucun niveau minimal demandé.</p>
                )}
                {eligibility.eligibilityMode === "RECOMMENDATION" && eligibilityIssues.length > 0 && (
                  <p className="text-ink-faint">Critères indicatifs : ils ne bloquent pas l'attribution.</p>
                )}
                {(eligibility.eligibilityMode === "WARNING" ||
                  eligibility.eligibilityMode === "MANUAL_REVIEW") &&
                  eligibilityIssues.length > 0 && (
                  <p className="text-warning">Attribution autorisée, avec écarts signalés.</p>
                )}
                {eligibility.eligibilityMode === "STRICT" && strictBlockingIssues.length > 0 && (
                  <p className="text-blood-bright">
                    {start ? "Démarrage" : enforceFinalCriteria ? "Modification" : "Attribution"} impossible :{" "}
                    {strictBlockingIssues.map((issue) => issue.message).join(" ")}
                  </p>
                )}
                {eligibility.eligibilityMode === "STRICT" && !finalTeamRequired && total < eligibility.groupSizeMin && (
                  <p className="text-warning">
                    Attribution partielle autorisée ; l'effectif devra être complété avant le démarrage.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {eligibility.requiresEnhancedReview && (
          <div className="mt-3 border border-warning/60 bg-warning/5 px-3 py-2 text-xs text-ink-muted">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(event) => setReviewConfirmed(event.target.checked)}
                className="mt-0.5 accent-[var(--toile-gold)]"
              />
              <span>
                J'ai effectué le contrôle renforcé de l'équipe. Une note de contrôle est obligatoire.
              </span>
            </label>
          </div>
        )}

        <label htmlFor="assign-reason" className="mt-3 block text-xs text-ink-faint">
          Note {eligibility.requiresEnhancedReview ? "de contrôle (obligatoire)" : "(facultative, journalisée)"}
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
            disabled={confirmDisabled}
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
