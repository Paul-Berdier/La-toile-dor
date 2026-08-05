/**
 * Ce que vaut un dossier de renseignement.
 *
 * La Toile vend des dossiers : encore faut-il savoir à quel prix. Le barème
 * n'est pas figé dans le code — la modération le règle — mais il repose sur
 * une idée simple : **on paie ce qui sert à agir**.
 *
 * D'où l'ordre des valeurs par défaut : une faiblesse vaut plus cher qu'une
 * force (c'est ce qui permet de l'emporter), les aptitudes de combat plus que
 * l'état civil, et la couleur des cheveux presque rien. Le grade de la cible
 * multiplie l'ensemble : le dossier d'un Kage n'a pas le prix de celui d'un
 * apprenti.
 *
 * Le calcul est PUR : aucune requête, aucune date. Il se teste et se rejoue.
 */

import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from "./profile-fields";

export interface ProfilePricing {
  /** Prix plancher : ouvrir un dossier a déjà coûté quelque chose */
  basePrice: number;
  /**
   * Progression du multiplicateur par échelon de grade :
   * `1 + (rang - 1) × gradeStep`, plafonnée à `gradeMax`.
   */
  gradeStep: number;
  gradeMax: number;
  /** Ce que vaut chaque champ RENSEIGNÉ, en ryōs */
  fieldValues: Partial<Record<ProfileFieldKey, number>>;
  /** Ce que vaut une parenté connue */
  relationValue: number;
  /** Au-delà, les relations n'ajoutent plus rien */
  relationCap: number;
  /** Combien de ryōs valent un point de mérite */
  ryosPerPoint: number;
  /** Coup de pouce global — inflation ou austérité décidée par la Toile */
  globalMultiplier: number;
  /** Arrondi commercial : un prix se lit, il ne se calcule pas au ryō près */
  roundTo: number;
}

/**
 * Barème par défaut. Les aptitudes de combat dominent : ce sont elles qu'on
 * achète avant un contrat. L'état civil suit, l'apparence ferme la marche.
 */
export const DEFAULT_PROFILE_PRICING: ProfilePricing = {
  basePrice: 2000,
  gradeStep: 0.6,
  gradeMax: 6,
  fieldValues: {
    // ── Ce qui sert à l'emporter ──
    weaknesses: 2500, // la plus chère : une faiblesse décide d'un combat
    kekkeiGenkai: 2000,
    clanTechniques: 1600,
    strengths: 1500,
    artifacts: 1500,
    techniques: 1400, // Subjutsu
    combatStyles: 1200,
    chakraNatures: 1000,
    kenjutsuStyles: 800,
    // ── Ce qui sert à trouver et à comprendre ──
    clans: 900,
    faction: 800,
    rank: 700,
    details: 600,
    lastName: 500,
    lifeStatus: 400,
    age: 300,
    image: 900, // un visage vaut cher quand il faut reconnaître quelqu'un
    // ── Ce qui ne fait que compléter ──
    height: 200,
    hairColor: 150,
    skinTone: 150,
    sex: 100,
  },
  relationValue: 400,
  relationCap: 8,
  ryosPerPoint: 500,
  globalMultiplier: 1,
  roundTo: 100,
};

/** Libellés des champs regroupés, pour expliquer un prix sans jargon. */
export const PRICING_GROUPS: { label: string; fields: ProfileFieldKey[] }[] = [
  {
    label: "Aptitudes de combat",
    fields: [
      "weaknesses",
      "strengths",
      "kekkeiGenkai",
      "clanTechniques",
      "techniques",
      "combatStyles",
      "chakraNatures",
      "kenjutsuStyles",
      "artifacts",
    ],
  },
  { label: "Affiliation et identité", fields: ["clans", "faction", "rank", "lastName", "details"] },
  { label: "État et apparence", fields: ["lifeStatus", "age", "image", "height", "hairColor", "skinTone", "sex"] },
];

export interface PricingInput {
  /** Champs dont le renseignement est ACQUIS (état KNOWN) */
  knownFields: ProfileFieldKey[];
  /** Nombre de parentés connues */
  relationCount: number;
  /**
   * Rang du grade de la cible (1 = le plus bas). `null` si le grade est
   * inconnu : on n'applique alors aucun multiplicateur — on ne facture pas
   * une importance qu'on n'a pas établie.
   */
  gradeRank: number | null;
}

export interface PricingLine {
  label: string;
  amount: number;
}

export interface PricingResult {
  /** Prix conseillé, arrondi */
  price: number;
  /** Valeur en points de mérite pour qui a constitué le dossier */
  points: number;
  /** Multiplicateur appliqué au titre du grade */
  gradeMultiplier: number;
  /** Détail lisible : un prix qu'on ne peut pas expliquer ne se négocie pas */
  lines: PricingLine[];
}

const round = (value: number, step: number) =>
  step > 1 ? Math.round(value / step) * step : Math.round(value);

/** Multiplicateur lié au grade, plafonné. */
export function gradeMultiplier(gradeRank: number | null, pricing: ProfilePricing): number {
  if (!gradeRank || gradeRank < 1) return 1;
  return Math.min(pricing.gradeMax, 1 + (gradeRank - 1) * pricing.gradeStep);
}

/**
 * Calcule le prix conseillé d'un dossier et sa valeur en points.
 *
 * Le résultat est un **conseil**, jamais un prélèvement : la modération reste
 * libre de fixer le montant, et aucun compte n'est débité — le règlement se
 * fait en jeu.
 */
export function priceProfile(input: PricingInput, pricing: ProfilePricing): PricingResult {
  const lines: PricingLine[] = [{ label: "Ouverture du dossier", amount: pricing.basePrice }];
  let subtotal = pricing.basePrice;

  for (const group of PRICING_GROUPS) {
    const amount = group.fields
      .filter((field) => input.knownFields.includes(field))
      .reduce((sum, field) => sum + (pricing.fieldValues[field] ?? 0), 0);
    if (amount > 0) {
      lines.push({ label: group.label, amount });
      subtotal += amount;
    }
  }

  // Champs valorisés hors des groupes connus : rien ne doit se perdre parce
  // qu'un champ a été ajouté au produit sans être rangé dans un groupe.
  const grouped = new Set(PRICING_GROUPS.flatMap((group) => group.fields));
  const otherAmount = PROFILE_FIELD_KEYS.filter(
    (field) => !grouped.has(field) && input.knownFields.includes(field),
  ).reduce((sum, field) => sum + (pricing.fieldValues[field] ?? 0), 0);
  if (otherAmount > 0) {
    lines.push({ label: "Autres renseignements", amount: otherAmount });
    subtotal += otherAmount;
  }

  const relations = Math.min(Math.max(0, input.relationCount), pricing.relationCap);
  if (relations > 0) {
    const amount = relations * pricing.relationValue;
    lines.push({ label: `Parenté et liens (${relations})`, amount });
    subtotal += amount;
  }

  const multiplier = gradeMultiplier(input.gradeRank, pricing);
  const price = round(subtotal * multiplier * pricing.globalMultiplier, pricing.roundTo);

  return {
    price,
    points: pricing.ryosPerPoint > 0 ? Math.round(price / pricing.ryosPerPoint) : 0,
    gradeMultiplier: multiplier,
    lines,
  };
}
