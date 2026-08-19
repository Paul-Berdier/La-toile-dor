import "server-only";
import type { Prisma } from "@toile/database";
import {
  CONTRIBUTION_VALUE_SCHEMAS,
  LIFE_STATUS_LABELS,
  LIST_FIELD_KEYS,
  PROFILE_FIELD_LABELS,
  PROFILE_SEX_LABELS,
  SINGLE_OPTION_FIELD_TYPE,
  TRAIT_FIELD_TO_TYPE,
  canDeclareNoneForField,
  formatHeight,
  type ProfileFieldKey,
} from "@toile/shared";

/**
 * Service des contributions : transformer une valeur PROPOSÉE (JSON validé
 * par `CONTRIBUTION_VALUE_SCHEMAS`) en libellé lisible, la comparer à ce qui
 * est en place, et l'ÉCRIRE dans le dossier — au sein d'une transaction.
 *
 * Ce fichier est le seul endroit qui sait écrire un champ à partir d'une
 * contribution. L'action de contribution et la revue de modération l'appellent
 * toutes deux : un champ ajouté aux dossiers doit être traité ICI, sinon la
 * contribution est acceptée… et rien ne s'écrit.
 */

type Tx = Prisma.TransactionClient;

interface Labeled {
  label: string;
}

/** Libellé lisible d'une valeur proposée — pour la revue, jamais pour le contributeur sans accès. */
export async function describeContributionValue(
  tx: Tx,
  fieldKey: ProfileFieldKey,
  value: unknown,
): Promise<string> {
  const optionLabels = async (ids: string[]) => {
    const rows = await tx.profileReferenceOption.findMany({
      where: { id: { in: ids } },
      select: { id: true, label: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.label]));
    return ids.map((id) => byId.get(id) ?? "?");
  };
  switch (fieldKey) {
    case "lastName":
    case "details":
    case "strengths":
    case "weaknesses":
      return String(value);
    case "sex":
      return PROFILE_SEX_LABELS[String(value)] ?? String(value);
    case "lifeStatus":
      return LIFE_STATUS_LABELS[String(value)] ?? String(value);
    case "height": {
      const h = value as { minCm: number | null; maxCm: number | null };
      return formatHeight(h.minCm, h.maxCm) ?? "";
    }
    case "age": {
      const a = value as { mode: string; years?: number | null; min?: number | null; max?: number | null };
      return a.mode === "AGE_AT_REFERENCE" ? `${a.years} ans` : `${a.min}–${a.max} ans`;
    }
    case "hairColor":
    case "skinTone":
    case "ninjaClass":
      return (await optionLabels([String(value)]))[0] ?? "?";
    case "eyeColor": {
      const e = value as { primaryId: string; secondaryId?: string | null };
      const labels = await optionLabels([e.primaryId, ...(e.secondaryId ? [e.secondaryId] : [])]);
      return labels.join(" / ");
    }
    case "faction": {
      const f = await tx.faction.findUnique({ where: { id: String(value) }, select: { name: true } });
      return f?.name ?? "?";
    }
    case "rank": {
      const r = await tx.playerLevel.findUnique({ where: { id: String(value) }, select: { label: true } });
      return r?.label ?? "?";
    }
    case "techniques":
      return (value as { name: string }[]).map((t) => t.name).join(", ");
    default:
      if (LIST_FIELD_KEYS.includes(fieldKey)) return (await optionLabels(value as string[])).join(", ");
      return String(value);
  }
}

/**
 * La valeur en place diffère-t-elle de la proposition ? Ne compare que si le
 * champ est CONNU : proposer une valeur à un champ inconnu n'est pas un
 * conflit, c'est un apport. Le résultat ne quitte jamais le serveur vers le
 * contributeur.
 */
export async function contributionConflicts(
  tx: Tx,
  profileId: string,
  fieldKey: ProfileFieldKey,
  proposedLabel: string,
  /** La proposition déclare « vérifié : il n'y en a pas » */
  proposesNone = false,
): Promise<boolean> {
  const intel = await tx.characterFieldIntel.findUnique({
    where: { profileId_fieldKey: { profileId, fieldKey } },
    select: { knowledgeState: true },
  });
  const profile = await tx.characterProfile.findUnique({
    where: { id: profileId },
    include: {
      hairColor: true, skinTone: true, eyeColor: true, eyeColorSecondary: true, ninjaClass: true,
      faction: { select: { name: true } }, rank: { select: { label: true } },
      traits: { include: { option: { select: { type: true, label: true, id: true } } } },
      techniques: { select: { name: true } },
    },
  });
  if (!profile) return false;

  const currentLabel = ((): string | null => {
    switch (fieldKey) {
      case "lastName": return profile.characterLastName;
      case "sex": return profile.sexCode ? (PROFILE_SEX_LABELS[profile.sexCode] ?? profile.sexCode) : null;
      case "lifeStatus": return profile.lifeStatus ? (LIFE_STATUS_LABELS[profile.lifeStatus] ?? profile.lifeStatus) : null;
      case "height": return formatHeight(profile.heightMinCm, profile.heightMaxCm);
      case "hairColor": return profile.hairColor?.label ?? null;
      case "skinTone": return profile.skinTone?.label ?? null;
      case "ninjaClass": return profile.ninjaClass?.label ?? null;
      case "eyeColor":
        return profile.eyeColor
          ? [profile.eyeColor.label, profile.eyeColorSecondary?.label].filter(Boolean).join(" / ")
          : null;
      case "faction": return profile.faction?.name ?? null;
      case "rank": return profile.rank?.label ?? null;
      case "age":
        return profile.ageMode === "AGE_AT_REFERENCE" && profile.ageYearsAtRef != null
          ? `${profile.ageYearsAtRef} ans`
          : profile.ageMode === "AGE_RANGE_AT_REFERENCE"
            ? `${profile.ageMinAtRef}–${profile.ageMaxAtRef} ans`
            : null;
      case "details": return profile.details;
      case "strengths": return profile.strengths;
      case "weaknesses": return profile.weaknesses;
      case "techniques": return profile.techniques.length ? profile.techniques.map((t) => t.name).join(", ") : null;
      default: {
        const refType = TRAIT_FIELD_TO_TYPE[fieldKey];
        if (!refType) return null;
        const labels = profile.traits.filter((t) => t.option.type === refType).map((t) => t.option.label);
        return labels.length ? labels.join(", ") : null;
      }
    }
  })();

  const known = (intel?.knowledgeState ?? (currentLabel ? "KNOWN" : "UNKNOWN")) === "KNOWN";
  if (!known || !currentLabel) return false;

  // « Il n'y en a pas » alors que la Toile en connaît : c'est LA contradiction
  // à signaler — l'accepter effacerait ce qui est en place (listes comprises).
  if (proposesNone) return true;

  // Listes et techniques : jamais de conflit — une contribution AJOUTE, elle
  // ne retire rien, donc deux listes différentes se complètent. Seules les
  // valeurs uniques (un nom, une faction, un texte) peuvent se contredire.
  if (LIST_FIELD_KEYS.includes(fieldKey)) return false;
  return currentLabel.trim() !== proposedLabel.trim();
}

/**
 * Les identifiants de référentiel d'une contribution doivent désigner des
 * options ACTIVES du BON type : sans cela, une contribution pourrait écrire un
 * clan dans la couleur des cheveux, ou une option inexistante (erreur 500 à
 * l'écriture). Lance une Error lisible si ce n'est pas le cas.
 */
export async function assertContributionOptions(
  tx: Tx,
  fieldKey: ProfileFieldKey,
  value: unknown,
): Promise<void> {
  const expectOptions = async (ids: string[], type: string) => {
    if (ids.length === 0) return;
    const count = await tx.profileReferenceOption.count({
      where: { id: { in: ids }, type, isActive: true },
    });
    if (count !== new Set(ids).size) {
      throw new Error(`Option de référentiel invalide pour ${PROFILE_FIELD_LABELS[fieldKey]}.`);
    }
  };
  const single = SINGLE_OPTION_FIELD_TYPE[fieldKey];
  if (single) {
    if (fieldKey === "eyeColor") {
      const e = value as { primaryId: string; secondaryId?: string | null };
      await expectOptions([e.primaryId, ...(e.secondaryId ? [e.secondaryId] : [])], single);
    } else {
      await expectOptions([String(value)], single);
    }
    return;
  }
  const refType = TRAIT_FIELD_TO_TYPE[fieldKey];
  if (refType) {
    await expectOptions(value as string[], refType);
    return;
  }
  if (fieldKey === "faction") {
    const f = await tx.faction.count({ where: { id: String(value), isActive: true } });
    if (f !== 1) throw new Error("Faction inconnue.");
  }
  if (fieldKey === "rank") {
    const r = await tx.playerLevel.count({ where: { id: String(value) } });
    if (r !== 1) throw new Error("Grade inconnu.");
  }
  if (fieldKey === "techniques") {
    const ids = (value as { jutsuTypeId?: string | null }[])
      .map((t) => t.jutsuTypeId)
      .filter((id): id is string => Boolean(id));
    await expectOptions(ids, "JUTSU_TYPE");
  }
}

export interface ApplyContext {
  actorId: string;
  sourceMissionId?: string | null;
  confidence?: "RUMOR" | "UNCONFIRMED" | "PROBABLE" | "CONFIRMED" | null;
  justification?: string | null;
}

/**
 * Écrit la valeur d'une contribution dans le dossier. `mode` :
 *  - "REPLACE" : la proposition devient la valeur (textes écrasés, listes
 *    enrichies — on ne retire jamais un trait sur contribution) ;
 *  - "MERGE"   : textes concaténés, listes enrichies ;
 *  - "NONE_CONFIRMED" : le champ est déclaré vérifié-absent (valeur vidée).
 * Met à jour CharacterFieldIntel et laisse une révision — comme le formulaire.
 */
export async function applyContributionValue(
  tx: Tx,
  profileId: string,
  fieldKey: ProfileFieldKey,
  value: unknown,
  mode: "REPLACE" | "MERGE" | "NONE_CONFIRMED",
  ctx: ApplyContext,
): Promise<void> {
  const profile = await tx.characterProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { traits: { include: { option: { select: { type: true } } } } },
  });
  const data: Prisma.CharacterProfileUncheckedUpdateInput = {
    updatedById: ctx.actorId,
    version: { increment: 1 },
  };
  let oldValue: unknown = null;
  let newValue: unknown = value;
  const now = new Date();

  if (mode === "NONE_CONFIRMED") {
    if (!canDeclareNoneForField(fieldKey)) {
      throw new Error(`Le champ ${PROFILE_FIELD_LABELS[fieldKey]} ne se déclare pas « absent ».`);
    }
    const refType = TRAIT_FIELD_TO_TYPE[fieldKey];
    if (refType) {
      oldValue = profile.traits
        .filter((trait) => trait.option.type === refType)
        .map((trait) => trait.optionId);
      await tx.characterProfileTrait.deleteMany({ where: { profileId, option: { type: refType } } });
    } else {
      switch (fieldKey) {
        case "lastName": oldValue = profile.characterLastName; data.characterLastName = null; break;
        case "sex": oldValue = profile.sexCode; data.sexCode = null; break;
        case "height": {
          oldValue = { min: profile.heightMinCm, max: profile.heightMaxCm };
          data.heightMinCm = null;
          data.heightMaxCm = null;
          break;
        }
        case "hairColor": oldValue = profile.hairColorId; data.hairColorId = null; break;
        case "skinTone": oldValue = profile.skinToneId; data.skinToneId = null; break;
        case "eyeColor": {
          oldValue = { primary: profile.eyeColorId, secondary: profile.eyeColorSecondaryId };
          data.eyeColorId = null;
          data.eyeColorSecondaryId = null;
          break;
        }
        case "ninjaClass": oldValue = profile.ninjaClassId; data.ninjaClassId = null; break;
        case "faction": oldValue = profile.factionId; data.factionId = null; break;
        case "rank": oldValue = profile.rankId; data.rankId = null; break;
        case "lifeStatus": oldValue = profile.lifeStatus; data.lifeStatus = null; break;
        case "details": oldValue = profile.details; data.details = null; break;
        case "strengths": oldValue = profile.strengths; data.strengths = null; break;
        case "weaknesses": oldValue = profile.weaknesses; data.weaknesses = null; break;
        default:
          throw new Error(`Le champ ${PROFILE_FIELD_LABELS[fieldKey]} ne peut pas être vidé par une contribution.`);
      }
    }
    newValue = { noneConfirmed: true };
  } else {
    const refType = TRAIT_FIELD_TO_TYPE[fieldKey];
    if (refType) {
      // Liste de référentiel : on AJOUTE, on ne retire jamais sur contribution
      const ids = value as string[];
      oldValue = profile.traits.filter((t) => t.option.type === refType).map((t) => t.optionId);
      for (const optionId of ids) {
        await tx.characterProfileTrait.upsert({
          where: { profileId_optionId: { profileId, optionId } },
          update: {},
          create: { profileId, optionId, addedById: ctx.actorId },
        });
      }
    } else {
      switch (fieldKey) {
        case "lastName": oldValue = profile.characterLastName; data.characterLastName = String(value); break;
        case "sex": oldValue = profile.sexCode; data.sexCode = value as never; break;
        case "height": {
          const h = value as { minCm: number | null; maxCm: number | null };
          oldValue = { min: profile.heightMinCm, max: profile.heightMaxCm };
          data.heightMinCm = h.minCm; data.heightMaxCm = h.maxCm;
          break;
        }
        case "hairColor": oldValue = profile.hairColorId; data.hairColorId = String(value); break;
        case "skinTone": oldValue = profile.skinToneId; data.skinToneId = String(value); break;
        case "eyeColor": {
          const e = value as { primaryId: string; secondaryId?: string | null };
          oldValue = { primary: profile.eyeColorId, secondary: profile.eyeColorSecondaryId };
          data.eyeColorId = e.primaryId; data.eyeColorSecondaryId = e.secondaryId ?? null;
          break;
        }
        case "ninjaClass": oldValue = profile.ninjaClassId; data.ninjaClassId = String(value); break;
        case "faction": oldValue = profile.factionId; data.factionId = String(value); break;
        case "rank": oldValue = profile.rankId; data.rankId = String(value); break;
        case "lifeStatus": {
          oldValue = profile.lifeStatus;
          const status = value as "ALIVE" | "DEAD" | "MISSING";
          data.lifeStatus = status;
          data.statusChangedRealAt = now;
          if (status === "DEAD") data.deathRealAt = profile.deathRealAt ?? now;
          if (status === "MISSING") data.missingSinceRealAt = profile.missingSinceRealAt ?? now;
          break;
        }
        case "age": {
          const a = value as { mode: string; years?: number | null; min?: number | null; max?: number | null };
          oldValue = { mode: profile.ageMode, years: profile.ageYearsAtRef, min: profile.ageMinAtRef, max: profile.ageMaxAtRef };
          data.ageMode = a.mode as never;
          data.ageReferenceRealAt = now;
          if (a.mode === "AGE_AT_REFERENCE") { data.ageYearsAtRef = a.years ?? null; data.ageMinAtRef = null; data.ageMaxAtRef = null; }
          else { data.ageMinAtRef = a.min ?? null; data.ageMaxAtRef = a.max ?? null; data.ageYearsAtRef = null; }
          break;
        }
        case "details":
        case "strengths":
        case "weaknesses": {
          const current = profile[fieldKey] ?? "";
          oldValue = current || null;
          const incoming = String(value).trim();
          data[fieldKey] =
            mode === "MERGE" && current.trim() && current.trim() !== incoming
              ? `${current.trim()}\n\n— Complément :\n${incoming}`
              : incoming;
          break;
        }
        case "techniques": {
          const list = value as { name: string; shortDescription?: string; jutsuTypeId?: string | null; rank?: string | null }[];
          const existing = await tx.characterSignatureTechnique.findMany({
            where: { profileId }, select: { name: true },
          });
          const known = new Set(existing.map((t) => t.name.trim().toLowerCase()));
          oldValue = existing.map((t) => t.name);
          for (const t of list) {
            if (known.has(t.name.trim().toLowerCase())) continue;
            await tx.characterSignatureTechnique.create({
              data: {
                profileId,
                name: t.name.trim(),
                shortDescription: t.shortDescription?.trim() || null,
                jutsuTypeId: t.jutsuTypeId ?? null,
                rank: (t.rank as never) ?? null,
                confidence: ctx.confidence ?? null,
                sourceMissionId: ctx.sourceMissionId ?? null,
                createdById: ctx.actorId,
              },
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  await tx.characterProfile.update({ where: { id: profileId }, data });
  await tx.characterFieldIntel.upsert({
    where: { profileId_fieldKey: { profileId, fieldKey } },
    update: {
      knowledgeState: mode === "NONE_CONFIRMED" ? "NONE_CONFIRMED" : "KNOWN",
      // Une absence vérifiée remplace entièrement l'information précédente :
      // aucune provenance, confiance ou observation de l'ancienne valeur ne
      // doit survivre si la nouvelle assertion n'en fournit pas.
      confidence: mode === "NONE_CONFIRMED" ? (ctx.confidence ?? null) : (ctx.confidence ?? undefined),
      sourceMissionId: mode === "NONE_CONFIRMED" ? (ctx.sourceMissionId ?? null) : (ctx.sourceMissionId ?? undefined),
      ...(mode === "NONE_CONFIRMED" ? { sourceNote: null, observedAtRp: null } : {}),
      updatedById: ctx.actorId,
    },
    create: {
      profileId,
      fieldKey,
      knowledgeState: mode === "NONE_CONFIRMED" ? "NONE_CONFIRMED" : "KNOWN",
      confidence: ctx.confidence ?? null,
      sourceMissionId: ctx.sourceMissionId ?? null,
      updatedById: ctx.actorId,
    },
  });
  await tx.characterProfileRevision.create({
    data: {
      profileId,
      fieldKey,
      oldValue: (oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (newValue ?? undefined) as Prisma.InputJsonValue | undefined,
      changedById: ctx.actorId,
      sourceMissionId: ctx.sourceMissionId ?? null,
      confidence: ctx.confidence ?? null,
      justification: ctx.justification ?? null,
    },
  });
}

/** Le champ accepte-t-il une contribution ? (image → galerie, etc.) */
export function isContributableField(fieldKey: string): fieldKey is ProfileFieldKey {
  return Object.prototype.hasOwnProperty.call(CONTRIBUTION_VALUE_SCHEMAS, fieldKey);
}
