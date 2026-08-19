import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE_PRICING,
  PRICING_GROUPS,
  gradeMultiplier,
  priceProfile,
  type ProfilePricing,
} from "./profile-pricing";
import { PROFILE_FIELD_KEYS } from "./profile-fields";

const P = DEFAULT_PROFILE_PRICING;
const empty = { knownFields: [], relationGradeRanks: [], gradeRank: null };

describe("barème — chaque champ de dossier a un prix", () => {
  // Le barème est un Partial<Record> : le compilateur laisse passer l'oubli.
  // Un champ ajouté aux dossiers sans ligne ici serait vendu gratuitement.
  it.each(PROFILE_FIELD_KEYS)("le champ « %s » figure au barème par défaut", (key) => {
    expect(P.fieldValues[key]).toBeTypeOf("number");
    expect(P.fieldValues[key]).toBeGreaterThan(0);
  });

  it("chaque champ du barème est rangé dans un groupe explicable", () => {
    const grouped = new Set(PRICING_GROUPS.flatMap((g) => g.fields));
    for (const key of PROFILE_FIELD_KEYS) expect(grouped.has(key), key).toBe(true);
  });
});

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

describe("priceProfile — les proches donnent prise", () => {
  it("les liens ajoutent de la valeur", () => {
    const sans = priceProfile(empty, P).price;
    const avec = priceProfile({ ...empty, relationGradeRanks: [null, null, null] }, P).price;
    expect(avec).toBe(sans + 3 * P.relationValue);
  });

  it("la petite sœur d'un grand ninja vaut plus cher qu'une inconnue", () => {
    // Aucun talent, aucune aptitude : toute sa valeur tient à son frère.
    const soeurDeKage = priceProfile({ ...empty, relationGradeRanks: [6] }, P).price;
    const soeurDinconnu = priceProfile({ ...empty, relationGradeRanks: [null] }, P).price;
    expect(soeurDeKage).toBeGreaterThan(soeurDinconnu);
  });

  it("un dossier vide mais bien apparenté vaut plus qu'un dossier vide", () => {
    const vide = priceProfile(empty, P).price;
    const apparente = priceProfile({ ...empty, relationGradeRanks: [6, 5] }, P).price;
    expect(apparente).toBeGreaterThan(vide * 2);
  });

  it("au-delà du plafond, les liens n'ajoutent plus rien", () => {
    const ranks = Array.from({ length: P.relationCap }, () => null);
    const plafond = priceProfile({ ...empty, relationGradeRanks: ranks }, P).price;
    const au_dela = priceProfile(
      { ...empty, relationGradeRanks: [...ranks, ...Array.from({ length: 50 }, () => null)] },
      P,
    ).price;
    expect(au_dela).toBe(plafond);
  });

  it("le plafond retient les liens les PLUS précieux", () => {
    // Un lien vers un Kage noyé parmi des inconnus ne doit pas être écarté.
    const petitCap = { ...P, relationCap: 1 };
    const avecKage = priceProfile({ ...empty, relationGradeRanks: [null, null, 6] }, petitCap).price;
    const sansKage = priceProfile({ ...empty, relationGradeRanks: [null, null, null] }, petitCap).price;
    expect(avecKage).toBeGreaterThan(sansKage);
  });

  it("aucun lien ne retire de valeur", () => {
    expect(priceProfile(empty, P).price).toBe(P.basePrice);
  });

  it("un levier nul rend tous les liens équivalents", () => {
    const sansLevier = { ...P, relationLeverage: 0 };
    const kage = priceProfile({ ...empty, relationGradeRanks: [6] }, sansLevier).price;
    const inconnu = priceProfile({ ...empty, relationGradeRanks: [null] }, sansLevier).price;
    expect(kage).toBe(inconnu);
  });
});

describe("priceProfile — l'histoire donne barre sans porter un coup", () => {
  it("le passé pèse autant que les meilleures aptitudes", () => {
    const plancher = priceProfile(empty, P).price;
    const histoire = priceProfile({ ...empty, knownFields: ["details"] }, P).price - plancher;
    const force = priceProfile({ ...empty, knownFields: ["strengths"] }, P).price - plancher;
    expect(histoire).toBeGreaterThan(force);
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
    const result = priceProfile(
      {
        knownFields: ["weaknesses", "kekkeiGenkai", "clans", "hairColor"],
        relationGradeRanks: [4, null],
        gradeRank: 3,
      },
      P,
    );
    const somme = result.lines.reduce((total, line) => total + line.amount, 0);
    // Le détail est le sous-total AVANT multiplicateur : le prix final en
    // découle, et l'écart s'explique par le grade.
    expect(Math.round(somme * result.gradeMultiplier / P.roundTo) * P.roundTo).toBe(result.price);
  });
});
