/** Valeurs initiales des rangs — configurables ensuite dans l'administration (RankConfig). */

export type Rank = "D" | "C" | "B" | "A" | "S" | "SS";

export const RANK_ORDER: Rank[] = ["D", "C", "B", "A", "S", "SS"];

export interface RankDefaults {
  symbol: string;
  colorToken: string; // token du design system, jamais une couleur brute
  dangerLevel: number;
  rewardRyoMin: number;
  rewardRyoMax: number;
  defaultPoints: number;
  minLevelSlug: string | null;
  recommendedGroupSize: number;
}

export const RANK_DEFAULTS: Record<Rank, RankDefaults> = {
  D: {
    symbol: "丁",
    colorToken: "rank-d",
    dangerLevel: 1,
    rewardRyoMin: 5_000,
    rewardRyoMax: 50_000,
    defaultPoints: 10,
    minLevelSlug: "genin_apprenti",
    recommendedGroupSize: 2,
  },
  C: {
    symbol: "丙",
    colorToken: "rank-c",
    dangerLevel: 2,
    rewardRyoMin: 30_000,
    rewardRyoMax: 100_000,
    defaultPoints: 25,
    minLevelSlug: "genin_confirme",
    recommendedGroupSize: 3,
  },
  B: {
    symbol: "乙",
    colorToken: "rank-b",
    dangerLevel: 3,
    rewardRyoMin: 80_000,
    rewardRyoMax: 250_000,
    defaultPoints: 60,
    minLevelSlug: "chunin",
    recommendedGroupSize: 3,
  },
  A: {
    symbol: "甲",
    colorToken: "rank-a",
    dangerLevel: 4,
    rewardRyoMin: 150_000,
    rewardRyoMax: 1_000_000,
    defaultPoints: 140,
    minLevelSlug: "jonin",
    recommendedGroupSize: 4,
  },
  S: {
    symbol: "極",
    colorToken: "rank-s",
    dangerLevel: 5,
    rewardRyoMin: 1_000_000,
    rewardRyoMax: 5_000_000,
    defaultPoints: 300,
    minLevelSlug: "commandant_jonin",
    recommendedGroupSize: 4,
  },
  SS: {
    symbol: "禁",
    colorToken: "rank-ss",
    dangerLevel: 6,
    rewardRyoMin: 5_000_000,
    rewardRyoMax: 20_000_000,
    defaultPoints: 700,
    minLevelSlug: "kage",
    recommendedGroupSize: 5,
  },
};

/** Niveaux du serveur RP — libellés configurables dans l'administration (PlayerLevel). */
export const PLAYER_LEVELS: { slug: string; label: string; order: number }[] = [
  { slug: "genin_apprenti", label: "Genin apprenti", order: 1 },
  { slug: "genin_simple", label: "Genin simple", order: 2 },
  { slug: "genin_confirme", label: "Genin confirmé", order: 3 },
  { slug: "chunin", label: "Chunin", order: 4 },
  { slug: "konin", label: "Konin", order: 5 },
  { slug: "tokubetsu_jonin", label: "Tokubetsu Jonin", order: 6 },
  { slug: "jonin", label: "Jonin", order: 7 },
  { slug: "commandant_jonin", label: "Commandant Jonin", order: 8 },
  { slug: "kage", label: "Kage", order: 9 },
  { slug: "sanin", label: "Sanin", order: 10 },
];

export const MISSION_CATEGORIES = [
  { value: "COLLECTE_INFORMATIONS", label: "Collecte d'informations" },
  { value: "SURVEILLANCE_ESPIONNAGE", label: "Surveillance & espionnage" },
  { value: "ELIMINATION", label: "Élimination de cible" },
  { value: "ENLEVEMENT", label: "Enlèvement" },
  { value: "INTERROGATOIRE", label: "Interrogatoire" },
  { value: "PROTECTION", label: "Protection" },
  { value: "ESCORTE", label: "Escorte" },
  { value: "SABOTAGE", label: "Sabotage" },
  { value: "MERCENARIAT", label: "Mercenariat" },
  { value: "SPECIALE", label: "Mission spéciale" },
] as const;

export type MissionCategoryValue = (typeof MISSION_CATEGORIES)[number]["value"];

export function categoryLabel(value: string): string {
  return MISSION_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  AVAILABLE: "Disponible",
  CLAIM_PENDING: "Revendication en attente",
  ASSIGNED: "Attribuée",
  IN_PROGRESS: "En cours",
  COMPLETED: "Accomplie",
  FAILED: "Échouée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
  ARCHIVED: "Archivée",
};

/** Regroupement des statuts en colonnes Kanban. */
export const KANBAN_COLUMNS = [
  { key: "a_prendre", label: "À prendre", statuses: ["AVAILABLE", "CLAIM_PENDING"] },
  { key: "en_cours", label: "En cours", statuses: ["ASSIGNED", "IN_PROGRESS"] },
  { key: "accomplies", label: "Accomplies", statuses: ["COMPLETED"] },
  { key: "echouees", label: "Échouées", statuses: ["FAILED", "EXPIRED"] },
  { key: "annulees", label: "Annulées", statuses: ["CANCELLED"] },
] as const;

export type KanbanColumnKey = (typeof KANBAN_COLUMNS)[number]["key"];
