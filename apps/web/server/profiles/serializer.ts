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
  faction: { select: { id: true, name: true } },
  rank: { select: { id: true, label: true } },
  fieldIntel: true,
  traits: { include: { option: true } },
  techniques: { include: { jutsuType: true }, orderBy: { createdAt: "asc" } },
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
        return profile.imageMime ? { value: true, label: "Portrait disponible" } : null;
      default:
        return null;
    }
  };

  const buildField = (key: ProfileFieldKey): ProfileFieldView => {
    const intel = intelByKey.get(key);
    const raw = rawValue(key);
    // Absence de ligne d'intel : une valeur présente vaut KNOWN, sinon UNKNOWN
    const knowledge: ProfileKnowledge =
      (intel?.knowledgeState as ProfileKnowledge | undefined) ?? (raw ? "KNOWN" : "UNKNOWN");
    // Donnée déclarée connue mais absente (sécurité) → traiter comme inconnue
    const effective: ProfileKnowledge = knowledge === "KNOWN" && !raw ? "UNKNOWN" : knowledge;

    const resolved = resolveFieldDisplay(effective, canView);
    const view: ProfileFieldView = {
      key,
      displayState: resolved.displayState,
      displayValue: resolved.displayState === "VISIBLE" ? raw!.label : resolved.displayValue,
    };
    if (resolved.displayState === "VISIBLE") {
      view.value = raw!.value;
    }
    if (canView && intel?.confidence) {
      view.confidence = intel.confidence;
    }
    return view;
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

  return {
    id: profile.id,
    code: profile.code || formatProfileCode(profile.codeNumber),
    firstName: profile.characterFirstName,
    canViewValues: canView,
    archived: profile.archivedAt != null,
    updatedAt: profile.updatedAt.toISOString(),
    image,
    fields,
  };
}
