/**
 * Référentiels des dossiers de renseignement — seed local, versionné, vérifié
 * à partir du Naruto Wiki (liens `sourceUrl`). AUCUNE dépendance réseau :
 * descriptions courtes originales, pas de texte ni d'image copiés du wiki.
 *
 * `sourceScope` distingue manga / anime / film / jeu / création du serveur —
 * les contenus ne sont jamais mélangés silencieusement.
 */
import type { PrismaClient, ReferenceSourceScope } from "../generated/client";

const WIKI = "https://naruto.fandom.com/fr/wiki";

interface RefDef {
  code: string;
  label: string;
  kanji?: string;
  romaji?: string;
  aliases?: string[];
  category?: string;
  colorHex?: string;
  descriptionShort?: string;
  sourceUrl?: string;
  sourceScope?: ReferenceSourceScope;
  isUnique?: boolean;
  sortOrder?: number;
}

function normalize(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ── Couleurs de cheveux ──
const HAIR_COLORS: RefDef[] = [
  { code: "BLACK", label: "Noir", colorHex: "#181512" },
  { code: "DARK_BROWN", label: "Brun très foncé", colorHex: "#2e2018" },
  { code: "BROWN", label: "Brun", colorHex: "#4a3220" },
  { code: "CHESTNUT", label: "Châtain", colorHex: "#6e4b2a" },
  { code: "BLOND", label: "Blond", colorHex: "#d6b25e" },
  { code: "WHITE", label: "Blanc", colorHex: "#e8e4dc" },
  { code: "GRAY", label: "Gris", colorHex: "#9a9a9a" },
  { code: "RED", label: "Rouge", colorHex: "#a3282e" },
  { code: "GINGER", label: "Roux", colorHex: "#b05a26" },
  { code: "BLUE", label: "Bleu", colorHex: "#3a5a8c" },
  { code: "GREEN", label: "Vert", colorHex: "#3f6b45" },
  { code: "PURPLE", label: "Violet", colorHex: "#5d3a72" },
  { code: "PINK", label: "Rose", colorHex: "#c76e8f" },
  { code: "TWO_TONE", label: "Bicolore" },
  { code: "OTHER", label: "Autre" },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10, sourceScope: "SERVER_CUSTOM" as const }));

// ── Teintes de peau : échelle neutre numérotée avec aperçu ──
const SKIN_TONES: RefDef[] = [
  "#f6e3cf", "#eccfae", "#dfb68d", "#c99a6b",
  "#a97a50", "#8a5f3d", "#6b452c", "#4a2f1e",
].map((hex, i) => ({
  code: `T${i + 1}`,
  label: `Teinte ${i + 1}`,
  colorHex: hex,
  sortOrder: (i + 1) * 10,
  sourceScope: "SERVER_CUSTOM" as const,
  descriptionShort: "Échelle neutre de teintes, du plus clair au plus profond.",
}));

// ── Clans et familles ──
const CLANS: RefDef[] = [
  { code: "UCHIHA", label: "Uchiha", kanji: "うちは一族", aliases: ["Clan Uchiha", "Uchiwa"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Uchiha`, descriptionShort: "Clan de Konoha réputé pour le Sharingan." },
  { code: "HYUGA", label: "Hyûga", kanji: "日向一族", aliases: ["Clan Hyûga", "Hyuga", "Hyuuga"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Hy%C3%BBga`, descriptionShort: "Clan de Konoha porteur du Byakugan." },
  { code: "UZUMAKI", label: "Uzumaki", kanji: "うずまき一族", aliases: ["Clan Uzumaki"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Uzumaki`, descriptionShort: "Clan d'Uzushio à la vitalité et au fûinjutsu remarquables." },
  { code: "SENJU", label: "Senju", kanji: "千手一族", aliases: ["Clan Senju"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Senju`, descriptionShort: "Clan fondateur de Konoha." },
  { code: "NARA", label: "Nara", kanji: "奈良一族", aliases: ["Clan Nara"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Nara`, descriptionShort: "Clan manipulant les ombres." },
  { code: "YAMANAKA", label: "Yamanaka", kanji: "山中一族", aliases: ["Clan Yamanaka"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Yamanaka`, descriptionShort: "Clan des techniques de transfert d'esprit." },
  { code: "AKIMICHI", label: "Akimichi", kanji: "秋道一族", aliases: ["Clan Akimichi"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Akimichi`, descriptionShort: "Clan de l'expansion corporelle." },
  { code: "ABURAME", label: "Aburame", kanji: "油女一族", aliases: ["Clan Aburame"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Aburame`, descriptionShort: "Clan symbiotique des insectes." },
  { code: "INUZUKA", label: "Inuzuka", kanji: "犬塚一族", aliases: ["Clan Inuzuka"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Inuzuka`, descriptionShort: "Clan combattant aux côtés de chiens ninjas." },
  { code: "SARUTOBI", label: "Sarutobi", kanji: "猿飛一族", aliases: ["Clan Sarutobi"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Sarutobi`, descriptionShort: "Clan influent de Konoha." },
  { code: "SHIMURA", label: "Shimura", kanji: "志村一族", aliases: ["Clan Shimura"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Shimura`, descriptionShort: "Clan de Konoha, lignée de Danzô." },
  { code: "HOZUKI", label: "Hôzuki", kanji: "鬼灯一族", aliases: ["Clan Hôzuki", "Hozuki"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_H%C3%B4zuki`, descriptionShort: "Clan de Kiri capable de se liquéfier." },
  { code: "KAGUYA", label: "Kaguya", kanji: "かぐや一族", aliases: ["Clan Kaguya"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_Kaguya`, descriptionShort: "Clan belliqueux de Kiri, lié au Shikotsumyaku." },
  { code: "KURAMA_CLAN", label: "Kurama", kanji: "紅一族", aliases: ["Clan Kurama"], sourceScope: "ANIME", sourceUrl: `${WIKI}/Clan_Kurama`, descriptionShort: "Clan de Konoha aux genjutsu exceptionnels (arc anime)." },
  { code: "HOKI", label: "Hôki", aliases: ["Famille Hôki", "Hoki"], sourceScope: "ANIME", sourceUrl: `${WIKI}/Famille_H%C3%B4ki`, descriptionShort: "Famille liée au village de Takumi (arc anime)." },
  { code: "HAKUMEI", label: "Hakumei", sourceScope: "SERVER_CUSTOM", descriptionShort: "Lignée propre au serveur RP." },
  { code: "SABAKU", label: "Sabaku", sourceScope: "SERVER_CUSTOM", descriptionShort: "Lignée du désert propre au serveur RP." },
  { code: "SHIROGAME", label: "Shirogame", sourceScope: "SERVER_CUSTOM", descriptionShort: "Lignée propre au serveur RP." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

// ── Natures de chakra ──
/**
 * Natures de chakra : **les cinq éléments primaires, et rien d'autre**.
 *
 * Tout le reste — Yin, Yang, et l'ensemble des dérivés (Mokuton, Hyôton, Lave,
 * Ranton, Sakin…) — relève des Kekkei Genkai. Le référentiel mélangeait les
 * deux, si bien qu'un dérivé pouvait être saisi comme « nature » chez un
 * personnage qui n'a aucune lignée : la distinction qui fonde le Kekkei Genkai
 * disparaissait. Les entrées retirées sont désactivées et non supprimées
 * (voir DEPRECATED_CHAKRA_NATURES) : les dossiers existants les conservent.
 */
const CHAKRA_NATURES: RefDef[] = [
  { code: "KATON", label: "Katon", kanji: "火遁", romaji: "Katon", aliases: ["Feu"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Katon`, descriptionShort: "Nature élémentaire du feu." },
  { code: "SUITON", label: "Suiton", kanji: "水遁", romaji: "Suiton", aliases: ["Eau"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Suiton`, descriptionShort: "Nature élémentaire de l'eau." },
  { code: "FUTON", label: "Fûton", kanji: "風遁", romaji: "Fūton", aliases: ["Vent", "Futon"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/F%C3%BBton`, descriptionShort: "Nature élémentaire du vent." },
  { code: "RAITON", label: "Raiton", kanji: "雷遁", romaji: "Raiton", aliases: ["Foudre"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Raiton`, descriptionShort: "Nature élémentaire de la foudre." },
  { code: "DOTON", label: "Doton", kanji: "土遁", romaji: "Doton", aliases: ["Terre"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Doton`, descriptionShort: "Nature élémentaire de la terre." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

/** Anciennes « natures » désormais classées ailleurs — désactivées, jamais supprimées. */
const DEPRECATED_CHAKRA_NATURES = [
  "INTON",
  "YOTON_YANG",
  "MOKUTON",
  "HYOTON",
  "YOTON_LAVA",
  "FUTTON",
  "RANTON",
  "JITON",
  "SHAKUTON",
  "BAKUTON",
  "ENTON",
  "SHOTON",
  "JINTON_DUST",
];

// ── Kekkei Genkai ──
const KEKKEI_GENKAI: RefDef[] = [
  { code: "BYAKUGAN", label: "Byakugan", kanji: "白眼", romaji: "Byakugan", category: "DOJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Byakugan`, descriptionShort: "Pupille du clan Hyûga : vision à 360° et lecture des méridiens." },
  { code: "SHARINGAN", label: "Sharingan", kanji: "写輪眼", romaji: "Sharingan", category: "DOJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Sharingan`, descriptionShort: "Pupille du clan Uchiha : perception et copie." },
  { code: "MANGEKYO_SHARINGAN", label: "Mangekyô Sharingan", kanji: "万華鏡写輪眼", romaji: "Mangekyō Sharingan", aliases: ["Mangekyou"], category: "DOJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Mangeky%C3%B4_Sharingan`, descriptionShort: "Évolution rare du Sharingan aux techniques uniques." },
  { code: "RINNEGAN", label: "Rinnegan", kanji: "輪廻眼", romaji: "Rinnegan", category: "DOJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Rinnegan`, descriptionShort: "Pupille légendaire du Sage des Six Chemins." },
  { code: "KETSURYUGAN", label: "Ketsuryûgan", kanji: "血龍眼", romaji: "Ketsuryūgan", category: "DOJUTSU", sourceScope: "ANIME", sourceUrl: `${WIKI}/Ketsury%C3%BBgan`, descriptionShort: "Pupille du clan Chinoike, maîtrise du fer sanguin (anime/roman)." },
  { code: "SHIKOTSUMYAKU", label: "Shikotsumyaku", kanji: "屍骨脈", romaji: "Shikotsumyaku", category: "PHYSICAL", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Shikotsumyaku`, descriptionShort: "Manipulation de sa propre ossature (clan Kaguya)." },
  { code: "MOKUTON", label: "Mokuton", kanji: "木遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Mokuton`, descriptionShort: "Kekkei Genkai du bois." },
  { code: "HYOTON", label: "Hyôton", kanji: "氷遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Hy%C3%B4ton`, descriptionShort: "Kekkei Genkai de la glace." },
  { code: "YOTON_LAVA", label: "Yôton — Lave", kanji: "熔遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai de la lave." },
  { code: "FUTTON", label: "Futton", kanji: "沸遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai de la vapeur." },
  { code: "RANTON", label: "Ranton", kanji: "嵐遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai de la tempête." },
  { code: "JITON", label: "Jiton — Magnétisme", kanji: "磁遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai du magnétisme." },
  { code: "SHAKUTON", label: "Shakuton", kanji: "灼遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai de la brûlure." },
  { code: "BAKUTON", label: "Bakuton", kanji: "爆遁", category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Genkai de l'explosion." },
  { code: "JUGO_CLAN", label: "Kekkei Genkai du clan Jûgo", romaji: "Senninka", aliases: ["Transformation sennin"], category: "CLAN_ABILITY", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Clan_J%C3%BBgo`, descriptionShort: "Absorption d'énergie naturelle et métamorphoses incontrôlées." },
  { code: "KURAMA_CLAN", label: "Kekkei Genkai du clan Kurama", category: "CLAN_ABILITY", sourceScope: "ANIME", sourceUrl: `${WIKI}/Clan_Kurama`, descriptionShort: "Genjutsu si puissants qu'ils blessent réellement (arc anime)." },
  { code: "SAKON_UKON", label: "Kekkei Genkai de Sakon et Ukon", romaji: "Sōma no Kō", category: "CLAN_ABILITY", sourceScope: "MANGA_CANON", descriptionShort: "Fusion de deux corps en un seul hôte." },
  { code: "JINTON_DUST", label: "Jinton — Poussière", kanji: "塵遁", category: "KEKKEI_TOTA", sourceScope: "MANGA_CANON", descriptionShort: "Kekkei Tôta de la désintégration." },
  // Dérivés qui figuraient à tort parmi les natures de chakra
  { code: "ENTON", label: "Enton — Flammes noires", kanji: "炎遁", romaji: "Enton", aliases: ["Amaterasu", "Blaze"], category: "ELEMENTAL", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Enton`, descriptionShort: "Maîtrise des flammes noires d'Amaterasu — lié au Mangekyô." },
  { code: "SHOTON", label: "Shôton — Cristal", kanji: "晶遁", romaji: "Shōton", aliases: ["Cristal", "Shoton"], category: "ELEMENTAL", sourceScope: "ANIME", sourceUrl: `${WIKI}/Sh%C3%B4ton`, descriptionShort: "Cristallisation de la matière (arc anime)." },
  { code: "SAKIN", label: "Sakin — Poudre d'or", kanji: "砂金", romaji: "Sakin", aliases: ["Sable doré", "Or"], category: "ELEMENTAL", sourceScope: "MANGA_CANON", descriptionShort: "Poudre d'or manipulée par magnétisme — arme du Quatrième Kazekage." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

// ── Techniques de clan ──
// Elles naissent dans un clan mais ne lui restent pas nécessairement : un
// Sharingan se vole, un Susanoo s'observe chez qui n'est pas Uchiha. C'est
// précisément ce qui en fait un renseignement — d'où un référentiel séparé
// des Kekkei Genkai, qui sont eux hérités.
const CLAN_TECHNIQUES: RefDef[] = [
  { code: "SUSANOO", label: "Susanoo", kanji: "須佐能乎", romaji: "Susanoo", category: "UCHIHA", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Susanoo`, descriptionShort: "Avatar de chakra du Mangekyô — des côtes au corps parfait." },
  { code: "SUSANOO_PARFAIT", label: "Susanoo parfait", kanji: "完成体須佐能乎", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Forme achevée du Susanoo, réservée à de très rares porteurs." },
  { code: "AMATERASU", label: "Amaterasu", kanji: "天照", category: "UCHIHA", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Amaterasu`, descriptionShort: "Flammes noires inextinguibles du Mangekyô." },
  { code: "TSUKUYOMI", label: "Tsukuyomi", kanji: "月読", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Genjutsu absolu du Mangekyô, distorsion du temps perçu." },
  { code: "KAMUI", label: "Kamui", kanji: "神威", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Déplacement dimensionnel — intangibilité et téléportation." },
  { code: "KOTOAMATSUKAMI", label: "Kotoamatsukami", kanji: "別天神", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Manipulation mentale sans que la victime s'en aperçoive." },
  { code: "IZANAGI", label: "Izanagi", kanji: "伊邪那岐", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Réécrit la réalité au prix d'un œil." },
  { code: "IZANAMI", label: "Izanami", kanji: "伊邪那美", category: "UCHIHA", sourceScope: "MANGA_CANON", descriptionShort: "Enferme la cible dans une boucle jusqu'à ce qu'elle s'accepte." },
  { code: "JUKEN", label: "Jûken — Poing souple", kanji: "柔拳", category: "HYUGA", sourceScope: "MANGA_CANON", descriptionShort: "Frappe les méridiens à travers la chair, associée au Byakugan." },
  { code: "HAKKESHO_KAITEN", label: "Hakkeshô Kaiten", kanji: "八卦掌回天", category: "HYUGA", sourceScope: "MANGA_CANON", descriptionShort: "Rotation défensive absolue rejetant toute attaque." },
  { code: "HAKKE_ROKUJUYON", label: "Hakke Rokujûyon Shô", kanji: "八卦六十四掌", category: "HYUGA", sourceScope: "MANGA_CANON", descriptionShort: "Soixante-quatre frappes scellant le flux de chakra." },
  { code: "SHIKOTSUMYAKU_ARMES", label: "Ossature offensive (Shikotsumyaku)", category: "KAGUYA", sourceScope: "MANGA_CANON", descriptionShort: "Extraction d'armes depuis sa propre ossature." },
  { code: "HIDEN_NARA", label: "Techniques d'ombre (Nara)", kanji: "影真似の術", category: "NARA", sourceScope: "MANGA_CANON", descriptionShort: "Capture et imitation par l'ombre." },
  { code: "HIDEN_YAMANAKA", label: "Transfert d'esprit (Yamanaka)", kanji: "心転身の術", category: "YAMANAKA", sourceScope: "MANGA_CANON", descriptionShort: "Prise de contrôle de l'esprit d'autrui." },
  { code: "HIDEN_AKIMICHI", label: "Multiplication corporelle (Akimichi)", kanji: "倍化の術", category: "AKIMICHI", sourceScope: "MANGA_CANON", descriptionShort: "Amplification de la masse corporelle." },
  { code: "HIDEN_ABURAME", label: "Symbiose des insectes (Aburame)", category: "ABURAME", sourceScope: "MANGA_CANON", descriptionShort: "Colonies de kikaichû nourries au chakra." },
  { code: "HIDEN_INUZUKA", label: "Combat symbiotique (Inuzuka)", category: "INUZUKA", sourceScope: "MANGA_CANON", descriptionShort: "Combat en meute avec un canidé partenaire." },
  { code: "JUINJUTSU_MARQUE", label: "Marque maudite", kanji: "呪印", aliases: ["Sceau maudit", "Juin"], category: "JUINJUTSU", sourceScope: "MANGA_CANON", descriptionShort: "Sceau greffé conférant une puissance empruntée — et une emprise." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

// ── Types de jutsu ──
const JUTSU_TYPES: RefDef[] = [
  { code: "NINJUTSU", label: "Ninjutsu", kanji: "忍術", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Ninjutsu` },
  { code: "TAIJUTSU", label: "Taijutsu", kanji: "体術", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Taijutsu` },
  { code: "GENJUTSU", label: "Genjutsu", kanji: "幻術", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Genjutsu` },
  { code: "FUINJUTSU", label: "Fûinjutsu", kanji: "封印術", aliases: ["Sceaux"], sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/F%C3%BBinjutsu` },
  { code: "IRYO_NINJUTSU", label: "Iryô Ninjutsu", kanji: "医療忍術", aliases: ["Techniques médicales"], sourceScope: "MANGA_CANON" },
  { code: "SENJUTSU", label: "Senjutsu", kanji: "仙術", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Senjutsu` },
  { code: "KINJUTSU", label: "Kinjutsu", kanji: "禁術", aliases: ["Technique interdite"], sourceScope: "MANGA_CANON" },
  { code: "JUINJUTSU", label: "Juinjutsu", kanji: "呪印術", aliases: ["Marques maudites"], sourceScope: "MANGA_CANON" },
  { code: "KUCHIYOSE", label: "Kuchiyose", kanji: "口寄せ", aliases: ["Invocation"], sourceScope: "MANGA_CANON" },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

// ── Subjutsu répertoriés ──
// Catalogue proposé à la saisie des techniques propres (qui reste libre).
// `category` porte le code du TYPE DE JUTSU correspondant : l'interface s'en
// sert pour préremplir le type quand une entrée du catalogue est choisie.
const SIGNATURE_TECHNIQUES: RefDef[] = [
  { code: "MULTI_CLONAGE", label: "Multi clonage", kanji: "多重影分身の術", romaji: "Tajū Kage Bunshin no Jutsu", aliases: ["Multiclonage", "Tajû Kage Bunshin"], category: "NINJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Multi_Clonage`, descriptionShort: "Clonage de l'ombre démultiplié — interdit tant il dévore le chakra." },
  { code: "RASENGAN", label: "Rasengan", kanji: "螺旋丸", romaji: "Rasengan", aliases: ["Orbe tourbillonnant"], category: "NINJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Rasengan`, descriptionShort: "Sphère de chakra en rotation, legs du Quatrième Hokage." },
  { code: "CHIDORI", label: "Chidori", kanji: "千鳥", romaji: "Chidori", aliases: ["Mille oiseaux"], category: "NINJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Chidori`, descriptionShort: "Perçée de foudre au chant de mille oiseaux." },
  { code: "HIRAISHIN", label: "Hiraishin", kanji: "飛雷神の術", romaji: "Hiraishin no Jutsu", aliases: ["Dieu du tonnerre volant"], category: "NINJUTSU", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Hiraishin_no_Jutsu`, descriptionShort: "Téléportation instantanée vers une marque scellée." },
  { code: "MARQUE_MAUDITE", label: "Marque maudite", kanji: "呪印", aliases: ["Sceau maudit", "Juin"], category: "JUINJUTSU", sourceScope: "MANGA_CANON", descriptionShort: "Sceau greffé conférant une puissance empruntée — et une emprise." },
  // Paliers « Rang X » des règles du serveur : maîtrise ultime d'un élément.
  { code: "RANG_X_DOTON", label: "Rang X — Doton", aliases: ["Rang X Terre"], category: "NINJUTSU", descriptionShort: "Palier ultime de la maîtrise du Doton (règles du serveur)." },
  { code: "RANG_X_FUTON", label: "Rang X — Fûton", aliases: ["Rang X Vent"], category: "NINJUTSU", descriptionShort: "Palier ultime de la maîtrise du Fûton (règles du serveur)." },
  { code: "RANG_X_KATON", label: "Rang X — Katon", aliases: ["Rang X Feu"], category: "NINJUTSU", descriptionShort: "Palier ultime de la maîtrise du Katon (règles du serveur)." },
  { code: "RANG_X_SUITON", label: "Rang X — Suiton", aliases: ["Rang X Eau"], category: "NINJUTSU", descriptionShort: "Palier ultime de la maîtrise du Suiton (règles du serveur)." },
  { code: "RANG_X_RAITON", label: "Rang X — Raiton", aliases: ["Rang X Foudre"], category: "NINJUTSU", descriptionShort: "Palier ultime de la maîtrise du Raiton (règles du serveur)." },
  // Voies de l'ermite ouvertes par lignée.
  { code: "ERMITE_SENJU", label: "Ermite — Senju", aliases: ["Mode Sage Senju"], category: "SENJUTSU", descriptionShort: "Voie de l'ermite ouverte à la lignée Senju (règles du serveur)." },
  { code: "ERMITE_HOKI", label: "Ermite — Hôki", aliases: ["Mode Sage Hôki", "Ermite Hoki"], category: "SENJUTSU", descriptionShort: "Voie de l'ermite ouverte à la famille Hôki (règles du serveur)." },
  { code: "ERMITE_SABAKU", label: "Ermite — Sabaku", aliases: ["Mode Sage Sabaku"], category: "SENJUTSU", descriptionShort: "Voie de l'ermite ouverte à la lignée Sabaku (règles du serveur)." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10, sourceScope: d.sourceScope ?? ("SERVER_CUSTOM" as const) }));

// ── Styles de combat ──
const COMBAT_STYLES: RefDef[] = [
  { code: "TAIJUTSU", label: "Taijutsu", kanji: "体術", sourceScope: "MANGA_CANON" },
  { code: "GENJUTSU", label: "Genjutsu", kanji: "幻術", sourceScope: "MANGA_CANON" },
  { code: "KENJUTSU", label: "Kenjutsu", kanji: "剣術", sourceScope: "MANGA_CANON" },
  { code: "BUKIJUTSU", label: "Bukijutsu", kanji: "武器術", aliases: ["Maîtrise des armes"], sourceScope: "MANGA_CANON" },
  { code: "SHURIKENJUTSU", label: "Shurikenjutsu", kanji: "手裏剣術", sourceScope: "MANGA_CANON" },
  { code: "FUINJUTSU", label: "Fûinjutsu", kanji: "封印術", sourceScope: "MANGA_CANON" },
  { code: "SENJUTSU", label: "Senjutsu", kanji: "仙術", sourceScope: "MANGA_CANON" },
  { code: "DOJUTSU", label: "Dôjutsu", kanji: "瞳術", sourceScope: "MANGA_CANON" },
  { code: "KUGUTSU", label: "Kugutsu — marionnettisme", kanji: "傀儡", aliases: ["Marionnettiste"], sourceScope: "MANGA_CANON" },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

// ── Sous-styles de Kenjutsu (règles du serveur) ──
const KENJUTSU_STYLES: RefDef[] = [
  { code: "SINGLE_BLADE", label: "Lame simple" },
  { code: "DUAL_BLADE", label: "Double lame" },
  { code: "HEAVY_BLADE", label: "Lame lourde" },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10, sourceScope: "SERVER_CUSTOM" as const }));

// ── Artefacts légendaires : les Sept Épées de la Brume ──
const SEVEN_SWORDS_CATEGORY = "Sept Épées de la Brume";
const ARTIFACTS: RefDef[] = [
  { code: "KUBIKIRIBOCHO", label: "Kubikiribôchô", kanji: "首斬り包丁", romaji: "Kubikiribōchō", aliases: ["Épée-couperet", "Épée de Zabuza"], descriptionShort: "Immense couperet qui se régénère du fer contenu dans le sang." },
  { code: "SAMEHADA", label: "Samehada", kanji: "鮫肌", romaji: "Samehada", aliases: ["Peau de requin"], descriptionShort: "Lame vivante couverte d'écailles, dévoreuse de chakra." },
  { code: "HIRAMEKAREI", label: "Hiramekarei", kanji: "ヒラメカレイ", romaji: "Hiramekarei", descriptionShort: "Épée jumelée capable de projeter des armes de chakra." },
  { code: "KIBA", label: "Kiba", kanji: "牙", romaji: "Kiba", aliases: ["Les Crocs"], descriptionShort: "Paire de lames imprégnées de foudre, les plus tranchantes." },
  { code: "NUIBARI", label: "Nuibari", kanji: "縫い針", romaji: "Nuibari", aliases: ["L'Aiguille"], descriptionShort: "Aiguille et fil capables de coudre les cibles entre elles." },
  { code: "KABUTOWARI", label: "Kabutowari", kanji: "兜割", romaji: "Kabutowari", aliases: ["Le Fendeur de casque"], descriptionShort: "Hache et marteau réputés briser toute défense." },
  { code: "SHIBUKI", label: "Shibuki", kanji: "飛沫", romaji: "Shibuki", aliases: ["L'Explosive"], descriptionShort: "Lame chargée de parchemins explosifs." },
].map((d, i) => ({
  ...d,
  sortOrder: (i + 1) * 10,
  category: SEVEN_SWORDS_CATEGORY,
  sourceScope: "MANGA_CANON" as const,
  sourceUrl: `${WIKI}/Sept_%C3%89p%C3%A9istes_de_la_Brume`,
  isUnique: true,
}));

const ALL_REFERENCES: [string, RefDef[]][] = [
  ["HAIR_COLOR", HAIR_COLORS],
  ["SKIN_TONE", SKIN_TONES],
  ["CLAN_FAMILY", CLANS],
  ["CHAKRA_NATURE", CHAKRA_NATURES],
  ["KEKKEI_GENKAI", KEKKEI_GENKAI],
  ["CLAN_TECHNIQUE", CLAN_TECHNIQUES],
  ["JUTSU_TYPE", JUTSU_TYPES],
  ["SIGNATURE_TECHNIQUE", SIGNATURE_TECHNIQUES],
  ["COMBAT_STYLE", COMBAT_STYLES],
  ["KENJUTSU_STYLE", KENJUTSU_STYLES],
  ["LEGENDARY_ARTIFACT", ARTIFACTS],
];

export async function seedProfileReferences(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const [type, defs] of ALL_REFERENCES) {
    for (const def of defs) {
      await prisma.profileReferenceOption.upsert({
        where: { type_code: { type, code: def.code } },
        update: {
          label: def.label,
          normalizedLabel: normalize(def.label),
          aliases: def.aliases ?? [],
          kanji: def.kanji ?? null,
          romaji: def.romaji ?? null,
          category: def.category ?? null,
          colorHex: def.colorHex ?? null,
          descriptionShort: def.descriptionShort ?? null,
          sourceUrl: def.sourceUrl ?? null,
          sourceScope: def.sourceScope ?? "SERVER_CUSTOM",
          sortOrder: def.sortOrder ?? 100,
          isUnique: def.isUnique ?? false,
        },
        create: {
          type,
          code: def.code,
          label: def.label,
          normalizedLabel: normalize(def.label),
          aliases: def.aliases ?? [],
          kanji: def.kanji ?? null,
          romaji: def.romaji ?? null,
          category: def.category ?? null,
          colorHex: def.colorHex ?? null,
          descriptionShort: def.descriptionShort ?? null,
          sourceUrl: def.sourceUrl ?? null,
          sourceScope: def.sourceScope ?? "SERVER_CUSTOM",
          sortOrder: def.sortOrder ?? 100,
          isUnique: def.isUnique ?? false,
        },
      });
      count += 1;
    }
  }

  // Natures reclassées en Kekkei Genkai : elles sortent du choix mais ne sont
  // PAS supprimées. Un dossier qui porte « Mokuton » comme nature continue de
  // l'afficher — effacer une information déjà recueillie serait pire que de
  // laisser une entrée dépréciée.
  const retired = await prisma.profileReferenceOption.updateMany({
    where: {
      type: "CHAKRA_NATURE",
      code: { in: DEPRECATED_CHAKRA_NATURES },
      isActive: true,
    },
    data: { isActive: false },
  });
  if (retired.count > 0) {
    console.log(`Natures de chakra reclassées en Kekkei Genkai : ${retired.count} retirées du choix.`);
  }

  return count;
}
