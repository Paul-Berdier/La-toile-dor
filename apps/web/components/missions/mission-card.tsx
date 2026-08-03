import Link from "next/link";
import { categoryLabel, formatRyoRange } from "@toile/shared";
import type { BoardCard } from "@/server/missions";
import { RankSeal } from "./rank-seal";

/** Carte de mission du Kanban — n'affiche QUE des champs déjà filtrés côté serveur. */
export function MissionCard({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  const { view } = card;
  const urgent =
    view.timeRemaining.realMs !== null &&
    !view.timeRemaining.expired &&
    view.timeRemaining.realMs < 48 * 3600 * 1000;

  return (
    <Link
      href={`/missions/${view.id}`}
      className={`group block border bg-elevated p-3 shadow-card transition-all duration-200 ${
        dragging
          ? "rotate-1 border-gold shadow-gold"
          : "border-border-default hover:border-border-gold hover:shadow-gold"
      }`}
    >
      <div className="flex items-start gap-3">
        <RankSeal rank={view.rank} size={38} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono-toile text-[0.65rem] tracking-wider text-ink-faint">
            {view.code}
            {view.hasConfidential && (
              <span title="Dossier confidentiel" aria-label="Dossier confidentiel">
                <SpiderGlyph />
              </span>
            )}
          </p>
          <h3 className="truncate text-sm font-medium text-ink group-hover:text-gold-bright">
            {view.publicTitle}
          </h3>
          {view.category && (
            <p className="text-[0.7rem] text-ink-faint">{categoryLabel(view.category)}</p>
          )}
        </div>
      </div>

      <dl className="mt-3 space-y-1 border-t border-border-default pt-2 text-[0.7rem]">
        <div className="flex justify-between gap-2">
          <dt className="whitespace-nowrap text-ink-faint">Récompense</dt>
          <dd className="font-mono-toile text-gold">
            {formatRyoRange(view.rewardRyoMin, view.rewardRyoMax)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="whitespace-nowrap text-ink-faint">Délai</dt>
          <dd className={urgent ? "text-blood-bright" : "text-ink-muted"}>
            {view.timeRemaining.realLabel}
          </dd>
        </div>
        {view.timeRemaining.rpLabel && (
          <div className="flex justify-end">
            <dd className="text-[0.65rem] text-ink-faint italic">{view.timeRemaining.rpLabel}</dd>
          </div>
        )}
        {card.targetLevelLabel && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-faint">Niveau cible</dt>
            <dd className="text-ink-muted">{card.targetLevelLabel}</dd>
          </div>
        )}
        {view.claimCount > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-faint">Candidatures</dt>
            <dd className="text-warning">{view.claimCount}</dd>
          </div>
        )}
        {card.team && (
          <>
            <div className="flex justify-between gap-2">
              <dt className="whitespace-nowrap text-ink-faint">
                {card.team.groupsCount > 1 ? "Groupes visibles" : "Attribuée à"}
              </dt>
              <dd className="min-w-0 truncate text-copper">{card.team.label}</dd>
            </div>
            {card.team.rosters.map((roster) => (
              <div key={roster.groupName} className="flex justify-between gap-2">
                <dt className="min-w-0 truncate text-ink-faint">Agents · {roster.groupName}</dt>
                <dd className="max-w-[60%] truncate text-right text-ink-muted">
                  {roster.agentNames.length > 0 ? roster.agentNames.join(", ") : "—"}
                </dd>
              </div>
            ))}
          </>
        )}
      </dl>
    </Link>
  );
}

function SpiderGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <circle cx="5" cy="5" r="1.6" fill="var(--toile-blood-bright)" />
      <g stroke="var(--toile-blood-bright)" strokeWidth="0.7" strokeLinecap="round">
        <path d="M4 4 L1.5 1.8 M6 4 L8.5 1.8 M3.6 5 L0.8 4.6 M6.4 5 L9.2 4.6 M4 6 L1.8 8 M6 6 L8.2 8" />
      </g>
    </svg>
  );
}
