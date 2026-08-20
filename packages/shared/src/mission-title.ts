/**
 * Titre public d'une mission — généré, jamais saisi.
 *
 * Le tableau des contrats est vu par TOUS les chefs de groupe, y compris ceux
 * qui ne prendront pas la mission. Un titre écrit à la main y disait tantôt
 * trop (« Éliminer Akira Hoki du clan Kaguya »), tantôt rien (« Contrat 12 »).
 * On le compose donc à partir de quatre segments — et de quatre seulement :
 *
 *     Assassinat · B+ · Konin · Konoha
 *     └ type      └ rang └ grade  └ origine
 *
 * RÈGLE DE CONFIDENTIALITÉ : aucun autre champ du dossier n'entre ici. Ni
 * prénom, ni nom, ni clan, ni Kekkei Genkai, ni image, ni relation. Le grade
 * et l'origine viennent des SNAPSHOTS pris à la publication : une mission
 * close ne se réécrit pas quand le ninja monte en grade six mois plus tard.
 *
 * Le calcul est PUR : aucune requête, aucune date. Il se teste et se rejoue.
 */

import { categoryLabel } from "./ranks";

export const MISSION_RANK_MODIFIERS = ["NONE", "PLUS", "MINUS"] as const;
export type MissionRankModifier = (typeof MISSION_RANK_MODIFIERS)[number];

export const MISSION_ORIGIN_VISIBILITIES = ["SHOW", "HIDE"] as const;
export type MissionOriginVisibility = (typeof MISSION_ORIGIN_VISIBILITIES)[number];

/** « B », « B+ », « B- » — la nuance est un suffixe, pas un rang de plus. */
export function formatMissionRank(rank: string, modifier: MissionRankModifier = "NONE"): string {
  if (modifier === "PLUS") return `${rank}+`;
  if (modifier === "MINUS") return `${rank}-`;
  return rank;
}

/**
 * Ce que le générateur sait d'une cible : son grade et son origine, tels
 * qu'ils étaient au moment retenu (snapshot en mission publiée, valeur vive
 * en brouillon). `order` sert à trouver le grade le plus élevé.
 */
export interface TitleTargetInput {
  gradeLabel: string | null;
  gradeOrder: number | null;
  originLabel: string | null;
}

export interface MissionTitleSegments {
  type: string;
  rank: string;
  /** « Konin », « 3 cibles · max Jonin », ou null si aucune cible */
  targetLevel: string | null;
  /** « Konoha », « multi-origine », « origine inconnue », ou null si masquée */
  origin: string | null;
}

export interface MissionTitleResult {
  title: string;
  segments: MissionTitleSegments;
}

export interface MissionTitleInput {
  category: string;
  rank: string;
  rankModifier?: MissionRankModifier;
  targets: readonly TitleTargetInput[];
  originVisibility?: MissionOriginVisibility;
}

/**
 * Segment « niveau des cibles ».
 *
 * - aucune cible          → null (le titre se réduit au type et au rang)
 * - une cible             → son grade, ou rien si on l'ignore
 * - plusieurs, même grade → « 3 cibles · Chunin »
 * - plusieurs, grades ≠   → « 3 cibles · max Jonin »
 */
function targetLevelSegment(targets: readonly TitleTargetInput[]): string | null {
  if (targets.length === 0) return null;

  const known = targets.filter((t) => t.gradeLabel);
  // Une cible dont on ignore le grade n'apprend rien à personne : mieux vaut
  // un titre court (« Sabotage · B ») qu'un « grade inconnu » qui encombre
  // toutes les cartes du tableau.
  if (targets.length === 1) {
    return known.length === 1 ? known[0]!.gradeLabel! : null;
  }

  const plural = `${targets.length} cibles`;
  if (known.length === 0) return plural;

  const labels = new Set(known.map((t) => t.gradeLabel!));
  // Tous connus et identiques : le grade se dit sans « max »
  if (labels.size === 1 && known.length === targets.length) {
    return `${plural} · ${known[0]!.gradeLabel!}`;
  }
  // Sinon le plus élevé — c'est lui qui décide de la difficulté réelle
  const highest = known.reduce((best, t) =>
    (t.gradeOrder ?? -1) > (best.gradeOrder ?? -1) ? t : best,
  );
  return `${plural} · max ${highest.gradeLabel!}`;
}

/**
 * Segment « origine ».
 *
 * - masquée par le modérateur → null (rien dans le titre)
 * - toutes du même village    → ce village
 * - villages différents       → « multi-origine »
 * - aucune connue             → « origine inconnue »
 */
function originSegment(
  targets: readonly TitleTargetInput[],
  visibility: MissionOriginVisibility,
): string | null {
  if (visibility === "HIDE" || targets.length === 0) return null;
  const origins = new Set(
    targets.map((t) => t.originLabel).filter((o): o is string => Boolean(o)),
  );
  if (origins.size === 0) return "origine inconnue";
  if (origins.size === 1) return [...origins][0]!;
  return "multi-origine";
}

/**
 * Compose le titre public. Retourne aussi les segments : l'éditeur les
 * affiche séparément pour montrer d'où vient chaque morceau.
 */
export function generateMissionPublicTitle(input: MissionTitleInput): MissionTitleResult {
  const segments: MissionTitleSegments = {
    type: categoryLabel(input.category),
    rank: formatMissionRank(input.rank, input.rankModifier ?? "NONE"),
    targetLevel: targetLevelSegment(input.targets),
    origin: originSegment(input.targets, input.originVisibility ?? "SHOW"),
  };
  const title = [segments.type, segments.rank, segments.targetLevel, segments.origin]
    .filter((segment): segment is string => Boolean(segment))
    .join(" · ");
  return { title, segments };
}
