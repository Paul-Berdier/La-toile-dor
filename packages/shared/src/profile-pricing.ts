/**
 * Ce que vaut un dossier de renseignement.
 *
 * La Toile vend des dossiers : encore faut-il savoir à quel prix. Le barème
 * n'est pas figé dans le code — la modération le règle — mais il repose sur
 * une idée : **on paie ce qui donne prise sur quelqu'un**.
 *
 * Ce n'est pas seulement de quoi le vaincre. Trois choses donnent prise :
 *
 *  1. **ses aptitudes** — une faiblesse décide d'un combat, elle coûte donc
 *     plus cher qu'une force ;
 *  2. **son histoire** — un passé, une dette, une faute donnent barre sur un
 *     homme sans qu'aucun coup ne soit porté ;
 *  3. **ses proches** — et c'est souvent le plus précieux. La petite sœur d'un
 *     grand ninja n'a peut-être aucun talent : son dossier vaut cher
 *     précisément parce qu'elle est sa sœur.
 *
 * D'où deux multiplicateurs, et non un seul. Le grade de la CIBLE rehausse
 * tout le dossier — celui d'un Kage n'a pas le prix de celui d'un apprenti. Le
 * grade des PERSONNES LIÉES rehausse la valeur de chaque lien : un lien vers
 * un haut gradé est un levier, pas une ligne d'état civil.
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
  /** Ce que vaut un lien vers quelqu'un sans grade établi */
  relationValue: number;
  /** Au-delà, les liens n'ajoutent plus rien — les plus précieux d'abord */
  relationCap: number;
  /**
   * Part du multiplicateur de grade répercutée sur un lien.
   *
   * À 0, tous les liens se valent — la sœur d'un Kage compterait comme une
   * connaissance anonyme. À 1, un lien vaut autant que le rang qu'il désigne.
   */
  relationLeverage: number;
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
    signatureTechniques: 1400, // Subjutsu répertoriés (Rasengan, Hiraishin…)
    techniques: 1400, // techniques propres au personnage
    combatStyles: 1200,
    chakraNatures: 1000,
    kenjutsuStyles: 800,
    // ── Ce qui donne barre sans porter un coup ──
    // L'histoire d'un homme — un passé, une dette, une faute — vaut autant
    // que ses techniques : on peut la retourner contre lui sans combattre.
    details: 1600,
    // Savoir qu'on affronte un Ravageur ou un Soigneur change le plan
    // d'attaque : c'est du combat, pas de l'état civil.
    ninjaClass: 1000,
    clans: 900,
    faction: 800,
    rank: 700,
    lastName: 500,
    lifeStatus: 400,
    age: 300,
    image: 900, // un visage vaut cher quand il faut reconnaître quelqu'un
    // ── Ce qui ne fait que compléter ──
    height: 200,
    eyeColor: 150,
    hairColor: 150,
    skinTone: 150,
    sex: 100,
  },
  relationValue: 500,
  relationCap: 8,
  // 0,75 : la sœur d'un Kage vaut nettement plus qu'une connaissance anonyme,
  // sans que le lien pèse autant que le dossier du Kage lui-même.
  relationLeverage: 0.75,
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
      "signatureTechniques",
      "techniques",
      "combatStyles",
      "chakraNatures",
      "kenjutsuStyles",
      "artifacts",
      "ninjaClass",
    ],
  },
  { label: "Affiliation et identité", fields: ["clans", "faction", "rank", "lastName", "details"] },
  {
    label: "État et apparence",
    fields: ["lifeStatus", "age", "image", "height", "eyeColor", "hairColor", "skinTone", "sex"],
  },
];

export interface PricingInput {
  /** Champs dont le renseignement est ACQUIS (état KNOWN) */
  knownFields: ProfileFieldKey[];
  /**
   * Rang du grade de CHAQUE personne liée (parent, enfant, fratrie…), `null`
   * quand il est inconnu. Un lien vers un haut gradé est un levier : c'est ce
   * qui fait la valeur du dossier d'une petite sœur sans talent.
   */
  relationGradeRanks: (number | null)[];
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

  // Chaque lien vaut selon le rang qu'il désigne : un lien vers un Kage donne
  // prise sur un Kage. Les plus précieux sont retenus en premier, sans quoi le
  // plafond écarterait au hasard le seul lien qui comptait.
  const relationAmounts = input.relationGradeRanks
    .map(
      (rank) =>
        pricing.relationValue *
        (1 + (gradeMultiplier(rank, pricing) - 1) * pricing.relationLeverage),
    )
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, pricing.relationCap));

  if (relationAmounts.length > 0) {
    const amount = Math.round(relationAmounts.reduce((sum, value) => sum + value, 0));
    lines.push({ label: `Parenté et liens (${relationAmounts.length})`, amount });
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
