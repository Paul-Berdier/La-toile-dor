"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimMissionAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

interface GroupOption {
  id: string;
  name: string;
  memberCount: number;
  members: { id: string; displayName: string; levelLabel: string | null }[];
}

/** Panneau « Réclamer la mission » — réservé aux chefs de groupe. */
export function ClaimPanel({
  missionId,
  groups,
  eligibilityNotice,
}: {
  missionId: string;
  groups: GroupOption[];
  eligibilityNotice: string | null;
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
      {eligibilityNotice && (
        <p className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          {eligibilityNotice}
        </p>
      )}

      <div>
        <label htmlFor="claim-group" className="mb-1 block text-xs text-ink-faint uppercase tracking-wider">
          Cellule candidate
        </label>
        <select
          id="claim-group"
          value={groupId}
          onChange={(e) => {
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
            return (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm text-ink-muted hover:bg-hover-bg"
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    setParticipantIds((current) =>
                      selected
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id],
                    )
                  }
                  className="accent-[var(--toile-gold)]"
                />
                <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                <span className={member.levelLabel ? "text-xs text-ink-faint" : "text-xs text-warning"}>
                  {member.levelLabel ?? "niveau manquant"}
                </span>
              </label>
            );
          })}
          {selectedMembers.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-faint italic">Aucun agent actif dans ce groupe.</p>
          )}
        </div>
        <p className="mt-1 font-mono-toile text-xs text-gold">
          Effectif proposé : {participantIds.length}
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
        <Button
          variant="gold"
          size="lg"
          onClick={submit}
          disabled={isPending || participantIds.length === 0}
          className="w-full"
        >
          {isPending ? "Le fil se tend…" : "Réclamer la mission"}
        </Button>
      )}
    </div>
  );
}
