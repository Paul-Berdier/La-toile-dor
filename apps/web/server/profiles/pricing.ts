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

export interface ProfileEstimate extends PricingResult {
  /** Renseignements acquis retenus dans le calcul */
  knownCount: number;
  relationCount: number;
  gradeLabel: string | null;
}

/**
 * Estime ce que vaut un dossier.
 *
 * C'est un CONSEIL, jamais un prélèvement : aucun compte n'est débité, le
 * règlement se fait en jeu. Le prix reste fixé par la modération, qui dispose
 * ici d'une base chiffrée et explicable plutôt que d'une intuition.
 */
export async function estimateProfilePrice(profileId: string): Promise<ProfileEstimate | null> {
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

  return {
    ...result,
    knownCount: knownFields.length,
    relationCount: relationGradeRanks.length,
    gradeLabel: profile.rank?.label ?? null,
  };
}
