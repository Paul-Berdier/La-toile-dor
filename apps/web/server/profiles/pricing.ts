import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";
import {
  DEFAULT_PROFILE_PRICING,
  priceProfile,
  type ProfilePricing,
  type PricingResult,
  type ProfileFieldKey,
} from "@toile/shared";

/**
 * Barème en vigueur, réglé par la modération dans `AppSetting("profile_pricing")`.
 * Les valeurs absentes retombent sur le barème par défaut : un réglage partiel
 * reste donc cohérent, et l'ajout d'un champ au produit ne casse rien.
 */
export const getProfilePricing = cache(async (): Promise<ProfilePricing> => {
  const setting = await prisma.appSetting.findUnique({ where: { key: "profile_pricing" } });
  const stored = (setting?.value ?? {}) as Partial<ProfilePricing>;
  return {
    ...DEFAULT_PROFILE_PRICING,
    ...stored,
    // Fusion champ par champ : régler un seul poste ne doit pas effacer les autres
    fieldValues: { ...DEFAULT_PROFILE_PRICING.fieldValues, ...(stored.fieldValues ?? {}) },
  };
});

/**
 * Ce qu'un ACHETEUR potentiel peut voir de l'estimation : le montant, rien
 * d'autre. Ni le nombre de renseignements, ni le grade, ni les lignes du
 * calcul — chacun de ces éléments est un oracle sur le contenu d'un dossier
 * qu'il n'a justement pas acheté. Le montant seul est arrondi au palier du
 * barème, ce qui brouille l'inférence champ par champ.
 */
export interface PublicProfileEstimate {
  scope: "public";
  price: number;
}

/**
 * L'estimation complète, réservée à ceux qui voient déjà le dossier : ils
 * n'apprennent rien par le détail qu'ils ne sachent déjà par les valeurs.
 */
export interface FullProfileEstimate extends PricingResult {
  scope: "full";
  /** Renseignements acquis retenus dans le calcul */
  knownCount: number;
  relationCount: number;
  gradeLabel: string | null;
}

/**
 * Le type est DISCRIMINÉ pour que la fuite soit impossible à écrire : un
 * composant qui reçoit `PublicProfileEstimate` n'a pas de `gradeLabel` à
 * afficher, le compilateur s'y oppose. C'est la même technique que le
 * sérialiseur des champs, où la clé `value` n'existe qu'à l'état VISIBLE.
 */
export type ProfileEstimate = PublicProfileEstimate | FullProfileEstimate;

/**
 * Estime ce que vaut un dossier, à la mesure de ce que le lecteur a le droit
 * de savoir.
 *
 * C'est un CONSEIL, jamais un prélèvement : aucun compte n'est débité, le
 * règlement se fait en jeu. Le prix reste fixé par la modération, qui dispose
 * ici d'une base chiffrée et explicable plutôt que d'une intuition.
 *
 * `canViewValues` décide de la forme retournée. Le lecteur qui NE voit PAS le
 * dossier n'obtient que le montant : la version détaillée révélerait le grade
 * (« ??? » trois lignes plus haut) et, par arithmétique, quels champs sont
 * connus.
 */
export async function estimateProfilePrice(
  profileId: string,
  canViewValues: boolean,
): Promise<ProfileEstimate | null> {
  const [pricing, profile] = await Promise.all([
    getProfilePricing(),
    prisma.characterProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        rank: { select: { label: true, order: true } },
        // Seuls les renseignements ACQUIS se facturent : une absence confirmée
        // ou une contradiction sont utiles, mais ce n'est pas ce qu'on achète.
        fieldIntel: { where: { knowledgeState: "KNOWN" }, select: { fieldKey: true } },
        // Le GRADE des personnes liées, pas seulement leur nombre : c'est lui
        // qui fait qu'un lien est un levier. Les dossiers archivés ou fusionnés
        // sont écartés — on ne monnaye pas une prise sur un dossier retiré.
        relationsFrom: {
          where: { toProfile: { archivedAt: null, mergedIntoId: null } },
          select: { toProfile: { select: { rank: { select: { order: true } } } } },
        },
        relationsTo: {
          where: { fromProfile: { archivedAt: null, mergedIntoId: null } },
          select: { fromProfile: { select: { rank: { select: { order: true } } } } },
        },
      },
    }),
  ]);
  if (!profile) return null;

  const relationGradeRanks = [
    ...profile.relationsFrom.map((rel) => rel.toProfile.rank?.order ?? null),
    ...profile.relationsTo.map((rel) => rel.fromProfile.rank?.order ?? null),
  ];
  const knownFields = profile.fieldIntel.map((row) => row.fieldKey as ProfileFieldKey);

  const result = priceProfile(
    { knownFields, relationGradeRanks, gradeRank: profile.rank?.order ?? null },
    pricing,
  );

  // Lecteur sans accès : le montant, et rien qui permette de le décomposer.
  // Arrondi GROSSIER : au palier fin du barème (100), le montant exact est un
  // oracle — les valeurs de champs étant des multiples ronds, une division
  // suffirait à retrouver le multiplicateur de grade (pourtant « ??? ») et le
  // nombre de liens. Au millier, l'inférence champ par champ devient vaseuse,
  // et le chef garde un ordre de grandeur pour négocier.
  if (!canViewValues) {
    const coarse = Math.max(1000, pricing.roundTo * 10);
    return { scope: "public", price: Math.max(coarse, Math.round(result.price / coarse) * coarse) };
  }

  return {
    scope: "full",
    ...result,
    knownCount: knownFields.length,
    relationCount: relationGradeRanks.length,
    gradeLabel: profile.rank?.label ?? null,
  };
}
