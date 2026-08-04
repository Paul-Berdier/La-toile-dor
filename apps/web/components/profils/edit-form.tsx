"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PROFILE_FIELD_LABELS, type ProfileFieldKey } from "@toile/shared";
import { updateProfileAction, suggestReferenceAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";
import { ReferencePicker } from "./reference-picker";

export interface RefOption {
  id: string;
  label: string;
  category: string | null;
  colorHex: string | null;
  sourceScopeLabel: string;
  aliases?: string[];
  kanji?: string | null;
}

/** État de connaissance choisi par le modérateur, champ par champ. */
export type KnowledgeChoice = "UNKNOWN" | "KNOWN" | "NONE_CONFIRMED" | "CONFLICTING";

export interface EditFormData {
  profileId: string;
  firstName: string;
  lastName: string;
  sexCode: string;
  heightMinCm: number | null;
  heightMaxCm: number | null;
  hairColorId: string;
  skinToneId: string;
  factionId: string;
  rankId: string;
  lifeStatus: string;
  ageMode: string;
  ageYearsNow: number | null;
  ageMinNow: number | null;
  ageMaxNow: number | null;
  clanIds: string[];
  chakraNatureIds: string[];
  kekkeiGenkaiIds: string[];
  combatStyleIds: string[];
  kenjutsuStyleIds: string[];
  artifactIds: string[];
  details: string;
  strengths: string;
  weaknesses: string;
  internalNotes: string;
  /** État actuel de chaque champ (issu de CharacterFieldIntel) */
  fieldStates: Partial<Record<ProfileFieldKey, KnowledgeChoice>>;
}

interface Refs {
  hairColors: RefOption[];
  skinTones: RefOption[];
  clans: RefOption[];
  chakraNatures: RefOption[];
  kekkeiGenkai: RefOption[];
  combatStyles: RefOption[];
  kenjutsuStyles: RefOption[];
  artifacts: RefOption[];
  factions: { id: string; name: string }[];
  ranks: { id: string; label: string }[];
  jutsuTypes: RefOption[];
}

const SEX_OPTIONS = [
  ["MALE", "Masculin"],
  ["FEMALE", "Féminin"],
  ["OTHER", "Autre"],
] as const;
const LIFE_OPTIONS = [
  ["ALIVE", "Vivant"],
  ["DEAD", "Mort"],
  ["MISSING", "Disparu"],
] as const;

const KNOWLEDGE_CHOICES: { value: KnowledgeChoice; label: string; hint: string }[] = [
  { value: "UNKNOWN", label: "Inconnu", hint: "La Toile ne possède pas cette information" },
  { value: "KNOWN", label: "Valeur connue", hint: "Renseignement acquis" },
  { value: "NONE_CONFIRMED", label: "Absence confirmée", hint: "Vérifié : il n'y en a pas" },
  { value: "CONFLICTING", label: "Contradictoire", hint: "Renseignements incompatibles" },
];

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const labelCls = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * Encadre un champ avec son état de connaissance.
 *
 * La saisie reste ACCESSIBLE tant que le champ n'est pas déclaré « absent » ou
 * « contradictoire » : exiger de basculer l'état avant de pouvoir écrire
 * donnait l'impression que le champ n'existait pas (couleur des cheveux, de
 * peau…). Renseigner une valeur suffit désormais à passer en « connu ».
 * Seuls « Absence confirmée » et « Contradictoire » masquent la saisie — dans
 * ces deux cas, il n'y a effectivement rien à écrire.
 */
function KnowledgeField({
  fieldKey,
  state,
  onStateChange,
  children,
}: {
  fieldKey: ProfileFieldKey;
  state: KnowledgeChoice;
  onStateChange: (state: KnowledgeChoice) => void;
  children: React.ReactNode;
}) {
  const selectId = `state-${fieldKey}`;
  return (
    <div className="border border-border-default/70 bg-elevated/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-ink-faint">
          {PROFILE_FIELD_LABELS[fieldKey]}
        </span>
        <label htmlFor={selectId} className="sr-only">
          État du renseignement — {PROFILE_FIELD_LABELS[fieldKey]}
        </label>
        <select
          id={selectId}
          value={state}
          onChange={(e) => onStateChange(e.target.value as KnowledgeChoice)}
          title={KNOWLEDGE_CHOICES.find((c) => c.value === state)?.hint}
          className={`border bg-elevated px-2 py-1 text-[0.7rem] ${
            state === "KNOWN"
              ? "border-gold-dim text-gold"
              : state === "UNKNOWN"
                ? "border-border-default text-ink-faint"
                : state === "CONFLICTING"
                  ? "border-blood/60 text-blood-bright"
                  : "border-border-strong text-ink-muted"
          }`}
        >
          {KNOWLEDGE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      {state === "KNOWN" || state === "UNKNOWN" ? (
        <>
          {children}
          {state === "UNKNOWN" && (
            <p className="mt-1 text-[0.65rem] text-ink-faint italic">
              Rien de saisi : la Toile affichera « Inconnu ». Renseignez ce champ
              pour le déclarer acquis.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-ink-faint italic">
          {KNOWLEDGE_CHOICES.find((c) => c.value === state)?.hint}.
        </p>
      )}
    </div>
  );
}

const SECTIONS = [
  "Identité",
  "Apparence",
  "Affiliation",
  "Capacités",
  "Combat",
  "Analyse",
  "Source & aperçu",
] as const;

export function ProfileEditForm({
  initial,
  refs: initialRefs,
  sourceMissionId,
  canManageReferences = false,
}: {
  initial: EditFormData;
  refs: Refs;
  sourceMissionId?: string;
  /** Autorise l'ajout d'entrées de référentiel sans passer par une validation */
  canManageReferences?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<EditFormData>(initial);
  // Les référentiels vivent côté client : une entrée créée depuis un
  // sélecteur doit apparaître sans recharger la page.
  const [refs, setRefs] = useState<Refs>(initialRefs);

  type RefListKey = {
    [K in keyof Refs]: Refs[K] extends RefOption[] ? K : never;
  }[keyof Refs];

  const addOption = (list: RefListKey, option: RefOption) =>
    setRefs((r) => (r[list].some((o) => o.id === option.id) ? r : { ...r, [list]: [...r[list], option] }));
  const [confidence, setConfidence] = useState("PROBABLE");
  const [justification, setJustification] = useState("");
  const [observedAtRp, setObservedAtRp] = useState("");
  const [conflicts, setConflicts] = useState<
    { fieldKey: string; fieldLabel: string; currentValue: string; newValue: string }[]
  >([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [suggestion, setSuggestion] = useState<{ type: string; label: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof EditFormData>(key: K, value: EditFormData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  const stateOf = (key: ProfileFieldKey): KnowledgeChoice => data.fieldStates[key] ?? "UNKNOWN";
  const setState = (key: ProfileFieldKey, state: KnowledgeChoice) =>
    setData((d) => ({ ...d, fieldStates: { ...d.fieldStates, [key]: state } }));

  const isFilled = (value: unknown) =>
    Array.isArray(value) ? value.length > 0 : value !== "" && value != null;

  /**
   * Saisir une valeur vaut déclaration : le champ passe de lui-même en
   * « connu ». Un état déjà choisi explicitement (absence, contradiction)
   * n'est jamais écrasé — seul « Inconnu » est promu.
   */
  const setValue = <K extends keyof EditFormData>(
    fieldKey: ProfileFieldKey,
    key: K,
    value: EditFormData[K],
  ) =>
    setData((d) => ({
      ...d,
      [key]: value,
      fieldStates:
        isFilled(value) && (d.fieldStates[fieldKey] ?? "UNKNOWN") === "UNKNOWN"
          ? { ...d.fieldStates, [fieldKey]: "KNOWN" as KnowledgeChoice }
          : d.fieldStates,
    }));

  const showKenjutsu =
    stateOf("combatStyles") === "KNOWN" &&
    data.combatStyleIds.some((id) => refs.combatStyles.find((c) => c.id === id)?.label === "Kenjutsu");

  const save = (conflictStrategy?: string) => {
    if (isPending) return;
    startTransition(async () => {
      // Un champ dont l'état n'est pas « connu » n'envoie aucune valeur :
      // le serveur nettoie alors la donnée correspondante.
      const known = (key: ProfileFieldKey) => stateOf(key) === "KNOWN";
      const res = await updateProfileAction({
        profileId: data.profileId,
        sourceMissionId: sourceMissionId ?? null,
        confidence,
        justification: justification || undefined,
        observedAtRp: observedAtRp || undefined,
        conflictStrategy,
        fieldStates: data.fieldStates,
        firstName: data.firstName,
        lastName: known("lastName") ? data.lastName || null : null,
        sexCode: known("sex") ? data.sexCode || null : null,
        heightMinCm: known("height") ? data.heightMinCm : null,
        heightMaxCm: known("height") ? data.heightMaxCm : null,
        hairColorId: known("hairColor") ? data.hairColorId || null : null,
        skinToneId: known("skinTone") ? data.skinToneId || null : null,
        factionId: known("faction") ? data.factionId || null : null,
        rankId: known("rank") ? data.rankId || null : null,
        lifeStatus: known("lifeStatus") ? data.lifeStatus || null : null,
        ageMode: known("age") ? (data.ageMode as never) : "UNKNOWN",
        ageYearsNow: known("age") ? data.ageYearsNow : null,
        ageMinNow: known("age") ? data.ageMinNow : null,
        ageMaxNow: known("age") ? data.ageMaxNow : null,
        clanIds: known("clans") ? data.clanIds : [],
        chakraNatureIds: known("chakraNatures") ? data.chakraNatureIds : [],
        kekkeiGenkaiIds: known("kekkeiGenkai") ? data.kekkeiGenkaiIds : [],
        combatStyleIds: known("combatStyles") ? data.combatStyleIds : [],
        kenjutsuStyleIds: showKenjutsu ? data.kenjutsuStyleIds : [],
        artifactIds: known("artifacts") ? data.artifactIds : [],
        details: known("details") ? data.details || null : null,
        strengths: known("strengths") ? data.strengths || null : null,
        weaknesses: known("weaknesses") ? data.weaknesses || null : null,
        internalNotes: data.internalNotes || null,
      });
      if (!res.ok) {
        if (res.conflicts) {
          setConflicts(res.conflicts);
          setError(null);
        } else {
          setError(res.error ?? "L'enregistrement a échoué.");
        }
        return;
      }
      setConflicts([]);
      setWarnings(res.warnings ?? []);
      setError(null);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[12rem_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Sections">
        {SECTIONS.map((title, i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-2 py-1.5 text-left text-xs transition-colors lg:whitespace-normal ${
                i === step
                  ? "border-l-2 border-gold text-gold"
                  : "border-l-2 border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              <span className="font-mono-toile">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => e.preventDefault()} className="border border-border-default bg-raised p-5" noValidate>
        <h2 className="mb-1 font-display text-sm tracking-widest text-gold uppercase">
          {SECTIONS[step]}
        </h2>
        <p className="mb-4 text-[0.7rem] text-ink-faint">
          Chaque champ porte son état : ce que la Toile ignore reste « Inconnu »,
          ce qu&rsquo;elle a vérifié absent devient « Aucun ».
        </p>

        {step === 0 && (
          <div className="space-y-3">
            <div>
              <label htmlFor="ef-first" className={labelCls}>Prénom * (toujours visible)</label>
              <input id="ef-first" value={data.firstName} onChange={(e) => set("firstName", e.target.value)} className={input} maxLength={80} />
            </div>

            <KnowledgeField fieldKey="lastName" state={stateOf("lastName")} onStateChange={(s) => setState("lastName", s)}>
              <input aria-label="Nom du personnage" value={data.lastName} onChange={(e) => setValue("lastName", "lastName", e.target.value)} className={input} maxLength={80} />
            </KnowledgeField>

            <KnowledgeField fieldKey="sex" state={stateOf("sex")} onStateChange={(s) => setState("sex", s)}>
              <select aria-label="Sexe" value={data.sexCode} onChange={(e) => setValue("sex", "sexCode", e.target.value)} className={input}>
                <option value="">— choisir —</option>
                {SEX_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </KnowledgeField>

            <KnowledgeField fieldKey="lifeStatus" state={stateOf("lifeStatus")} onStateChange={(s) => setState("lifeStatus", s)}>
              <select aria-label="État vital" value={data.lifeStatus} onChange={(e) => setValue("lifeStatus", "lifeStatus", e.target.value)} className={input}>
                <option value="">— choisir —</option>
                {LIFE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </KnowledgeField>

            <KnowledgeField fieldKey="age" state={stateOf("age")} onStateChange={(s) => setState("age", s)}>
              <div className="space-y-2">
                <select aria-label="Mode de calcul de l'âge" value={data.ageMode} onChange={(e) => set("ageMode", e.target.value)} className={input}>
                  <option value="UNKNOWN">— choisir —</option>
                  <option value="AGE_AT_REFERENCE">Âge connu aujourd&rsquo;hui</option>
                  <option value="AGE_RANGE_AT_REFERENCE">Fourchette d&rsquo;âge</option>
                </select>
                {data.ageMode === "AGE_AT_REFERENCE" && (
                  <input type="number" min={0} max={500} value={data.ageYearsNow ?? ""} placeholder="Âge en années"
                    aria-label="Âge actuel" onChange={(e) => setValue("age", "ageYearsNow", e.target.value ? Number(e.target.value) : null)} className={input} />
                )}
                {data.ageMode === "AGE_RANGE_AT_REFERENCE" && (
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} value={data.ageMinNow ?? ""} placeholder="min" aria-label="Âge minimum"
                      onChange={(e) => setValue("age", "ageMinNow", e.target.value ? Number(e.target.value) : null)} className={input} />
                    <span aria-hidden className="text-ink-faint">–</span>
                    <input type="number" min={0} value={data.ageMaxNow ?? ""} placeholder="max" aria-label="Âge maximum"
                      onChange={(e) => setValue("age", "ageMaxNow", e.target.value ? Number(e.target.value) : null)} className={input} />
                  </div>
                )}
                <p className="text-[0.65rem] text-ink-faint">
                  L&rsquo;âge saisi progressera seul avec le temps RP.
                </p>
              </div>
            </KnowledgeField>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <KnowledgeField fieldKey="height" state={stateOf("height")} onStateChange={(s) => setState("height", s)}>
              <div className="flex items-center gap-2">
                <input type="number" min={30} max={400} value={data.heightMinCm ?? ""} placeholder="min" aria-label="Taille minimum"
                  onChange={(e) => setValue("height", "heightMinCm", e.target.value ? Number(e.target.value) : null)} className={input} />
                <span aria-hidden className="text-ink-faint">–</span>
                <input type="number" min={30} max={400} value={data.heightMaxCm ?? ""} placeholder="max" aria-label="Taille maximum"
                  onChange={(e) => setValue("height", "heightMaxCm", e.target.value ? Number(e.target.value) : null)} className={input} />
              </div>
            </KnowledgeField>

            <KnowledgeField fieldKey="hairColor" state={stateOf("hairColor")} onStateChange={(s) => setState("hairColor", s)}>
              <ReferencePicker
                legend="Couleur des cheveux" hideLegend
                options={refs.hairColors}
                selected={data.hairColorId ? [data.hairColorId] : []}
                onChange={(ids) => setValue("hairColor", "hairColorId", ids[ids.length - 1] ?? "")}
                onSuggest={(label) => setSuggestion({ type: "HAIR_COLOR", label })}
                referenceType="HAIR_COLOR"
                canCreate={canManageReferences}
                onCreated={(o) => addOption("hairColors", o)}
              />
            </KnowledgeField>

            <KnowledgeField fieldKey="skinTone" state={stateOf("skinTone")} onStateChange={(s) => setState("skinTone", s)}>
              <ReferencePicker
                legend="Couleur de peau" hideLegend
                options={refs.skinTones}
                selected={data.skinToneId ? [data.skinToneId] : []}
                onChange={(ids) => setValue("skinTone", "skinToneId", ids[ids.length - 1] ?? "")}
                onSuggest={(label) => setSuggestion({ type: "SKIN_TONE", label })}
                referenceType="SKIN_TONE"
                canCreate={canManageReferences}
                onCreated={(o) => addOption("skinTones", o)}
              />
            </KnowledgeField>

            <p className="text-[0.65rem] text-ink-faint">
              Le portrait se téléverse depuis la page du dossier.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <KnowledgeField fieldKey="faction" state={stateOf("faction")} onStateChange={(s) => setState("faction", s)}>
              <select aria-label="Faction" value={data.factionId} onChange={(e) => setValue("faction", "factionId", e.target.value)} className={input}>
                <option value="">— choisir —</option>
                {refs.factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </KnowledgeField>

            <KnowledgeField fieldKey="rank" state={stateOf("rank")} onStateChange={(s) => setState("rank", s)}>
              <select aria-label="Grade" value={data.rankId} onChange={(e) => setValue("rank", "rankId", e.target.value)} className={input}>
                <option value="">— choisir —</option>
                {refs.ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </KnowledgeField>

            <KnowledgeField fieldKey="clans" state={stateOf("clans")} onStateChange={(s) => setState("clans", s)}>
              <ReferencePicker
                legend="Clan(s) et famille(s)" hideLegend
                options={refs.clans}
                selected={data.clanIds}
                onChange={(ids) => setValue("clans", "clanIds", ids)}
                onSuggest={(label) => setSuggestion({ type: "CLAN_FAMILY", label })}
                referenceType="CLAN_FAMILY"
                canCreate={canManageReferences}
                onCreated={(o) => addOption("clans", o)}
              />
            </KnowledgeField>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <KnowledgeField fieldKey="chakraNatures" state={stateOf("chakraNatures")} onStateChange={(s) => setState("chakraNatures", s)}>
              <ReferencePicker legend="Natures de chakra" hideLegend options={refs.chakraNatures}
                selected={data.chakraNatureIds} onChange={(ids) => setValue("chakraNatures", "chakraNatureIds", ids)}
                onSuggest={(label) => setSuggestion({ type: "CHAKRA_NATURE", label })}
                referenceType="CHAKRA_NATURE" canCreate={canManageReferences}
                onCreated={(o) => addOption("chakraNatures", o)} />
            </KnowledgeField>
            <KnowledgeField fieldKey="kekkeiGenkai" state={stateOf("kekkeiGenkai")} onStateChange={(s) => setState("kekkeiGenkai", s)}>
              <ReferencePicker legend="Kekkei Genkai" hideLegend options={refs.kekkeiGenkai}
                selected={data.kekkeiGenkaiIds} onChange={(ids) => setValue("kekkeiGenkai", "kekkeiGenkaiIds", ids)}
                onSuggest={(label) => setSuggestion({ type: "KEKKEI_GENKAI", label })}
                referenceType="KEKKEI_GENKAI" canCreate={canManageReferences}
                onCreated={(o) => addOption("kekkeiGenkai", o)} />
            </KnowledgeField>
            <KnowledgeField fieldKey="artifacts" state={stateOf("artifacts")} onStateChange={(s) => setState("artifacts", s)}>
              <ReferencePicker legend="Artefacts légendaires" hideLegend options={refs.artifacts}
                selected={data.artifactIds} onChange={(ids) => setValue("artifacts", "artifactIds", ids)}
                onSuggest={(label) => setSuggestion({ type: "LEGENDARY_ARTIFACT", label })}
                referenceType="LEGENDARY_ARTIFACT" canCreate={canManageReferences}
                onCreated={(o) => addOption("artifacts", o)} />
            </KnowledgeField>
            <p className="text-[0.65rem] text-ink-faint">
              Les Subjutsu (techniques propres) s&rsquo;ajoutent depuis la page du dossier.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <KnowledgeField fieldKey="combatStyles" state={stateOf("combatStyles")} onStateChange={(s) => setState("combatStyles", s)}>
              <ReferencePicker legend="Styles de combat" hideLegend options={refs.combatStyles}
                selected={data.combatStyleIds} onChange={(ids) => setValue("combatStyles", "combatStyleIds", ids)}
                onSuggest={(label) => setSuggestion({ type: "COMBAT_STYLE", label })}
                referenceType="COMBAT_STYLE" canCreate={canManageReferences}
                onCreated={(o) => addOption("combatStyles", o)} />
            </KnowledgeField>
            {/* Les sous-styles n'apparaissent que si Kenjutsu est retenu */}
            {showKenjutsu && (
              <KnowledgeField fieldKey="kenjutsuStyles" state={stateOf("kenjutsuStyles")} onStateChange={(s) => setState("kenjutsuStyles", s)}>
                <ReferencePicker legend="Spécialités Kenjutsu" hideLegend options={refs.kenjutsuStyles}
                  selected={data.kenjutsuStyleIds} onChange={(ids) => setValue("kenjutsuStyles", "kenjutsuStyleIds", ids)}
                  onSuggest={(label) => setSuggestion({ type: "KENJUTSU_STYLE", label })}
                  referenceType="KENJUTSU_STYLE" canCreate={canManageReferences}
                  onCreated={(o) => addOption("kenjutsuStyles", o)} />
              </KnowledgeField>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            {(["details", "strengths", "weaknesses"] as const).map((key) => (
              <KnowledgeField key={key} fieldKey={key} state={stateOf(key)} onStateChange={(s) => setState(key, s)}>
                <>
                  <textarea aria-label={PROFILE_FIELD_LABELS[key]} value={data[key]}
                    onChange={(e) => setValue(key, key, e.target.value)} rows={4} maxLength={10_000} className={input} />
                  <p className="mt-0.5 text-right text-[0.6rem] text-ink-faint">{data[key].length} / 10000</p>
                </>
              </KnowledgeField>
            ))}
            <div className="border border-copper/40 bg-elevated/40 p-3">
              <label htmlFor="ef-notes" className={labelCls}>
                Notes internes (jamais vendues avec le dossier)
              </label>
              <textarea id="ef-notes" value={data.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} rows={3} maxLength={10_000} className={input} />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ef-conf" className={labelCls}>Niveau de confiance</label>
                <select id="ef-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={input}>
                  <option value="RUMOR">Rumeur</option>
                  <option value="UNCONFIRMED">Non confirmé</option>
                  <option value="PROBABLE">Probable</option>
                  <option value="CONFIRMED">Confirmé</option>
                </select>
              </div>
              <div>
                <label htmlFor="ef-obs" className={labelCls}>Date RP d&rsquo;observation (libre)</label>
                <input id="ef-obs" value={observedAtRp} onChange={(e) => setObservedAtRp(e.target.value)} maxLength={120} className={input} placeholder="ex. 12e jour du mois de la Brume, an 42" />
              </div>
            </div>
            <div>
              <label htmlFor="ef-just" className={labelCls}>Justification / source</label>
              <textarea id="ef-just" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} maxLength={2000} className={input} />
            </div>
            {sourceMissionId && (
              <p className="border border-gold-dim bg-gold-faint/20 px-3 py-2 text-xs text-gold">
                Ce lot de renseignements sera rattaché à la mission d&rsquo;origine.
              </p>
            )}
            <PermissionPreview data={data} refs={refs} stateOf={stateOf} />
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="mt-4 border border-blood/50 bg-blood/10 p-4">
            <p className="text-sm text-blood-bright">
              La nouvelle information contredit une valeur enregistrée.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-ink-muted">
              {conflicts.map((c) => (
                <li key={c.fieldKey}>
                  <strong>{c.fieldLabel}</strong> — actuel : « {c.currentValue || "?"} » → nouveau : « {c.newValue || "vide"} »
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="gold" onClick={() => save("REPLACE")} disabled={isPending}>Remplacer</Button>
              <Button size="sm" variant="outline" onClick={() => save("KEEP")} disabled={isPending}>Conserver l&rsquo;ancienne</Button>
              <Button size="sm" variant="seal" onClick={() => save("MARK_CONFLICTING")} disabled={isPending}>Marquer contradictoire</Button>
              <Button size="sm" variant="ghost" onClick={() => setConflicts([])} disabled={isPending}>Annuler</Button>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="mt-4 space-y-1 border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
            {warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-4 border border-blood bg-blood/10 px-3 py-2 text-sm text-blood-bright">{error}</p>
        )}
        {saved && conflicts.length === 0 && (
          <p role="status" className="mt-4 text-xs text-success">Dossier enregistré.</p>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-border-default pt-4">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>← Précédent</Button>
            {step < SECTIONS.length - 1 && (
              <Button variant="outline" onClick={() => setStep((s) => Math.min(SECTIONS.length - 1, s + 1))}>Suivant →</Button>
            )}
          </div>
          {conflicts.length === 0 && (
            <Button variant="gold" onClick={() => save()} disabled={isPending || data.firstName.trim().length === 0}>
              {isPending ? "Enregistrement…" : "Enregistrer le dossier"}
            </Button>
          )}
        </div>
      </form>

      {suggestion && (
        <SuggestionModal
          type={suggestion.type}
          initialLabel={suggestion.label}
          onClose={() => setSuggestion(null)}
        />
      )}
    </div>
  );
}

/** Proposition d'une entrée absente d'un référentiel (validée par un super-mod). */
function SuggestionModal({
  type,
  initialLabel,
  onClose,
}: {
  type: string;
  initialLabel: string;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [scope, setScope] = useState("SERVER_CUSTOM");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await suggestReferenceAction({
        type,
        proposedLabel: label,
        description: description || undefined,
        sourceUrl: sourceUrl || "",
        sourceScope: scope as never,
        reason: reason || undefined,
      });
      if (!res.ok) setError(res.error ?? "Échec de la proposition.");
      else { setError(null); setDone(true); }
    });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Proposer une nouvelle entrée"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-obsidian/80 px-4">
      <div className="w-full max-w-md border border-border-gold bg-raised p-5 shadow-modal">
        <h2 className="font-display text-base tracking-widest text-gold uppercase">
          Proposer une entrée
        </h2>
        {done ? (
          <>
            <p className="mt-3 text-sm text-ink-muted">
              Proposition transmise. Un super-modérateur l&rsquo;examinera avant qu&rsquo;elle
              rejoigne le référentiel.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="gold" onClick={onClose}>Fermer</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-faint">
              Les entrées officielles sont validées : cela évite les variantes
              (Uchiha / UCHIWA / Uchïha).
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="sg-label" className={labelCls}>Libellé *</label>
                <input id="sg-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={input} />
              </div>
              <div>
                <label htmlFor="sg-scope" className={labelCls}>Provenance</label>
                <select id="sg-scope" value={scope} onChange={(e) => setScope(e.target.value)} className={input}>
                  <option value="MANGA_CANON">Manga</option>
                  <option value="ANIME">Anime</option>
                  <option value="FILM">Film</option>
                  <option value="GAME">Jeu</option>
                  <option value="SERVER_CUSTOM">Création du serveur</option>
                </select>
              </div>
              <div>
                <label htmlFor="sg-url" className={labelCls}>Lien source (facultatif)</label>
                <input id="sg-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} maxLength={300} className={input} placeholder="https://…" />
              </div>
              <div>
                <label htmlFor="sg-desc" className={labelCls}>Description courte</label>
                <input id="sg-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className={input} />
              </div>
              <div>
                <label htmlFor="sg-reason" className={labelCls}>Motif de la demande</label>
                <input id="sg-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={input} />
              </div>
            </div>
            {error && <p role="alert" className="mt-3 text-xs text-blood-bright">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={isPending}>Annuler</Button>
              <Button variant="gold" onClick={submit} disabled={isPending || label.trim().length === 0}>
                {isPending ? "Envoi…" : "Proposer"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Aperçu des trois vues (modérateur / groupe acheteur / groupe sans accès). */
function PermissionPreview({
  data,
  refs,
  stateOf,
}: {
  data: EditFormData;
  refs: Refs;
  stateOf: (key: ProfileFieldKey) => KnowledgeChoice;
}) {
  const rows = useMemo(() => {
    const labelOf = (list: RefOption[], ids: string[]) =>
      ids.map((id) => list.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
    return [
      ["lastName", "Nom", data.lastName],
      ["faction", "Faction", refs.factions.find((f) => f.id === data.factionId)?.name ?? ""],
      ["clans", "Clan", labelOf(refs.clans, data.clanIds)],
      ["hairColor", "Cheveux", refs.hairColors.find((o) => o.id === data.hairColorId)?.label ?? ""],
      ["kekkeiGenkai", "Kekkei Genkai", labelOf(refs.kekkeiGenkai, data.kekkeiGenkaiIds)],
      ["artifacts", "Artefact", labelOf(refs.artifacts, data.artifactIds)],
    ] as const;
  }, [data, refs]);

  /** Rendu exact des règles Inconnu / ??? / Aucun / Contradictoire. */
  const render = (key: ProfileFieldKey, value: string, reveal: boolean) => {
    const state = stateOf(key);
    if (state === "UNKNOWN") return <span className="italic text-ink-faint">Inconnu</span>;
    if (!reveal) return <span className="font-mono-toile text-gold">???</span>;
    if (state === "NONE_CONFIRMED") return <span className="text-ink-muted">Aucun</span>;
    if (state === "CONFLICTING") return <span className="text-blood-bright">Contradictoire</span>;
    return <span className="text-ink-muted">{value || <span className="italic text-ink-faint">Inconnu</span>}</span>;
  };

  const Col = ({ title, reveal }: { title: string; reveal: boolean }) => (
    <div className="border border-border-default bg-elevated p-3">
      <p className="mb-1 font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">{title}</p>
      <dl className="space-y-0.5 text-[0.7rem]">
        {rows.map(([key, fieldLabel, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-ink-faint">{fieldLabel}</dt>
            <dd>{render(key as ProfileFieldKey, value, reveal)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div>
      <p className={labelCls}>Aperçu selon le lecteur</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Col title="Modérateur" reveal />
        <Col title="Groupe ayant acheté" reveal />
        <Col title="Groupe sans accès" reveal={false} />
      </div>
    </div>
  );
}
