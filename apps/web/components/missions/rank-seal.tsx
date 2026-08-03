import { RANK_DEFAULTS, type Rank } from "@toile/shared";

/**
 * Sceau de rang : octogone gravé, symbole calligraphique, couleur de rang.
 * SS reçoit un double liseré et un point de sceau rouge.
 */
export function RankSeal({ rank, size = 40 }: { rank: string; size?: number }) {
  const defaults = RANK_DEFAULTS[rank as Rank];
  const color = `var(--toile-${defaults?.colorToken ?? "smoke"})`;
  const isS = rank === "S" || rank === "SS";

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      title={`Rang ${rank}`}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <polygon
          points="12,2 28,2 38,12 38,28 28,38 12,38 2,28 2,12"
          fill="var(--toile-bg-elevated)"
          stroke={color}
          strokeWidth={rank === "SS" ? 1.6 : 1.1}
        />
        {rank === "SS" && (
          <polygon
            points="14,5 26,5 35,14 35,26 26,35 14,35 5,26 5,14"
            fill="none"
            stroke="var(--toile-blood-bright)"
            strokeWidth="0.8"
          />
        )}
        {isS && rank === "S" && (
          <polygon
            points="14,5 26,5 35,14 35,26 26,35 14,35 5,26 5,14"
            fill="none"
            stroke="var(--toile-gold-dim)"
            strokeWidth="0.6"
          />
        )}
      </svg>
      <span
        className="absolute font-display font-semibold"
        style={{ color, fontSize: size * 0.42 }}
        aria-hidden
      >
        {rank}
      </span>
      <span className="sr-only">Rang {rank}</span>
    </span>
  );
}
