/**
 * Service central de temps RP.
 *
 * Règles du serveur : 1 jour réel = 1 mois RP ET 1 semaine réelle = 1 année RP.
 * Ces deux règles imposent une année RP de 7 mois (7 jours = 7 mois = 1 an) —
 * c'est voulu par le serveur, ne pas « corriger » vers 12.
 * Tout est configurable via AppSetting("rp_time") — ne dupliquez jamais
 * cette règle dans un composant : passez par ce module.
 *
 * Les dates d'expiration sont TOUJOURS stockées en temps réel UTC ;
 * le temps RP n'est qu'une projection d'affichage.
 */

export interface RpTimeConfig {
  /** Millisecondes réelles représentant un mois RP (défaut : 1 jour réel). */
  realMsPerRpMonth: number;
  /** Mois RP dans une année RP (défaut : 7 — ainsi 1 semaine réelle = 1 an RP). */
  rpMonthsPerYear: number;
  /** Époque RP : date réelle correspondant à rpEpochLabel. */
  realEpochIso: string;
  /** Année RP à l'époque (pour l'affichage de dates RP absolues). */
  rpEpochYear: number;
}

export const DEFAULT_RP_TIME_CONFIG: RpTimeConfig = {
  realMsPerRpMonth: 24 * 60 * 60 * 1000, // 1 jour réel = 1 mois RP
  rpMonthsPerYear: 7, // 1 semaine réelle (7 jours) = 1 année RP
  realEpochIso: "2026-01-01T00:00:00.000Z",
  rpEpochYear: 1,
};

export interface RpDuration {
  years: number;
  months: number;
  weeks: number; // semaines RP restantes après extraction des mois
}

/** Convertit une durée réelle (ms) en durée RP structurée. */
export function realToRpDuration(
  realMs: number,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): RpDuration {
  const monthsPerYear = config.rpMonthsPerYear ?? 7;
  const totalMonths = realMs / config.realMsPerRpMonth;
  const years = Math.floor(totalMonths / monthsPerYear);
  const months = Math.floor(totalMonths % monthsPerYear);
  // ~4,345 semaines par mois ; on garde une granularité simple : 4 semaines/mois
  const weeks = Math.floor((totalMonths - Math.floor(totalMonths)) * 4);
  return { years, months, weeks };
}

/** Convertit une durée RP en millisecondes réelles. */
export function rpToRealMs(
  rp: Partial<RpDuration>,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): number {
  const months =
    (rp.years ?? 0) * (config.rpMonthsPerYear ?? 7) + (rp.months ?? 0) + (rp.weeks ?? 0) / 4;
  return Math.round(months * config.realMsPerRpMonth);
}

/** Convertit une date réelle en année/mois RP absolus. */
export function realDateToRp(
  date: Date,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): { year: number; month: number } {
  const monthsPerYear = config.rpMonthsPerYear ?? 7;
  const elapsed = date.getTime() - new Date(config.realEpochIso).getTime();
  const totalMonths = Math.floor(elapsed / config.realMsPerRpMonth);
  return {
    year: config.rpEpochYear + Math.floor(totalMonths / monthsPerYear),
    month: ((totalMonths % monthsPerYear) + monthsPerYear) % monthsPerYear + 1,
  };
}

// ── Affichage ────────────────────────────────────────────────

function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n > 1 ? (pluralForm ?? singular + "s") : singular}`;
}

/** "2 jours et 7 heures" — durée réelle lisible. */
export function formatRealDuration(realMs: number): string {
  if (realMs <= 0) return "expirée";
  const totalMinutes = Math.floor(realMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, "jour"));
  if (hours > 0) parts.push(plural(hours, "heure"));
  if (days === 0 && minutes > 0) parts.push(plural(minutes, "minute"));
  if (parts.length === 0) return "moins d'une minute";
  return parts.slice(0, 2).join(" et ");
}

/** "≈ 2 mois et 1 semaine en temps RP" */
export function formatRpDuration(
  realMs: number,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): string {
  if (realMs <= 0) return "";
  const rp = realToRpDuration(realMs, config);
  const parts: string[] = [];
  if (rp.years > 0) parts.push(plural(rp.years, "an"));
  if (rp.months > 0) parts.push(plural(rp.months, "mois", "mois"));
  if (rp.years === 0 && rp.weeks > 0) parts.push(plural(rp.weeks, "semaine"));
  if (parts.length === 0) return "≈ moins d'une semaine en temps RP";
  return `≈ ${parts.slice(0, 2).join(" et ")} en temps RP`;
}

export interface TimeRemaining {
  /** null = mission sans limite de temps */
  realMs: number | null;
  expired: boolean;
  suspended: boolean;
  realLabel: string; // "Expire dans 2 jours et 7 heures"
  rpLabel: string; // "≈ 2 mois et 1 semaine en temps RP"
}

/**
 * Calcule le temps restant d'une mission à partir de son état stocké.
 * `timerRemainingMs` non nul signifie que le délai est suspendu.
 */
export function computeTimeRemaining(
  mission: {
    expiresAt: Date | null;
    timerSuspendedAt?: Date | null;
    timerRemainingMs?: bigint | number | null;
  },
  now: Date,
  config: RpTimeConfig = DEFAULT_RP_TIME_CONFIG,
): TimeRemaining {
  if (mission.timerSuspendedAt && mission.timerRemainingMs != null) {
    const ms = Number(mission.timerRemainingMs);
    return {
      realMs: ms,
      expired: false,
      suspended: true,
      realLabel: `Délai suspendu — ${formatRealDuration(ms)} en réserve`,
      rpLabel: formatRpDuration(ms, config),
    };
  }
  if (!mission.expiresAt) {
    return {
      realMs: null,
      expired: false,
      suspended: false,
      realLabel: "Sans limite de temps",
      rpLabel: "",
    };
  }
  const ms = mission.expiresAt.getTime() - now.getTime();
  if (ms <= 0) {
    return { realMs: 0, expired: true, suspended: false, realLabel: "Expirée", rpLabel: "" };
  }
  return {
    realMs: ms,
    expired: false,
    suspended: false,
    realLabel: `Expire dans ${formatRealDuration(ms)}`,
    rpLabel: formatRpDuration(ms, config),
  };
}
