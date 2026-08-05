import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_PRICING,
  gradeMultiplier,
  priceProfile,
  type ProfilePricing,
} from "./profile-pricing";

const P = DEFAULT_PROFILE_PRICING;
const empty = { knownFields: [], relationCount: 0, gradeRank: null };

describe("priceProfile — un dossier vide ne vaut que son ouverture", () => {
  it("prix plancher quand rien n'est renseigné", () => {
    const result = priceProfile(empty, P);
    expect(result.price).toBe(P.basePrice);
    expect(result.lines).toHaveLength(1);
  });

  it("le grade inconnu n'applique aucun multiplicateur", () => {
    // On ne facture pas une importance qu'on n'a pas établie.
    expect(priceProfile(empty, P).gradeMultiplier).toBe(1);
  });
});

describe("priceProfile — on paie ce qui sert à agir", () => {
  it("une faiblesse vaut plus cher qu'une force", () => {
    const faiblesse = priceProfile({ ...empty, knownFields: ["weaknesses"] }, P).price;
    const force = priceProfile({ ...empty, knownFields: ["strengths"] }, P).price;
    expect(faiblesse).toBeGreaterThan(force);
  });

  it("une aptitude de combat vaut bien plus cher qu'un trait d'apparence", () => {
    // On compare l'APPORT de chaque champ, pas le prix total : le plancher
    // d'ouverture entre dans les deux et écraserait l'écart.
    const plancher = priceProfile(empty, P).price;
    const kg = priceProfile({ ...empty, knownFields: ["kekkeiGenkai"] }, P).price - plancher;
    const cheveux = priceProfile({ ...empty, knownFields: ["hairColor"] }, P).price - plancher;
    expect(kg).toBeGreaterThan(cheveux * 5);
  });

  it("chaque renseignement supplémentaire augmente le prix", () => {
    const un = priceProfile({ ...empty, knownFields: ["weaknesses"] }, P).price;
    const deux = priceProfile({ ...empty, knownFields: ["weaknesses", "kekkeiGenkai"] }, P).price;
    expect(deux).toBeGreaterThan(un);
  });
});

describe("priceProfile — le grade multiplie l'ensemble", () => {
  it("un grade élevé vaut plus cher à contenu égal", () => {
    const fields = { ...empty, knownFields: ["weaknesses" as const] };
    const bas = priceProfile({ ...fields, gradeRank: 1 }, P).price;
    const haut = priceProfile({ ...fields, gradeRank: 5 }, P).price;
    expect(haut).toBeGreaterThan(bas);
  });

  it("le multiplicateur est plafonné", () => {
    // Sans plafond, un grade lointain produirait des prix absurdes.
    expect(gradeMultiplier(999, P)).toBe(P.gradeMax);
  });

  it("le premier échelon ne multiplie rien", () => {
    expect(gradeMultiplier(1, P)).toBe(1);
  });
});

describe("priceProfile — parenté", () => {
  it("les liens ajoutent de la valeur", () => {
    const sans = priceProfile(empty, P).price;
    const avec = priceProfile({ ...empty, relationCount: 3 }, P).price;
    expect(avec).toBe(sans + 3 * P.relationValue);
  });

  it("au-delà du plafond, les liens n'ajoutent plus rien", () => {
    const plafond = priceProfile({ ...empty, relationCount: P.relationCap }, P).price;
    const au_dela = priceProfile({ ...empty, relationCount: P.relationCap + 50 }, P).price;
    expect(au_dela).toBe(plafond);
  });

  it("un nombre négatif ne retire jamais de valeur", () => {
    expect(priceProfile({ ...empty, relationCount: -5 }, P).price).toBe(P.basePrice);
  });
});

describe("priceProfile — barème réglable", () => {
  it("le multiplicateur global rehausse tous les prix", () => {
    const double: ProfilePricing = { ...P, globalMultiplier: 2 };
    expect(priceProfile(empty, double).price).toBe(P.basePrice * 2);
  });

  it("mettre une valeur à zéro retire le champ du calcul", () => {
    const gratuit: ProfilePricing = { ...P, fieldValues: { ...P.fieldValues, weaknesses: 0 } };
    expect(priceProfile({ ...empty, knownFields: ["weaknesses"] }, gratuit).price).toBe(P.basePrice);
  });

  it("les points suivent le prix selon le taux réglé", () => {
    const result = priceProfile({ ...empty, knownFields: ["weaknesses"] }, P);
    expect(result.points).toBe(Math.round(result.price / P.ryosPerPoint));
  });

  it("un taux de points nul ne divise pas par zéro", () => {
    const sansPoints: ProfilePricing = { ...P, ryosPerPoint: 0 };
    expect(priceProfile(empty, sansPoints).points).toBe(0);
  });
});

describe("priceProfile — le prix doit pouvoir s'expliquer", () => {
  it("le détail couvre l'intégralité du montant", () => {
    const input = {
      knownFields: ["weaknesses", "kekkeiGenkai", "clans", "hairColor"] as const,
      relationCount: 2,
      gradeRank: 3,
    };
    const result = priceProfile({ ...input, knownFields: [...input.knownFields] }, P);
    const somme = result.lines.reduce((total, line) => total + line.amount, 0);
    // Le détail est le sous-total AVANT multiplicateur : le prix final en
    // découle, et l'écart s'explique par le grade.
    expect(Math.round(somme * result.gradeMultiplier / P.roundTo) * P.roundTo).toBe(result.price);
  });
});
