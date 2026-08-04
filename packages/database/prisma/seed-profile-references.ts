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
const CHAKRA_NATURES: RefDef[] = [
  { code: "KATON", label: "Katon", kanji: "火遁", romaji: "Katon", aliases: ["Feu"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Katon`, descriptionShort: "Nature élémentaire du feu." },
  { code: "SUITON", label: "Suiton", kanji: "水遁", romaji: "Suiton", aliases: ["Eau"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Suiton`, descriptionShort: "Nature élémentaire de l'eau." },
  { code: "FUTON", label: "Fûton", kanji: "風遁", romaji: "Fūton", aliases: ["Vent", "Futon"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/F%C3%BBton`, descriptionShort: "Nature élémentaire du vent." },
  { code: "RAITON", label: "Raiton", kanji: "雷遁", romaji: "Raiton", aliases: ["Foudre"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Raiton`, descriptionShort: "Nature élémentaire de la foudre." },
  { code: "DOTON", label: "Doton", kanji: "土遁", romaji: "Doton", aliases: ["Terre"], category: "BASIC_ELEMENT", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Doton`, descriptionShort: "Nature élémentaire de la terre." },
  { code: "INTON", label: "Inton — Yin", kanji: "陰遁", romaji: "Inton", aliases: ["Yin"], category: "YIN_YANG", sourceScope: "MANGA_CANON", descriptionShort: "Énergie spirituelle, socle des illusions et de la forme." },
  { code: "YOTON_YANG", label: "Yôton — Yang", kanji: "陽遁", romaji: "Yōton (Yang)", aliases: ["Yang"], category: "YIN_YANG", sourceScope: "MANGA_CANON", descriptionShort: "Énergie physique, socle de la vitalité. À ne pas confondre avec la Lave." },
  { code: "MOKUTON", label: "Mokuton", kanji: "木遁", romaji: "Mokuton", aliases: ["Bois"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Mokuton`, descriptionShort: "Bois — union de la terre et de l'eau." },
  { code: "HYOTON", label: "Hyôton", kanji: "氷遁", romaji: "Hyōton", aliases: ["Glace", "Hyoton"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Hy%C3%B4ton`, descriptionShort: "Glace — union du vent et de l'eau." },
  { code: "YOTON_LAVA", label: "Yôton — Lave", kanji: "熔遁", romaji: "Yōton (Lave)", aliases: ["Lave"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Y%C3%B4ton`, descriptionShort: "Lave — union du feu et de la terre. Homonyme du Yang : codes distincts." },
  { code: "FUTTON", label: "Futton", kanji: "沸遁", romaji: "Futton", aliases: ["Vapeur", "Ébullition"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Futton`, descriptionShort: "Vapeur corrosive — union du feu et de l'eau." },
  { code: "RANTON", label: "Ranton", kanji: "嵐遁", romaji: "Ranton", aliases: ["Tempête"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Ranton`, descriptionShort: "Tempête — union de la foudre et de l'eau." },
  { code: "JITON", label: "Jiton — Magnétisme", kanji: "磁遁", romaji: "Jiton", aliases: ["Magnétisme"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Jiton`, descriptionShort: "Magnétisme — manipulation de particules aimantées." },
  { code: "SHAKUTON", label: "Shakuton", kanji: "灼遁", romaji: "Shakuton", aliases: ["Brûlure"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Shakuton`, descriptionShort: "Combustion desséchante — union du feu et du vent." },
  { code: "BAKUTON", label: "Bakuton", kanji: "爆遁", romaji: "Bakuton", aliases: ["Explosion"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Bakuton`, descriptionShort: "Chakra explosif — union de la foudre et de la terre." },
  { code: "ENTON", label: "Enton", kanji: "炎遁", romaji: "Enton", aliases: ["Flammes noires", "Blaze"], category: "KEKKEI_GENKAI", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Enton`, descriptionShort: "Maîtrise des flammes d'Amaterasu." },
  { code: "SHOTON", label: "Shôton", kanji: "晶遁", romaji: "Shōton", aliases: ["Cristal", "Shoton"], category: "KEKKEI_GENKAI", sourceScope: "ANIME", sourceUrl: `${WIKI}/Sh%C3%B4ton`, descriptionShort: "Cristallisation de la matière (arc anime)." },
  { code: "JINTON_DUST", label: "Jinton — Poussière", kanji: "塵遁", romaji: "Jinton", aliases: ["Poussière"], category: "KEKKEI_TOTA", sourceScope: "MANGA_CANON", sourceUrl: `${WIKI}/Jinton`, descriptionShort: "Désintégration moléculaire — trois natures combinées." },
].map((d, i) => ({ ...d, sortOrder: (i + 1) * 10 }));

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
  ["JUTSU_TYPE", JUTSU_TYPES],
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
  return count;
}
