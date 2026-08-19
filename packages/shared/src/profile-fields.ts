/**
 * Dossiers de renseignement — champs, états de connaissance et résolution
 * d'affichage. RÈGLE CENTRALE :
 *
 *   « Inconnu » = la Toile ne possède pas l'information (visible par tous) ;
 *   « ??? »     = la Toile la possède, mais le lecteur n'y a pas droit.
 *
 * Ces textes ne sont JAMAIS stockés : ils sont calculés ici, côté serveur,
 * et la vraie valeur n'est jamais sérialisée pour un lecteur non autorisé.
 */

export type ProfileKnowledge = "UNKNOWN" | "KNOWN" | "NONE_CONFIRMED" | "CONFLICTING";

/** Libellés français des états de connaissance (éditeur, bloc modération). */
export const KNOWLEDGE_LABELS: Record<ProfileKnowledge, string> = {
  UNKNOWN: "Inconnu",
  KNOWN: "Valeur connue",
  NONE_CONFIRMED: "Absence confirmée",
  CONFLICTING: "Contradictoire",
};

export type ProfileDisplayState =
  | "UNKNOWN" // Inconnu — information non acquise
  | "REDACTED" // ??? — acquise mais confidentielle pour ce lecteur
  | "VISIBLE" // valeur réelle
  | "NONE" // Aucun — absence confirmée
  | "CONFLICTING"; // Information contradictoire

export const DISPLAY_LABELS: Record<Exclude<ProfileDisplayState, "VISIBLE">, string> = {
  UNKNOWN: "Inconnu",
  REDACTED: "???",
  NONE: "Aucun",
  CONFLICTING: "Information contradictoire",
};

/** Libellés accessibles (aria) des états non littéraux. */
export const DISPLAY_ARIA_LABELS: Record<Exclude<ProfileDisplayState, "VISIBLE">, string> = {
  UNKNOWN: "Information non renseignée",
  // « Information confidentielle » : la Toile la possède, votre groupe n'y a
  // pas accès. Le mot « confidentiel » est ce que les tests cherchent.
  REDACTED: "Information confidentielle",
  NONE: "Absence confirmée",
  CONFLICTING: "Renseignements contradictoires",
};

/** Un champ sérialisé. `value` n'existe QUE lorsque displayState = VISIBLE. */
export interface ProfileFieldView {
  key: string;
  displayState: ProfileDisplayState;
  displayValue: string;
  /** Détail structuré, présent uniquement si VISIBLE */
  value?: unknown;
  /** Niveau de confiance, exposé aux lecteurs autorisés uniquement */
  confidence?: IntelConfidenceCode | null;
}

export type IntelConfidenceCode = "RUMOR" | "UNCONFIRMED" | "PROBABLE" | "CONFIRMED";

export const CONFIDENCE_LABELS: Record<IntelConfidenceCode, string> = {
  RUMOR: "Rumeur",
  UNCONFIRMED: "Non confirmé",
  PROBABLE: "Probable",
  CONFIRMED: "Confirmé",
};

/**
 * Résout l'état d'affichage d'un champ pour un lecteur.
 * `canView` = modération OU groupe détenteur d'un accès actif.
 */
export function resolveFieldDisplay(
  knowledge: ProfileKnowledge,
  canView: boolean,
): { displayState: ProfileDisplayState; displayValue: string } {
  if (knowledge === "UNKNOWN") {
    return { displayState: "UNKNOWN", displayValue: DISPLAY_LABELS.UNKNOWN };
  }
  if (!canView) {
    // KNOWN, NONE_CONFIRMED et CONFLICTING sont tous des acquis de la Toile
    return { displayState: "REDACTED", displayValue: DISPLAY_LABELS.REDACTED };
  }
  if (knowledge === "NONE_CONFIRMED") {
    return { displayState: "NONE", displayValue: DISPLAY_LABELS.NONE };
  }
  if (knowledge === "CONFLICTING") {
    return { displayState: "CONFLICTING", displayValue: DISPLAY_LABELS.CONFLICTING };
  }
  return { displayState: "VISIBLE", displayValue: "" }; // valeur fournie par l'appelant
}

// ── Clés de champ du dossier (CharacterFieldIntel.fieldKey) ──

/**
 * Champs PUBLICS : connus de tous dès qu'ils sont renseignés, sans accès au
 * dossier — avec le titre et le prénom, ce sont les seules vraies valeurs
 * qu'un lecteur sans accès reçoit. Le nom en fait partie : il figure déjà
 * dans le titre (« Dossier — Akira Hoki »). Ils gardent un état de
 * connaissance (on peut ignorer un nom) mais ne valent rien au barème.
 */
export const PUBLIC_FIELD_KEYS = ["lastName"] as const;

export const PROFILE_FIELD_KEYS = [
  "lastName",
  "sex",
  "image",
  "height",
  "hairColor",
  "skinTone",
  "eyeColor",
  "faction",
  "clans",
  "ninjaClass",
  "rank",
  "lifeStatus",
  "age",
  "chakraNatures",
  "kekkeiGenkai",
  "clanTechniques",
  "signatureTechniques",
  "techniques",
  "combatStyles",
  "kenjutsuStyles",
  "artifacts",
  "details",
  "strengths",
  "weaknesses",
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

const NONE_CAPABLE_FIELDS = new Set<ProfileFieldKey>([
  "lastName",
  "hairColor",
  "ninjaClass",
  "faction",
  "rank",
  "clans",
  "chakraNatures",
  "kekkeiGenkai",
  "clanTechniques",
  "signatureTechniques",
  "combatStyles",
  "kenjutsuStyles",
  "artifacts",
]);

/**
 * « Vérifié : il n'y en a pas » n'est proposé que lorsqu'une absence a un
 * sens métier. Une personne n'a pas « aucune taille », « aucun âge », « aucun
 * sexe » ou « aucun état vital » : dans ces cas, l'information est inconnue.
 */
export function canDeclareNoneForField(key: ProfileFieldKey): boolean {
  return NONE_CAPABLE_FIELDS.has(key);
}

/** Le champ est-il lisible par tous (sans accès au dossier) ? */
export function isPublicProfileField(key: ProfileFieldKey): boolean {
  return (PUBLIC_FIELD_KEYS as readonly string[]).includes(key);
}

export const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = {
  lastName: "Nom",
  sex: "Sexe",
  image: "Image",
  height: "Taille",
  hairColor: "Cheveux",
  skinTone: "Couleur de peau",
  eyeColor: "Couleur des yeux",
  faction: "Faction",
  clans: "Clan",
  ninjaClass: "Classe",
  rank: "Grade",
  lifeStatus: "État",
  age: "Âge",
  chakraNatures: "Nature de chakra",
  kekkeiGenkai: "Kekkei Genkai",
  clanTechniques: "Techniques de clan",
  signatureTechniques: "Subjutsu",
  techniques: "Techniques propres",
  combatStyles: "Style de combat",
  kenjutsuStyles: "Spécialités Kenjutsu",
  artifacts: "Artefact légendaire",
  details: "Détails",
  strengths: "Forces",
  weaknesses: "Faiblesses",
};

// ── Types de référentiel (String extensible — pas d'enum SQL) ──

export const REFERENCE_TYPES = {
  HAIR_COLOR: "HAIR_COLOR",
  SKIN_TONE: "SKIN_TONE",
  // Couleur de l'iris, PAS le dôjutsu : un Sharingan est une technique de
  // clan, l'œil qui le porte reste noir ou rouge de naissance.
  EYE_COLOR: "EYE_COLOR",
  // Classe de combat (Soigneur, Traqueur, Ravageur, Défenseur). Référentiel
  // administrable et non enum SQL : la modération pourra renommer ou ajouter.
  NINJA_CLASS: "NINJA_CLASS",
  CLAN_FAMILY: "CLAN_FAMILY",
  CHAKRA_NATURE: "CHAKRA_NATURE",
  KEKKEI_GENKAI: "KEKKEI_GENKAI",
  // Techniques nées dans un clan mais qui ne lui restent pas forcément :
  // un Sharingan se vole. Distinctes des Kekkei Genkai, qui sont hérités.
  CLAN_TECHNIQUE: "CLAN_TECHNIQUE",
  JUTSU_TYPE: "JUTSU_TYPE",
  // Subjutsu répertoriés (Rasengan, Multi clonage, Ermites…) : catalogue
  // proposé à la saisie des techniques propres, qui reste libre — une
  // technique inconnue du catalogue se consigne quand même.
  SIGNATURE_TECHNIQUE: "SIGNATURE_TECHNIQUE",
  COMBAT_STYLE: "COMBAT_STYLE",
  KENJUTSU_STYLE: "KENJUTSU_STYLE",
  LEGENDARY_ARTIFACT: "LEGENDARY_ARTIFACT",
} as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[keyof typeof REFERENCE_TYPES];

export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
  HAIR_COLOR: "Couleurs de cheveux",
  SKIN_TONE: "Teintes de peau",
  EYE_COLOR: "Couleurs des yeux",
  NINJA_CLASS: "Classes ninja",
  CLAN_FAMILY: "Clans et familles",
  CHAKRA_NATURE: "Natures de chakra",
  KEKKEI_GENKAI: "Kekkei Genkai",
  CLAN_TECHNIQUE: "Techniques de clan",
  JUTSU_TYPE: "Types de jutsu",
  SIGNATURE_TECHNIQUE: "Subjutsu répertoriés",
  COMBAT_STYLE: "Styles de combat",
  KENJUTSU_STYLE: "Sous-styles de Kenjutsu",
  LEGENDARY_ARTIFACT: "Artefacts légendaires",
};

/** Champ de trait ↔ type de référentiel associé. */
export const TRAIT_FIELD_TO_TYPE: Partial<Record<ProfileFieldKey, ReferenceType>> = {
  clans: "CLAN_FAMILY",
  chakraNatures: "CHAKRA_NATURE",
  kekkeiGenkai: "KEKKEI_GENKAI",
  clanTechniques: "CLAN_TECHNIQUE",
  signatureTechniques: "SIGNATURE_TECHNIQUE",
  combatStyles: "COMBAT_STYLE",
  kenjutsuStyles: "KENJUTSU_STYLE",
  artifacts: "LEGENDARY_ARTIFACT",
};

export const SOURCE_SCOPE_LABELS: Record<string, string> = {
  MANGA_CANON: "Manga",
  ANIME: "Anime",
  FILM: "Film",
  GAME: "Jeu",
  SERVER_CUSTOM: "Serveur",
};

// ── Libellés d'identité ──

export const PROFILE_SEX_LABELS: Record<string, string> = {
  MALE: "Masculin",
  FEMALE: "Féminin",
  OTHER: "Autre",
};

export const LIFE_STATUS_LABELS: Record<string, string> = {
  ALIVE: "Vivant",
  DEAD: "Mort",
  MISSING: "Disparu",
};

// ── Utilitaires ──

/** Normalisation anti-doublons : minuscules, sans accents, espaces réduits. */
export function normalizeRefLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** « 185 cm » ou « Entre 180 et 190 cm » — jamais une chaîne stockée. */
export function formatHeight(minCm: number | null, maxCm: number | null): string | null {
  if (minCm == null && maxCm == null) return null;
  if (minCm != null && maxCm != null) {
    return minCm === maxCm ? `${minCm} cm` : `Entre ${minCm} et ${maxCm} cm`;
  }
  if (minCm != null) return `Plus de ${minCm} cm`;
  return `Moins de ${maxCm} cm`;
}

/** Code lisible PRF-000142 depuis le compteur interne. */
export function formatProfileCode(codeNumber: number): string {
  return `PRF-${String(codeNumber).padStart(6, "0")}`;
}

/** « Dossier — Akira Hoki » : le titre par défaut d'un dossier, jamais vide. */
export function formatDossierTitle(firstName: string, lastName?: string | null): string {
  const name = [firstName, lastName].map((s) => s?.trim()).filter(Boolean).join(" ");
  return name ? `Dossier — ${name}` : "Dossier";
}
