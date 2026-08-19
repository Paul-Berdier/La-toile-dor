import "server-only";
import type { Prisma } from "@toile/database";
import {
  resolveFieldDisplay,
  formatHeight,
  formatProfileCode,
  computeCharacterAge,
  formatCharacterAge,
  PROFILE_FIELD_LABELS,
  PROFILE_SEX_LABELS,
  LIFE_STATUS_LABELS,
  SOURCE_SCOPE_LABELS,
  TRAIT_FIELD_TO_TYPE,
  isPublicProfileField,
  PROFILE_IMAGE_TYPE_LABELS,
  type ProfileGalleryView,
  type ProfileImageType,
  type ProfileFieldKey,
  type ProfileFieldView,
  type ProfileKnowledge,
  type RpTimeConfig,
} from "@toile/shared";
import type { ProfileViewer } from "./access";

/** Chargement standard d'un dossier pour sérialisation. */
export const dossierInclude = {
  hairColor: true,
  skinTone: true,
  eyeColor: true,
  eyeColorSecondary: true,
  ninjaClass: true,
  faction: { select: { id: true, name: true } },
  rank: { select: { id: true, label: true } },
  fieldIntel: true,
  traits: { include: { option: true } },
  techniques: { include: { jutsuType: true }, orderBy: { createdAt: "asc" } },
  // Métadonnées seulement — JAMAIS `imageData` ici : les octets passent par
  // la route gardée, et ne doivent pas être chargés à chaque lecture.
  images: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      type: true,
      caption: true,
      isPrimary: true,
      sortOrder: true,
      sizeBytes: true,
      createdAt: true,
      sourceMission: { select: { code: true } },
    },
  },
} satisfies Prisma.CharacterProfileInclude;

export type DossierRecord = Prisma.CharacterProfileGetPayload<{ include: typeof dossierInclude }>;

export interface SerializedDossier {
  id: string;
  code: string;
  firstName: string; // toujours visible, règle du produit
  canViewValues: boolean;
  archived: boolean;
  updatedAt: string;
  /** Portrait : uniquement un indicateur — l'image passe par une route gardée */
  image: ProfileFieldView;
  /** Galerie : métadonnées seulement, et seulement pour qui peut lire */
  gallery: ProfileGalleryView;
  fields: Record<ProfileFieldKey, ProfileFieldView>;
}

interface OptionValue {
  id: string;
  code: string;
  label: string;
  category: string | null;
  colorHex: string | null;
  sourceScope: string;
  sourceScopeLabel: string;
}

function optionValue(option: {
  id: string;
  code: string;
  label: string;
  category: string | null;
  colorHex: string | null;
  sourceScope: string;
}): OptionValue {
  return {
    id: option.id,
    code: option.code,
    label: option.label,
    category: option.category,
    colorHex: option.colorHex,
    sourceScope: option.sourceScope,
    sourceScopeLabel: SOURCE_SCOPE_LABELS[option.sourceScope] ?? option.sourceScope,
  };
}

/**
 * Construit la vue d'UN champ pour UN lecteur. C'est ici, et seulement ici,
 * que la valeur réelle entre dans l'objet — et uniquement si le lecteur y a
 * droit. Partagée par le dossier complet et par l'aperçu de la liste, pour
 * qu'une carte ne puisse jamais dire plus que le dossier.
 */
export function buildFieldView(
  key: ProfileFieldKey,
  intelState: ProfileKnowledge | undefined,
  raw: { value: unknown; label: string } | null,
  canView: boolean,
  confidence?: string | null,
): ProfileFieldView {
  // Absence de ligne d'intel : une valeur présente vaut KNOWN, sinon UNKNOWN
  const knowledge: ProfileKnowledge = intelState ?? (raw ? "KNOWN" : "UNKNOWN");
  // Donnée déclarée connue mais absente (sécurité) → traiter comme inconnue
  const effective: ProfileKnowledge = knowledge === "KNOWN" && !raw ? "UNKNOWN" : knowledge;

  // Le nom est PUBLIC (il figure dans le titre) : visible de tous dès qu'il
  // est connu. Les autres champs suivent la décision d'accès.
  const resolved = resolveFieldDisplay(effective, canView || isPublicProfileField(key));
  const view: ProfileFieldView = {
    key,
    displayState: resolved.displayState,
    displayValue: resolved.displayState === "VISIBLE" ? raw!.label : resolved.displayValue,
  };
  if (resolved.displayState === "VISIBLE") {
    view.value = raw!.value;
  }
  if (canView && confidence) {
    view.confidence = confidence as ProfileFieldView["confidence"];
  }
  return view;
}

/**
 * Date tronquée au jour (UTC) — l'horodatage servi aux lecteurs SANS accès.
 * À la minute, « mis à jour » croisé avec la clôture d'une mission dirait
 * quel renseignement vient d'entrer dans un dossier scellé.
 */
export function dayOf(date: Date): string {
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Champs résumés sur une carte de la liste : grade, classe, faction, yeux. */
export const PREVIEW_FIELD_KEYS = ["rank", "ninjaClass", "faction", "eyeColor"] as const;
export type PreviewFieldKey = (typeof PREVIEW_FIELD_KEYS)[number];

/** Ce que la liste charge pour produire l'aperçu d'une carte. */
export const previewSelect = {
  ninjaClass: { select: { label: true } },
  rank: { select: { label: true } },
  faction: { select: { name: true } },
  eyeColor: { select: { label: true, colorHex: true } },
  eyeColorSecondary: { select: { label: true, colorHex: true } },
  fieldIntel: {
    where: { fieldKey: { in: [...PREVIEW_FIELD_KEYS] } },
    select: { fieldKey: true, knowledgeState: true, confidence: true },
  },
} satisfies Prisma.CharacterProfileSelect;

type PreviewRecord = Prisma.CharacterProfileGetPayload<{ select: typeof previewSelect }>;

/**
 * Aperçu d'un dossier pour sa carte : les MÊMES règles que le dossier complet
 * (`buildFieldView`). Sans accès, chaque champ n'est qu'un état — « ??? » ou
 * « Inconnu » — sans valeur ni identifiant.
 */
export function serializePreview(
  profile: PreviewRecord,
  canView: boolean,
): Record<PreviewFieldKey, ProfileFieldView> {
  const intelByKey = new Map(profile.fieldIntel.map((row) => [row.fieldKey, row]));
  const raw: Record<PreviewFieldKey, { value: unknown; label: string } | null> = {
    rank: profile.rank ? { value: profile.rank.label, label: profile.rank.label } : null,
    ninjaClass: profile.ninjaClass
      ? { value: profile.ninjaClass.label, label: profile.ninjaClass.label }
      : null,
    faction: profile.faction ? { value: profile.faction.name, label: profile.faction.name } : null,
    eyeColor: profile.eyeColor
      ? {
          value: {
            primary: { colorHex: profile.eyeColor.colorHex },
            secondary: profile.eyeColorSecondary ? { colorHex: profile.eyeColorSecondary.colorHex } : null,
          },
          label: profile.eyeColorSecondary
            ? `${profile.eyeColor.label} / ${profile.eyeColorSecondary.label}`
            : profile.eyeColor.label,
        }
      : null,
  };
  const out = {} as Record<PreviewFieldKey, ProfileFieldView>;
  for (const key of PREVIEW_FIELD_KEYS) {
    const intel = intelByKey.get(key);
    out[key] = buildFieldView(
      key,
      intel?.knowledgeState as ProfileKnowledge | undefined,
      raw[key],
      canView,
      intel?.confidence,
    );
  }
  return out;
}

/**
 * Sérialise un dossier pour UN lecteur. GARANTIE : lorsque le lecteur n'est
 * pas autorisé, aucune valeur réelle n'apparaît dans l'objet retourné —
 * seulement « Inconnu » ou « ??? » calculés.
 */
export function serializeDossier(
  profile: DossierRecord,
  viewer: ProfileViewer,
  canView: boolean,
  rpConfig: RpTimeConfig,
  now = new Date(),
): SerializedDossier {
  const intelByKey = new Map(profile.fieldIntel.map((row) => [row.fieldKey, row]));

  const traitsByField = new Map<ProfileFieldKey, OptionValue[]>();
  for (const [fieldKey, refType] of Object.entries(TRAIT_FIELD_TO_TYPE)) {
    traitsByField.set(
      fieldKey as ProfileFieldKey,
      profile.traits
        .filter((t) => t.option.type === refType)
        .sort((a, b) => a.option.sortOrder - b.option.sortOrder)
        .map((t) => optionValue(t.option)),
    );
  }

  /** Valeur réelle d'un champ (uniquement consultée si le lecteur est autorisé). */
  const rawValue = (key: ProfileFieldKey): { value: unknown; label: string } | null => {
    switch (key) {
      case "lastName":
        return profile.characterLastName
          ? { value: profile.characterLastName, label: profile.characterLastName }
          : null;
      case "sex":
        return profile.sexCode
          ? { value: profile.sexCode, label: PROFILE_SEX_LABELS[profile.sexCode] ?? profile.sexCode }
          : null;
      case "height": {
        const label = formatHeight(profile.heightMinCm, profile.heightMaxCm);
        return label
          ? { value: { minCm: profile.heightMinCm, maxCm: profile.heightMaxCm }, label }
          : null;
      }
      case "hairColor":
        return profile.hairColor
          ? { value: optionValue(profile.hairColor), label: profile.hairColor.label }
          : null;
      case "skinTone":
        return profile.skinTone
          ? { value: optionValue(profile.skinTone), label: profile.skinTone.label }
          : null;
      case "eyeColor": {
        // Hétérochromie : deux iris, un seul champ. « Bleu / Vert » se lit
        // d'un coup d'œil ; la structure garde les deux pour l'éditeur.
        if (!profile.eyeColor) return null;
        const secondary = profile.eyeColorSecondary;
        return {
          value: {
            primary: optionValue(profile.eyeColor),
            secondary: secondary ? optionValue(secondary) : null,
          },
          label: secondary ? `${profile.eyeColor.label} / ${secondary.label}` : profile.eyeColor.label,
        };
      }
      case "ninjaClass":
        return profile.ninjaClass
          ? { value: optionValue(profile.ninjaClass), label: profile.ninjaClass.label }
          : null;
      case "faction":
        return profile.faction
          ? { value: { id: profile.faction.id, name: profile.faction.name }, label: profile.faction.name }
          : null;
      case "rank":
        return profile.rank ? { value: profile.rank.id, label: profile.rank.label } : null;
      case "lifeStatus":
        return profile.lifeStatus
          ? { value: profile.lifeStatus, label: LIFE_STATUS_LABELS[profile.lifeStatus] ?? profile.lifeStatus }
          : null;
      case "age": {
        const age = computeCharacterAge(profile, now, rpConfig);
        const label = formatCharacterAge(age);
        return label ? { value: age, label } : null;
      }
      case "clans":
      case "chakraNatures":
      case "kekkeiGenkai":
      case "clanTechniques":
      case "signatureTechniques":
      case "combatStyles":
      case "kenjutsuStyles":
      case "artifacts": {
        const options = traitsByField.get(key) ?? [];
        return options.length > 0
          ? { value: options, label: options.map((o) => o.label).join(", ") }
          : null;
      }
      case "techniques":
        return profile.techniques.length > 0
          ? {
              value: profile.techniques.map((technique) => ({
                id: technique.id,
                name: technique.name,
                shortDescription: technique.shortDescription,
                typeLabel: technique.jutsuType?.label ?? null,
                rank: technique.rank,
                // Une technique « rumeur » ne se lit pas comme une technique
                // confirmée : la confiance est stockée, elle doit s'afficher.
                confidence: technique.confidence,
                knowledgeState: technique.knowledgeState,
              })),
              label: profile.techniques.map((t) => t.name).join(", "),
            }
          : null;
      case "details":
        return profile.details ? { value: profile.details, label: profile.details } : null;
      case "strengths":
        return profile.strengths ? { value: profile.strengths, label: profile.strengths } : null;
      case "weaknesses":
        return profile.weaknesses ? { value: profile.weaknesses, label: profile.weaknesses } : null;
      case "image":
        // Galerie OU ancien portrait : l'un comme l'autre vaut « portrait connu »
        return profile.images.length > 0 || profile.imageMime
          ? { value: true, label: "Portrait disponible" }
          : null;
      default:
        return null;
    }
  };

  const buildField = (key: ProfileFieldKey): ProfileFieldView => {
    const intel = intelByKey.get(key);
    return buildFieldView(
      key,
      intel?.knowledgeState as ProfileKnowledge | undefined,
      rawValue(key),
      canView,
      intel?.confidence,
    );
  };

  const fields = {} as Record<ProfileFieldKey, ProfileFieldView>;
  for (const key of Object.keys(PROFILE_FIELD_LABELS) as ProfileFieldKey[]) {
    fields[key] = buildField(key);
  }
  // L'image n'expose JAMAIS de contenu ici : la route /api/profils/[id]/image
  // revérifie les droits avant de servir le portrait.
  const image = fields.image;
  if (image.displayState === "VISIBLE") {
    image.value = true;
  }

  // Galerie : la FORME du résultat porte la confidentialité. Sans accès, il
  // n'y a pas de tableau — donc pas de nombre, pas d'identifiant, pas de
  // légende. « REDACTED » dit seulement que la Toile détient des images.
  let gallery: ProfileGalleryView;
  if (profile.images.length === 0) {
    gallery = { state: "EMPTY" };
  } else if (!canView) {
    gallery = { state: "REDACTED" };
  } else {
    gallery = {
      state: "VISIBLE",
      images: profile.images.map((img) => ({
        id: img.id,
        type: img.type as ProfileImageType,
        typeLabel: PROFILE_IMAGE_TYPE_LABELS[img.type as ProfileImageType] ?? img.type,
        caption: img.caption,
        isPrimary: img.isPrimary,
        sortOrder: img.sortOrder,
        sizeBytes: img.sizeBytes,
        createdAt: img.createdAt.toISOString(),
        sourceMissionCode: img.sourceMission?.code ?? null,
      })),
    };
  }

  return {
    id: profile.id,
    code: profile.code || formatProfileCode(profile.codeNumber),
    firstName: profile.characterFirstName,
    canViewValues: canView,
    archived: profile.archivedAt != null,
    updatedAt: canView ? profile.updatedAt.toISOString() : dayOf(profile.updatedAt),
    image,
    gallery,
    fields,
  };
}
