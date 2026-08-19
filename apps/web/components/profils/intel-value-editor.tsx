"use client";

import { PROFILE_FIELD_LABELS, TRAIT_FIELD_TO_TYPE, canDeclareNoneForField, type ProfileFieldKey } from "@toile/shared";
import { ReferencePicker } from "./reference-picker";
import type { RefOption } from "./edit-form";

/** Référentiels nécessaires aux éditeurs de valeur — même forme que `loadProfileRefs()`. */
export interface IntelRefs {
  hairColors: RefOption[];
  skinTones: RefOption[];
  eyeColors: RefOption[];
  ninjaClasses: RefOption[];
  clans: RefOption[];
  chakraNatures: RefOption[];
  kekkeiGenkai: RefOption[];
  clanTechniques: RefOption[];
  combatStyles: RefOption[];
  kenjutsuStyles: RefOption[];
  artifacts: RefOption[];
  jutsuTypes: RefOption[];
  signatureTechniques: RefOption[];
  factions: { id: string; name: string }[];
  ranks: { id: string; label: string }[];
}

const TRAIT_LIST_FOR: Partial<Record<ProfileFieldKey, keyof IntelRefs>> = {
  clans: "clans",
  chakraNatures: "chakraNatures",
  kekkeiGenkai: "kekkeiGenkai",
  clanTechniques: "clanTechniques",
  signatureTechniques: "signatureTechniques",
  combatStyles: "combatStyles",
  kenjutsuStyles: "kenjutsuStyles",
  artifacts: "artifacts",
};

/** Rubriques de la palette de champs — partagée par la contribution et le rapport. */
export const INTEL_PALETTE: { title: string; keys: ProfileFieldKey[] }[] = [
  { title: "Identité", keys: ["lastName", "sex", "age", "lifeStatus", "faction", "clans"] },
  { title: "Signalement", keys: ["height", "hairColor", "skinTone", "eyeColor"] },
  { title: "Capacités", keys: ["rank", "ninjaClass", "chakraNatures", "kekkeiGenkai", "clanTechniques", "signatureTechniques", "techniques", "combatStyles", "kenjutsuStyles", "artifacts"] },
  { title: "Analyse", keys: ["details", "strengths", "weaknesses"] },
];

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";

/**
 * Éditeur de la valeur d'UN champ de dossier, dans la forme attendue par
 * `CONTRIBUTION_VALUE_SCHEMAS`. Ne montre JAMAIS la valeur en place : il
 * sert à proposer, pas à comparer.
 */
export function IntelValueEditor({
  fieldKey,
  value,
  onChange,
  refs,
}: {
  fieldKey: ProfileFieldKey;
  value: unknown;
  onChange: (next: unknown) => void;
  refs: IntelRefs;
}) {
  const traitList = TRAIT_LIST_FOR[fieldKey];
  if (traitList) {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    return (
      <ReferencePicker
        legend={PROFILE_FIELD_LABELS[fieldKey]}
        hideLegend
        options={refs[traitList] as RefOption[]}
        selected={ids}
        onChange={(next) => onChange(next)}
        referenceType={TRAIT_FIELD_TO_TYPE[fieldKey]}
      />
    );
  }
  switch (fieldKey) {
    case "lastName":
      return <input aria-label="Nom" className={input} maxLength={80} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "details":
    case "strengths":
    case "weaknesses":
      return <textarea aria-label={PROFILE_FIELD_LABELS[fieldKey]} className={`${input} min-h-[6rem]`} maxLength={10_000} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "sex":
      return (
        <select aria-label="Sexe" className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— choisir —</option>
          <option value="MALE">Masculin</option>
          <option value="FEMALE">Féminin</option>
          <option value="OTHER">Autre</option>
        </select>
      );
    case "lifeStatus":
      return (
        <select aria-label="État vital" className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— choisir —</option>
          <option value="ALIVE">Vivant</option>
          <option value="DEAD">Mort</option>
          <option value="MISSING">Disparu</option>
        </select>
      );
    case "faction":
      return (
        <select aria-label="Faction" className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— choisir —</option>
          {refs.factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      );
    case "rank":
      return (
        <select aria-label="Grade" className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— choisir —</option>
          {refs.ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      );
    case "ninjaClass":
      return (
        <select aria-label="Classe" className={input} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— choisir —</option>
          {refs.ninjaClasses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      );
    case "hairColor":
    case "skinTone": {
      const list = fieldKey === "hairColor" ? refs.hairColors : refs.skinTones;
      return (
        <ReferencePicker legend={PROFILE_FIELD_LABELS[fieldKey]} hideLegend options={list}
          selected={value ? [value as string] : []} onChange={(ids) => onChange(ids[ids.length - 1])} />
      );
    }
    case "eyeColor": {
      const v = (value as { primaryId?: string; secondaryId?: string | null } | undefined) ?? {};
      return (
        <div className="space-y-2">
          <ReferencePicker legend="Œil 1" options={refs.eyeColors}
            selected={v.primaryId ? [v.primaryId] : []}
            onChange={(ids) => onChange({ ...v, primaryId: ids[ids.length - 1] })} />
          <ReferencePicker legend="Œil 2 (hétérochromie, facultatif)"
            options={refs.eyeColors.filter((o) => o.id !== v.primaryId)}
            selected={v.secondaryId ? [v.secondaryId] : []}
            onChange={(ids) => onChange({ ...v, secondaryId: ids[ids.length - 1] ?? null })} />
        </div>
      );
    }
    case "height": {
      const v = (value as { minCm?: number | null; maxCm?: number | null } | undefined) ?? {};
      return (
        <div className="flex items-center gap-2">
          <input type="number" min={30} max={400} placeholder="min (cm)" aria-label="Taille minimum" className={input}
            value={v.minCm ?? ""} onChange={(e) => onChange({ minCm: e.target.value ? Number(e.target.value) : null, maxCm: v.maxCm ?? null })} />
          <span aria-hidden className="text-ink-faint">–</span>
          <input type="number" min={30} max={400} placeholder="max (cm)" aria-label="Taille maximum" className={input}
            value={v.maxCm ?? ""} onChange={(e) => onChange({ minCm: v.minCm ?? null, maxCm: e.target.value ? Number(e.target.value) : null })} />
        </div>
      );
    }
    case "age": {
      const v = (value as { mode?: string; years?: number | null; min?: number | null; max?: number | null } | undefined) ?? { mode: "AGE_AT_REFERENCE" };
      return (
        <div className="space-y-2">
          <select aria-label="Mode" className={input} value={v.mode ?? "AGE_AT_REFERENCE"} onChange={(e) => onChange({ mode: e.target.value })}>
            <option value="AGE_AT_REFERENCE">Âge connu aujourd&rsquo;hui</option>
            <option value="AGE_RANGE_AT_REFERENCE">Fourchette d&rsquo;âge</option>
          </select>
          {v.mode === "AGE_RANGE_AT_REFERENCE" ? (
            <div className="flex items-center gap-2">
              <input type="number" min={0} placeholder="min" aria-label="Âge minimum" className={input} value={v.min ?? ""} onChange={(e) => onChange({ ...v, min: e.target.value ? Number(e.target.value) : null })} />
              <span aria-hidden className="text-ink-faint">–</span>
              <input type="number" min={0} placeholder="max" aria-label="Âge maximum" className={input} value={v.max ?? ""} onChange={(e) => onChange({ ...v, max: e.target.value ? Number(e.target.value) : null })} />
            </div>
          ) : (
            <input type="number" min={0} placeholder="Âge en années" aria-label="Âge" className={input} value={v.years ?? ""} onChange={(e) => onChange({ mode: "AGE_AT_REFERENCE", years: e.target.value ? Number(e.target.value) : null })} />
          )}
        </div>
      );
    }
    case "techniques": {
      const v = (value as { name: string; shortDescription?: string; jutsuTypeId?: string | null; rank?: string | null }[] | undefined) ?? [{ name: "" }];
      const t = v[0]!;
      return (
        <div className="space-y-2">
          <input aria-label="Nom de la technique" className={input} maxLength={120} placeholder="Nom de la technique" value={t.name}
            onChange={(e) => onChange([{ ...t, name: e.target.value }])} />
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label="Type de jutsu" className={input} value={t.jutsuTypeId ?? ""} onChange={(e) => onChange([{ ...t, jutsuTypeId: e.target.value || null }])}>
              <option value="">Type — inconnu</option>
              {refs.jutsuTypes.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
            <select aria-label="Rang" className={input} value={t.rank ?? ""} onChange={(e) => onChange([{ ...t, rank: e.target.value || null }])}>
              <option value="">Rang — inconnu</option>
              {["D", "C", "B", "A", "S", "SS"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <input aria-label="Description courte" className={input} maxLength={1000} placeholder="Description courte (facultative)" value={t.shortDescription ?? ""}
            onChange={(e) => onChange([{ ...t, shortDescription: e.target.value }])} />
        </div>
      );
    }
    default:
      return null;
  }
}

/** Un champ dont l'absence peut être « vérifiée » (pas l'âge ni les techniques). */
export const canDeclareNone = canDeclareNoneForField;
