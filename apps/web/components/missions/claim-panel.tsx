"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ELIGIBILITY_MODE_LABELS } from "@toile/shared";
import { claimMissionAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

type EligibilityMode = "RECOMMENDATION" | "WARNING" | "STRICT" | "MANUAL_REVIEW";

interface GroupOption {
  id: string;
  name: string;
  memberCount: number;
  members: {
    id: string;
    displayName: string;
    levelLabel: string | null;
    levelOrder: number | null;
  }[];
}

const MODE_EXPLANATIONS: Record<EligibilityMode, string> = {
  RECOMMENDATION: "Les écarts restent visibles ici, sans signalement ni blocage.",
  WARNING: "Vous pouvez déposer la revendication ; les écarts seront signalés à vous et au tisseur.",
  STRICT: "Un niveau insuffisant, un niveau manquant ou le dépassement du maximum bloque le dépôt. Le minimum peut être atteint avec un groupe collaborateur.",
  MANUAL_REVIEW: "La revendication restera possible et sera marquée à contrôler, même si l'équipe est conforme.",
};

/** Panneau « Réclamer la mission » — réservé aux chefs de groupe. */
export function ClaimPanel({
  missionId,
  groups,
  eligibilityMode,
  groupSizeMin,
  groupSizeMax,
  minLevelOrder,
  minLevelLabel,
  requiresEnhancedReview,
}: {
  missionId: string;
  groups: GroupOption[];
  eligibilityMode: EligibilityMode;
  groupSizeMin: number;
  groupSizeMax: number;
  minLevelOrder: number | null;
  minLevelLabel: string | null;
  requiresEnhancedReview: boolean;
}) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [hiddenFromOthers, setHiddenFromOthers] = useState(true);
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

  const selectedGroup = groups.find((g) => g.id === groupId);
  const selectedMembers = selectedGroup?.members ?? [];
  const proposedMembers = selectedMembers.filter((member) => participantIds.includes(member.id));
  const belowMinimumHeadcount = participantIds.length < groupSizeMin;
  const aboveMaximumHeadcount = participantIds.length > groupSizeMax;
  const headcountIsValid = !belowMinimumHeadcount && !aboveMaximumHeadcount;
  const missingLevelMembers = minLevelOrder === null
    ? []
    : proposedMembers.filter((member) => member.levelOrder === null);
  const belowLevelMembers = minLevelOrder === null
    ? []
    : proposedMembers.filter(
        (member) => member.levelOrder !== null && member.levelOrder < minLevelOrder,
      );
  const levelIsValid = missingLevelMembers.length === 0 && belowLevelMembers.length === 0;
  const hasEligibilityGap = !headcountIsValid || !levelIsValid;
  // Le minimum concerne l'équipe finale, tous groupes réunis : une petite
  // candidature peut donc être complétée par un groupe collaborateur.
  const strictBlock =
    eligibilityMode === "STRICT" && (aboveMaximumHeadcount || !levelIsValid);

  const resetResult = () => setResult(null);

  const submit = () => {
    startTransition(async () => {
      const res = await claimMissionAction({
        missionId,
        groupId,
        participantIds,
        publicRoster: !hiddenFromOthers,
        message: message || undefined,
      });
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <section
        aria-live="polite"
        className={`border p-3 text-xs ${
          strictBlock
            ? "border-blood/60 bg-blood/10"
            : (hasEligibilityGap && eligibilityMode !== "RECOMMENDATION") ||
                eligibilityMode === "MANUAL_REVIEW" ||
                requiresEnhancedReview
              ? "border-warning/50 bg-warning/10"
              : "border-border-gold bg-gold-faint/20"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-ink">Éligibilité de l&rsquo;équipe</h3>
          <span className="font-mono-toile text-[0.65rem] uppercase text-gold">
            {ELIGIBILITY_MODE_LABELS[eligibilityMode]}
          </span>
        </div>
        <p className="mt-1 leading-relaxed text-ink-muted">
          {MODE_EXPLANATIONS[eligibilityMode]}
        </p>
        <dl className="mt-2 space-y-1 border-t border-border-default pt-2">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-ink-faint">Effectif final demandé</dt>
            <dd
              className={
                headcountIsValid
                  ? "text-success"
                  : aboveMaximumHeadcount
                    ? "text-warning"
                    : "text-ink-muted"
              }
            >
              {participantIds.length} sélectionné{participantIds.length > 1 ? "s" : ""} / {groupSizeMin} à {groupSizeMax}
              {headcountIsValid
                ? " · conforme"
                : aboveMaximumHeadcount
                  ? " · maximum dépassé"
                  : " · collaboration nécessaire"}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-ink-faint">Niveau des agents</dt>
            <dd className={levelIsValid ? "text-success" : "text-warning"}>
              {minLevelOrder === null || !minLevelLabel
                ? "aucun minimum"
                : proposedMembers.length === 0
                  ? `${minLevelLabel} minimum · équipe à sélectionner`
                  : levelIsValid
                    ? `${minLevelLabel} minimum · conforme`
                    : `${missingLevelMembers.length + belowLevelMembers.length} agent${missingLevelMembers.length + belowLevelMembers.length > 1 ? "s" : ""} à corriger`}
            </dd>
          </div>
        </dl>
        {(eligibilityMode === "MANUAL_REVIEW" || requiresEnhancedReview) && (
          <p className="mt-2 text-warning">
            Contrôle renforcé demandé : le tisseur devra confirmer sa vérification, même si tous les critères sont remplis.
          </p>
        )}
        {strictBlock && (
          <p className="mt-2 text-blood-bright">
            Le dépôt est bloqué : réduisez l&rsquo;effectif ou corrigez le niveau des agents signalés.
          </p>
        )}
      </section>

      <div>
        <label htmlFor="claim-group" className="mb-1 block text-xs text-ink-faint uppercase tracking-wider">
          Cellule candidate
        </label>
        <select
          id="claim-group"
          value={groupId}
          onChange={(e) => {
            resetResult();
            setGroupId(e.target.value);
            setParticipantIds([]);
            setHiddenFromOthers(true);
          }}
          className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold"
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {group.memberCount} membre{group.memberCount > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="mb-1 block text-xs text-ink-faint uppercase tracking-wider">
          Agents engagés *
        </legend>
        <div className="max-h-56 space-y-1 overflow-y-auto border border-border-default bg-elevated p-2">
          {selectedMembers.map((member) => {
            const selected = participantIds.includes(member.id);
            const levelMissing = member.levelOrder === null;
            const belowMinimum =
              minLevelOrder !== null && member.levelOrder !== null && member.levelOrder < minLevelOrder;
            const levelMeetsMinimum =
              minLevelOrder !== null && member.levelOrder !== null && member.levelOrder >= minLevelOrder;
            return (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-ink-muted hover:bg-hover-bg"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    resetResult();
                    setParticipantIds((current) =>
                      selected
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id],
                    );
                  }}
                  className="accent-[var(--toile-gold)]"
                />
                <Link
                  href={`/membres/${member.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="min-w-0 flex-1 truncate hover:text-gold hover:underline"
                  aria-label={`Voir la fiche de ${member.displayName}`}
                >
                  {member.displayName}
                </Link>
                <span
                  className={`text-right text-xs ${
                    levelMissing || belowMinimum
                      ? "text-warning"
                      : levelMeetsMinimum
                        ? "text-success"
                        : "text-ink-faint"
                  }`}
                >
                  {levelMissing
                    ? minLevelOrder === null
                      ? "niveau non renseigné"
                      : "niveau manquant · non conforme"
                    : belowMinimum
                      ? `${member.levelLabel} · sous le seuil`
                      : levelMeetsMinimum
                        ? `${member.levelLabel} · conforme`
                        : member.levelLabel}
                </span>
              </label>
            );
          })}
          {selectedMembers.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-faint italic">Aucun agent actif dans ce groupe.</p>
          )}
        </div>
        <p className={`mt-1 font-mono-toile text-xs ${headcountIsValid ? "text-success" : "text-gold"}`}>
          Effectif proposé : {participantIds.length} / {groupSizeMin} à {groupSizeMax}
          {belowMinimumHeadcount && " · un autre groupe pourra compléter l'équipe"}
        </p>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-2 border border-border-default bg-elevated px-3 py-2.5">
        <input
          type="checkbox"
          checked={hiddenFromOthers}
          onChange={(event) => setHiddenFromOthers(event.target.checked)}
          className="mt-0.5 accent-[var(--toile-gold)]"
        />
        <span>
          <span className="block text-sm text-ink">Équipe invisible pour les autres joueurs</span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            La modération voit toujours l’équipe. Si cette case est décochée, les autres
            verront uniquement le nom du groupe et les pseudonymes/titres publics des agents.
          </span>
        </span>
      </label>

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
        <ul role="status" className="space-y-1 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          {result.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}
      {result?.ok && (
        <p role="status" className="border border-gold-dim bg-gold-faint/30 px-3 py-2 text-xs text-gold">
          Revendication déposée. Le fil vibre — un tisseur l&rsquo;examinera.
        </p>
      )}

      {!result?.ok && (
        <Button
          variant="gold"
          size="lg"
          onClick={submit}
          disabled={isPending || participantIds.length === 0 || strictBlock}
          className="w-full"
        >
          {isPending
            ? "Le fil se tend…"
            : strictBlock
              ? "Corrigez l'équipe pour continuer"
              : "Réclamer la mission"}
        </Button>
      )}
    </div>
  );
}
