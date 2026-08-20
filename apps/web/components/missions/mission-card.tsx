import Link from "next/link";
import { categoryLabel, formatRyoRange } from "@toile/shared";
import type { BoardCard } from "@/server/missions";
import { RankSeal } from "./rank-seal";

/**
 * Carte de mission — n'affiche QUE des champs déjà filtrés côté serveur.
 *
 * Une carte doit se lire d'un coup d'œil dans une colonne : le titre en
 * entier (il porte désormais le type, le rang et le niveau des cibles), la
 * récompense, le temps qui reste. Le reste — équipe, agents, candidatures —
 * tient en pastilles sous le titre plutôt qu'en lignes « libellé : valeur »
 * qui doublaient la hauteur de chaque carte.
 */
export function MissionCard({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  const { view } = card;
  const remaining = view.timeRemaining.realMs;
  const urgent = remaining !== null && !view.timeRemaining.expired && remaining < 48 * 3600 * 1000;
  const critical = remaining !== null && !view.timeRemaining.expired && remaining < 12 * 3600 * 1000;

  return (
    <Link
      href={`/missions/${view.id}`}
      className={`group block border bg-elevated p-3 shadow-card transition-all duration-200 ${
        dragging
          ? "rotate-1 border-gold shadow-gold"
          : critical
            ? "border-blood/60 hover:border-blood hover:shadow-gold"
            : "border-border-default hover:border-border-gold hover:shadow-gold"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <RankSeal rank={view.rank} size={34} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-mono-toile text-[0.65rem] tracking-wider text-ink-faint">
            {view.code}
            {view.hasConfidential && (
              <span title="Volet confidentiel" aria-label="Volet confidentiel">
                <SpiderGlyph />
              </span>
            )}
          </p>
          {/* Le titre se lit EN ENTIER : il porte le type, le rang, le niveau
              des cibles et leur origine — le tronquer le rendrait muet. */}
          <h3 className="text-sm font-medium leading-snug text-ink group-hover:text-gold-bright">
            {view.publicTitle}
          </h3>
        </div>
      </div>

      {/* Pastilles : ce qui distingue cette mission des autres, sans lignes */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.65rem]">
        <span className="font-mono-toile text-gold">
          {formatRyoRange(view.rewardRyoMin, view.rewardRyoMax)}
        </span>
        <span
          className={`border px-1.5 py-0.5 ${
            view.timeRemaining.expired
              ? "border-border-default text-ink-faint"
              : critical
                ? "border-blood text-blood-bright"
                : urgent
                  ? "border-warning/60 text-warning"
                  : "border-border-default text-ink-muted"
          }`}
          title={view.timeRemaining.rpLabel ?? undefined}
        >
          {urgent && !view.timeRemaining.expired && <span aria-hidden>⏳ </span>}
          {view.timeRemaining.realLabel}
        </span>
        {view.targetCount > 0 && (
          <span className="border border-border-default px-1.5 py-0.5 text-ink-muted">
            {view.targetCount} cible{view.targetCount > 1 ? "s" : ""}
          </span>
        )}
        {card.targetLevelLabel && (
          <span className="border border-border-default px-1.5 py-0.5 text-ink-muted">
            {card.targetLevelLabel}
          </span>
        )}
        {view.claimCount > 0 && (
          <span className="border border-warning/60 px-1.5 py-0.5 text-warning">
            {view.claimCount} candidature{view.claimCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Équipe : une ligne, pas un tableau */}
      {card.team && (
        <p className="mt-2 truncate border-t border-border-default pt-2 text-[0.65rem] text-copper">
          {card.team.label}
          {card.team.totalHeadcount > 0 && (
            <span className="ml-1 text-ink-faint">· {card.team.totalHeadcount} agent{card.team.totalHeadcount > 1 ? "s" : ""}</span>
          )}
        </p>
      )}
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

/**
 * Ligne de mission — vue LISTE.
 *
 * Le Kanban montre l'état ; la liste montre le contenu. Sur un écran étroit,
 * ou quand on cherche une mission parmi quarante, cinq colonnes qui défilent
 * de côté sont une punition : une liste dense se parcourt d'un pouce.
 */
export function MissionRow({ card, showColumn }: { card: BoardCard; showColumn?: string }) {
  const { view } = card;
  const remaining = view.timeRemaining.realMs;
  const urgent = remaining !== null && !view.timeRemaining.expired && remaining < 48 * 3600 * 1000;

  return (
    <li>
      <Link
        href={`/missions/${view.id}`}
        className="flex items-start gap-3 border border-border-default bg-elevated px-3 py-2.5 transition-colors hover:border-border-gold hover:bg-hover-bg"
      >
        <span className="shrink-0 pt-0.5">
          <RankSeal rank={view.rank} size={26} />
        </span>

        {/* Le titre d'abord et en entier. Sur écran étroit, les métadonnées
            passent DESSOUS plutôt que de le comprimer en « Le r... ». */}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono-toile text-[0.65rem] text-ink-faint">{view.code}</span>
            {showColumn && (
              <span className="border border-border-default px-1.5 text-[0.6rem] uppercase tracking-wider text-ink-faint">
                {showColumn}
              </span>
            )}
            {view.hasConfidential && <SpiderGlyph />}
          </span>
          <span className="block text-sm leading-snug text-ink">{view.publicTitle}</span>
          {card.team && (
            <span className="block truncate text-[0.65rem] text-copper">{card.team.label}</span>
          )}

          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem]">
            <span className="font-mono-toile text-gold">
              {formatRyoRange(view.rewardRyoMin, view.rewardRyoMax)}
            </span>
            <span className={urgent ? "text-warning" : "text-ink-muted"}>
              {urgent && <span aria-hidden>⏳ </span>}
              {view.timeRemaining.realLabel}
            </span>
            {view.targetCount > 0 && (
              <span className="text-ink-muted">
                {view.targetCount} cible{view.targetCount > 1 ? "s" : ""}
              </span>
            )}
            {card.targetLevelLabel && <span className="text-ink-muted">{card.targetLevelLabel}</span>}
            {view.claimCount > 0 && (
              <span className="border border-warning/60 px-1.5 text-warning">
                {view.claimCount} candidature{view.claimCount > 1 ? "s" : ""}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
