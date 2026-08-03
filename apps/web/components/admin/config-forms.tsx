"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateRpTimeAction,
  updateRankConfigAction,
  updateLevelLabelAction,
  createSeasonAction,
  adjustScoreAction,
  createFactionAction,
  createGroupAction,
} from "@/server/admin-actions";
import { Button } from "@/components/ui/button";

const input =
  "border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink focus:border-gold";

function useAction() {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    startTransition(async () => {
      const res = await fn();
      setMessage(res.ok ? { ok: true, text: okText } : { ok: false, text: res.error ?? "Échec." });
      if (res.ok) router.refresh();
    });
  return { run, message, isPending };
}

function Feedback({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role="status" className={`mt-2 text-xs ${message.ok ? "text-success" : "text-blood-bright"}`}>
      {message.text}
    </p>
  );
}

// ── Temps RP ─────────────────────────────────────────────────

export function RpTimeForm({ current }: { current: { realMsPerRpMonth: number; rpMonthsPerYear: number; realEpochIso: string; rpEpochYear: number } }) {
  const [hoursPerMonth, setHoursPerMonth] = useState(current.realMsPerRpMonth / 3_600_000);
  const [monthsPerYear, setMonthsPerYear] = useState(current.rpMonthsPerYear ?? 7);
  const { run, message, isPending } = useAction();

  const weeksPerRpYear = (monthsPerYear * hoursPerMonth) / 168;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-faint">
          Heures réelles pour un mois RP
          <input
            type="number"
            min={0.02}
            step={1}
            value={hoursPerMonth}
            onChange={(e) => setHoursPerMonth(Number(e.target.value) || 24)}
            className={`${input} mt-1 block w-32`}
          />
        </label>
        <label className="text-xs text-ink-faint">
          Mois RP dans une année RP
          <input
            type="number"
            min={1}
            max={24}
            step={1}
            value={monthsPerYear}
            onChange={(e) => setMonthsPerYear(Number(e.target.value) || 7)}
            className={`${input} mt-1 block w-32`}
          />
        </label>
        <p className="pb-2 text-xs text-ink-muted">
          ⇒ 1 année RP = {weeksPerRpYear.toFixed(1).replace(".", ",")} semaine(s) réelle(s)
          {Math.abs(weeksPerRpYear - 1) < 0.01 ? " (règle du serveur : 1 semaine = 1 an)" : ""}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(
              () =>
                updateRpTimeAction({
                  realMsPerRpMonth: Math.round(hoursPerMonth * 3_600_000),
                  rpMonthsPerYear: Math.round(monthsPerYear),
                  realEpochIso: current.realEpochIso,
                  rpEpochYear: current.rpEpochYear,
                }),
              "Ratio de temps RP enregistré.",
            )
          }
        >
          Enregistrer
        </Button>
      </div>
      <Feedback message={message} />
    </div>
  );
}

// ── Rangs ────────────────────────────────────────────────────

const RANK_FIELD_LABELS: Record<string, string> = {
  rewardRyoMin: "Ryōs minimum",
  rewardRyoMax: "Ryōs maximum",
  defaultPoints: "Points par défaut",
  recommendedGroupSize: "Effectif conseillé",
};

export function RankRow({ rank }: { rank: { rank: string; rewardRyoMin: number; rewardRyoMax: number; defaultPoints: number; recommendedGroupSize: number } }) {
  const [values, setValues] = useState(rank);
  const { run, message, isPending } = useAction();

  const set = (key: keyof typeof values, value: number) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <tr className="border-b border-border-default">
      <td className="px-3 py-2 font-display text-gold">{rank.rank}</td>
      {(["rewardRyoMin", "rewardRyoMax", "defaultPoints", "recommendedGroupSize"] as const).map(
        (key) => (
          <td key={key} className="px-3 py-2">
            <input
              type="number"
              aria-label={`${RANK_FIELD_LABELS[key]} du rang ${rank.rank}`}
              value={values[key]}
              min={0}
              onChange={(e) => set(key, Number(e.target.value) || 0)}
              className={`${input} w-28`}
            />
          </td>
        ),
      )}
      <td className="px-3 py-2">
        <Button size="sm" variant="ghost" disabled={isPending}
          onClick={() => run(() => updateRankConfigAction(values), "Rang mis à jour.")}>
          Enregistrer
        </Button>
        <Feedback message={message} />
      </td>
    </tr>
  );
}

// ── Niveaux ──────────────────────────────────────────────────

export function LevelRow({ level }: { level: { slug: string; label: string; order: number } }) {
  const [label, setLabel] = useState(level.label);
  const { run, message, isPending } = useAction();
  return (
    <li className="flex items-center gap-2">
      <span className="w-6 text-right font-mono-toile text-xs text-ink-faint">{level.order}</span>
      <input value={label} onChange={(e) => setLabel(e.target.value)}
        aria-label={`Libellé du niveau ${level.order}`} className={`${input} flex-1`} />
      <Button size="sm" variant="ghost" disabled={isPending || label === level.label}
        onClick={() => run(() => updateLevelLabelAction({ slug: level.slug, label }), "Renommé.")}>
        Enregistrer
      </Button>
      <Feedback message={message} />
    </li>
  );
}

// ── Saisons ──────────────────────────────────────────────────

export function SeasonForm() {
  const [name, setName] = useState("");
  const { run, message, isPending } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Saison II — …" aria-label="Nom de la nouvelle saison" className={`${input} w-64`} />
      <Button size="sm" variant="outline" disabled={isPending || !name.trim()}
        onClick={() => run(() => createSeasonAction({ name }), "Saison ouverte (l'ancienne est close).")}>
        Ouvrir une nouvelle saison
      </Button>
      <Feedback message={message} />
    </div>
  );
}

// ── Ajustement de points ─────────────────────────────────────

const SCORE_REASONS = [
  ["MANUAL_ADJUSTMENT", "Ajustement manuel"],
  ["SPEED_BONUS", "Bonus de rapidité"],
  ["STEALTH_BONUS", "Bonus de discrétion"],
  ["SECONDARY_OBJECTIVES", "Objectifs secondaires"],
  ["REPORT_QUALITY", "Qualité du rapport"],
  ["ADMIN_PENALTY", "Pénalité administrative"],
  ["ABANDON", "Abandon"],
  ["RP_VIOLATION", "Non-respect des règles RP"],
] as const;

export function ScoreAdjustForm({
  groups,
}: {
  groups: { id: string; name: string; factionName: string | null }[];
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [points, setPoints] = useState(0);
  const [reason, setReason] = useState<string>("MANUAL_ADJUSTMENT");
  const [justification, setJustification] = useState("");
  const { run, message, isPending } = useAction();

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-ink-faint">
        Groupe
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}
          className={`${input} mt-1 block w-full`}>
          <option value="">—</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}{group.factionName ? ` · ${group.factionName}` : " · Sans faction"}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-ink-faint">
        Points (négatif = pénalité)
        <input type="number" value={points} onChange={(e) => setPoints(Number(e.target.value) || 0)}
          className={`${input} mt-1 block w-full`} />
      </label>
      <label className="text-xs text-ink-faint">
        Motif
        <select value={reason} onChange={(e) => setReason(e.target.value)}
          className={`${input} mt-1 block w-full`}>
          {SCORE_REASONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-faint sm:col-span-2">
        Justification (obligatoire, inscrite au registre)
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)}
          rows={2} className={`${input} mt-1 block w-full`} />
      </label>
      <div className="sm:col-span-2">
        <Button size="sm" variant="gold" disabled={isPending || !groupId || points === 0 || justification.trim().length < 3}
          onClick={() =>
            run(
              () =>
                adjustScoreAction({
                  groupId,
                  points,
                  reason,
                  justification,
                }),
              "Points inscrits au registre.",
            )
          }>
          Inscrire au registre
        </Button>
        <Feedback message={message} />
      </div>
    </div>
  );
}

// ── Factions / groupes ───────────────────────────────────────

export function FactionCreateForm() {
  const [name, setName] = useState("");
  const { run, message, isPending } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la faction"
        aria-label="Nom de la nouvelle faction" className={`${input} w-64`} />
      <Button size="sm" variant="outline" disabled={isPending || !name.trim()}
        onClick={() => run(() => createFactionAction({ name }), "Faction créée.")}>
        Créer la faction
      </Button>
      <Feedback message={message} />
    </div>
  );
}

export function GroupCreateForm({ factionId }: { factionId?: string }) {
  const [name, setName] = useState("");
  const { run, message, isPending } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nouvelle cellule"
        aria-label="Nom du nouveau groupe" className={`${input} w-48`} />
      <Button size="sm" variant="ghost" disabled={isPending || !name.trim()}
        onClick={() => run(() => createGroupAction({ factionId, name }), "Groupe créé.")}>
        Ajouter
      </Button>
      <Feedback message={message} />
    </div>
  );
}
