/** Calculs de points — valeurs par défaut configurables via RankConfig/AppSetting. */

import { RANK_DEFAULTS, type Rank } from "./ranks";

export interface ScoreModifiers {
  /** Résolution avant un seuil de rapidité (bonus %) */
  speedBonus?: boolean;
  /** Aucune détection signalée en RP */
  stealthBonus?: boolean;
  /** Objectifs secondaires accomplis (points additionnels bruts) */
  secondaryObjectivePoints?: number;
  /** Qualité du rapport final (0 à 20 % de bonus) */
  reportQualityPct?: number;
}

export interface ScoreBreakdownLine {
  reason: string;
  points: number;
}

/** Barème par défaut ; chaque ligne du détail devient une entrée du registre. */
export function computeMissionScore(
  rank: Rank,
  outcome: "COMPLETED" | "FAILED",
  modifiers: ScoreModifiers = {},
  basePointsOverride?: number,
): { total: number; breakdown: ScoreBreakdownLine[] } {
  const base = basePointsOverride ?? RANK_DEFAULTS[rank].defaultPoints;
  const breakdown: ScoreBreakdownLine[] = [];

  if (outcome === "COMPLETED") {
    breakdown.push({ reason: "MISSION_COMPLETED", points: base });
    if (modifiers.speedBonus) {
      breakdown.push({ reason: "SPEED_BONUS", points: Math.round(base * 0.2) });
    }
    if (modifiers.stealthBonus) {
      breakdown.push({ reason: "STEALTH_BONUS", points: Math.round(base * 0.15) });
    }
    if (modifiers.secondaryObjectivePoints) {
      breakdown.push({
        reason: "SECONDARY_OBJECTIVES",
        points: modifiers.secondaryObjectivePoints,
      });
    }
    if (modifiers.reportQualityPct) {
      const pct = Math.max(0, Math.min(20, modifiers.reportQualityPct));
      breakdown.push({ reason: "REPORT_QUALITY", points: Math.round((base * pct) / 100) });
    }
  } else {
    // Échec : pénalité de la moitié des points de base
    breakdown.push({ reason: "MISSION_FAILED", points: -Math.round(base / 2) });
  }

  return {
    total: breakdown.reduce((sum, line) => sum + line.points, 0),
    breakdown,
  };
}

export function formatRyo(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} ryōs`;
}

export function formatRyoRange(min: number, max: number): string {
  const fmt = new Intl.NumberFormat("fr-FR");
  if (min === max) return `${fmt.format(min)} ryōs`;
  return `${fmt.format(min)} – ${fmt.format(max)} ryōs`;
}
