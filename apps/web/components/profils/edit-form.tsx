"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfileAction } from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

export interface RefOption {
  id: string;
  label: string;
  category: string | null;
  colorHex: string | null;
  sourceScopeLabel: string;
}

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
  ["", "Inconnu"],
  ["MALE", "Masculin"],
  ["FEMALE", "Féminin"],
  ["OTHER", "Autre"],
] as const;
const LIFE_OPTIONS = [
  ["", "Inconnu"],
  ["ALIVE", "Vivant"],
  ["DEAD", "Mort"],
  ["MISSING", "Disparu"],
] as const;

const input = "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/** Sélecteur multiple à cases (tags), avec indication de provenance. */
function MultiSelect({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string;
  options: RefOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  return (
    <fieldset>
      <legend className={label}>{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => toggle(option.id)}
            aria-pressed={selected.includes(option.id)}
            title={option.sourceScopeLabel}
            className={`flex items-center gap-1 border px-2 py-1 text-[0.7rem] transition-colors ${
              selected.includes(option.id)
                ? "border-gold bg-gold-faint/40 text-gold"
                : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
            }`}
          >
            {option.colorHex && (
              <span aria-hidden className="inline-block h-2.5 w-2.5 border border-border-strong" style={{ background: option.colorHex }} />
            )}
            {option.label}
            <span className="text-[0.55rem] text-ink-faint">{option.sourceScopeLabel}</span>
          </button>
        ))}
      </div>
    </fieldset>
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
  refs,
  sourceMissionId,
}: {
  initial: EditFormData;
  refs: Refs;
  sourceMissionId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<EditFormData>(initial);
  const [confidence, setConfidence] = useState("PROBABLE");
  const [justification, setJustification] = useState("");
  const [observedAtRp, setObservedAtRp] = useState("");
  const [conflicts, setConflicts] = useState<{ fieldKey: string; fieldLabel: string; currentValue: string; newValue: string }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof EditFormData>(key: K, value: EditFormData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  const showKenjutsu = data.combatStyleIds.some(
    (id) => refs.combatStyles.find((c) => c.id === id)?.label === "Kenjutsu",
  );

  const save = (conflictStrategy?: string) => {
    if (isPending) return;
    startTransition(async () => {
      const res = await updateProfileAction({
        profileId: data.profileId,
        sourceMissionId: sourceMissionId ?? null,
        confidence,
        justification: justification || undefined,
        observedAtRp: observedAtRp || undefined,
        conflictStrategy,
        firstName: data.firstName,
        lastName: data.lastName || null,
        sexCode: data.sexCode || null,
        heightMinCm: data.heightMinCm,
        heightMaxCm: data.heightMaxCm,
        hairColorId: data.hairColorId || null,
        skinToneId: data.skinToneId || null,
        factionId: data.factionId || null,
        rankId: data.rankId || null,
        lifeStatus: data.lifeStatus || null,
        ageMode: data.ageMode as never,
        ageYearsNow: data.ageYearsNow,
        ageMinNow: data.ageMinNow,
        ageMaxNow: data.ageMaxNow,
        clanIds: data.clanIds,
        chakraNatureIds: data.chakraNatureIds,
        kekkeiGenkaiIds: data.kekkeiGenkaiIds,
        combatStyleIds: data.combatStyleIds,
        kenjutsuStyleIds: showKenjutsu ? data.kenjutsuStyleIds : [],
        artifactIds: data.artifactIds,
        details: data.details || null,
        strengths: data.strengths || null,
        weaknesses: data.weaknesses || null,
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
      {/* Sections */}
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Sections">
        {SECTIONS.map((title, i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-2 py-1.5 text-left text-xs transition-colors lg:whitespace-normal ${
                i === step ? "border-l-2 border-gold text-gold" : "border-l-2 border-transparent text-ink-faint hover:text-ink"
              }`}
            >
              <span className="font-mono-toile">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => e.preventDefault()} className="border border-border-default bg-raised p-5" noValidate>
        <h2 className="mb-4 font-display text-sm tracking-widest text-gold uppercase">
          {SECTIONS[step]}
        </h2>

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="ef-first" className={label}>Prénom *</label>
              <input id="ef-first" value={data.firstName} onChange={(e) => set("firstName", e.target.value)} className={input} maxLength={80} />
            </div>
            <div>
              <label htmlFor="ef-last" className={label}>Nom (facultatif)</label>
              <input id="ef-last" value={data.lastName} onChange={(e) => set("lastName", e.target.value)} className={input} maxLength={80} />
            </div>
            <div>
              <label htmlFor="ef-sex" className={label}>Sexe</label>
              <select id="ef-sex" value={data.sexCode} onChange={(e) => set("sexCode", e.target.value)} className={input}>
                {SEX_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ef-life" className={label}>État</label>
              <select id="ef-life" value={data.lifeStatus} onChange={(e) => set("lifeStatus", e.target.value)} className={input}>
                {LIFE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {/* Âge — suit le temps RP à partir de valeurs observées aujourd'hui */}
            <fieldset className="border border-border-default p-3">
              <legend className={label}>Âge (progresse avec le temps RP)</legend>
              <select value={data.ageMode} onChange={(e) => set("ageMode", e.target.value)} className={input}>
                <option value="UNKNOWN">Inconnu</option>
                <option value="AGE_AT_REFERENCE">Âge connu aujourd&rsquo;hui</option>
                <option value="AGE_RANGE_AT_REFERENCE">Fourchette d&rsquo;âge</option>
              </select>
              {data.ageMode === "AGE_AT_REFERENCE" && (
                <input type="number" min={0} max={500} value={data.ageYearsNow ?? ""} placeholder="Âge en années"
                  aria-label="Âge actuel" onChange={(e) => set("ageYearsNow", e.target.value ? Number(e.target.value) : null)}
                  className={`${input} mt-2`} />
              )}
              {data.ageMode === "AGE_RANGE_AT_REFERENCE" && (
                <div className="mt-2 flex items-center gap-2">
                  <input type="number" min={0} value={data.ageMinNow ?? ""} placeholder="min" aria-label="Âge minimum"
                    onChange={(e) => set("ageMinNow", e.target.value ? Number(e.target.value) : null)} className={input} />
                  <span aria-hidden className="text-ink-faint">–</span>
                  <input type="number" min={0} value={data.ageMaxNow ?? ""} placeholder="max" aria-label="Âge maximum"
                    onChange={(e) => set("ageMaxNow", e.target.value ? Number(e.target.value) : null)} className={input} />
                </div>
              )}
            </fieldset>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <fieldset>
              <legend className={label}>Taille (cm) — plage possible</legend>
              <div className="flex items-center gap-2">
                <input type="number" min={30} max={400} value={data.heightMinCm ?? ""} placeholder="min" aria-label="Taille minimum"
                  onChange={(e) => set("heightMinCm", e.target.value ? Number(e.target.value) : null)} className={input} />
                <span aria-hidden className="text-ink-faint">–</span>
                <input type="number" min={30} max={400} value={data.heightMaxCm ?? ""} placeholder="max" aria-label="Taille maximum"
                  onChange={(e) => set("heightMaxCm", e.target.value ? Number(e.target.value) : null)} className={input} />
              </div>
            </fieldset>
            <div>
              <label htmlFor="ef-hair" className={label}>Couleur des cheveux</label>
              <select id="ef-hair" value={data.hairColorId} onChange={(e) => set("hairColorId", e.target.value)} className={input}>
                <option value="">Inconnu</option>
                {refs.hairColors.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ef-skin" className={label}>Couleur de peau</label>
              <select id="ef-skin" value={data.skinToneId} onChange={(e) => set("skinToneId", e.target.value)} className={input}>
                <option value="">Inconnu</option>
                {refs.skinTones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <p className="text-[0.65rem] text-ink-faint">
              Le portrait se téléverse depuis la page du dossier.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="ef-faction" className={label}>Faction</label>
              <select id="ef-faction" value={data.factionId} onChange={(e) => set("factionId", e.target.value)} className={input}>
                <option value="">Inconnu</option>
                {refs.factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ef-rank" className={label}>Grade</label>
              <select id="ef-rank" value={data.rankId} onChange={(e) => set("rankId", e.target.value)} className={input}>
                <option value="">Inconnu</option>
                {refs.ranks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <MultiSelect legend="Clan(s) et famille(s)" options={refs.clans} selected={data.clanIds} onChange={(ids) => set("clanIds", ids)} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <MultiSelect legend="Natures de chakra" options={refs.chakraNatures} selected={data.chakraNatureIds} onChange={(ids) => set("chakraNatureIds", ids)} />
            <MultiSelect legend="Kekkei Genkai" options={refs.kekkeiGenkai} selected={data.kekkeiGenkaiIds} onChange={(ids) => set("kekkeiGenkaiIds", ids)} />
            <MultiSelect legend="Artefacts légendaires" options={refs.artifacts} selected={data.artifactIds} onChange={(ids) => set("artifactIds", ids)} />
            <p className="text-[0.65rem] text-ink-faint">
              Les Subjutsu (techniques propres) s&rsquo;ajoutent depuis la page du dossier.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <MultiSelect legend="Styles de combat" options={refs.combatStyles} selected={data.combatStyleIds} onChange={(ids) => set("combatStyleIds", ids)} />
            {showKenjutsu && (
              <MultiSelect legend="Spécialités Kenjutsu" options={refs.kenjutsuStyles} selected={data.kenjutsuStyleIds} onChange={(ids) => set("kenjutsuStyleIds", ids)} />
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            {(["details", "strengths", "weaknesses"] as const).map((key) => (
              <div key={key}>
                <label htmlFor={`ef-${key}`} className={label}>
                  {key === "details" ? "Détails" : key === "strengths" ? "Forces" : "Faiblesses"}
                </label>
                <textarea id={`ef-${key}`} value={data[key]} onChange={(e) => set(key, e.target.value)} rows={4} maxLength={10_000} className={input} />
                <p className="mt-0.5 text-right text-[0.6rem] text-ink-faint">{data[key].length} / 10000</p>
              </div>
            ))}
            <div>
              <label htmlFor="ef-notes" className={label}>Notes internes (jamais vendues avec le dossier)</label>
              <textarea id="ef-notes" value={data.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} rows={3} maxLength={10_000} className={input} />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ef-conf" className={label}>Niveau de confiance</label>
                <select id="ef-conf" value={confidence} onChange={(e) => setConfidence(e.target.value)} className={input}>
                  <option value="RUMOR">Rumeur</option>
                  <option value="UNCONFIRMED">Non confirmé</option>
                  <option value="PROBABLE">Probable</option>
                  <option value="CONFIRMED">Confirmé</option>
                </select>
              </div>
              <div>
                <label htmlFor="ef-obs" className={label}>Date RP d&rsquo;observation (libre)</label>
                <input id="ef-obs" value={observedAtRp} onChange={(e) => setObservedAtRp(e.target.value)} maxLength={120} className={input} placeholder="ex. 12e jour du mois de la Brume, an 42" />
              </div>
            </div>
            <div>
              <label htmlFor="ef-just" className={label}>Justification / source</label>
              <textarea id="ef-just" value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} maxLength={2000} className={input} />
            </div>
            {sourceMissionId && (
              <p className="border border-gold-dim bg-gold-faint/20 px-3 py-2 text-xs text-gold">
                Ce lot de renseignements sera rattaché à la mission d&rsquo;origine.
              </p>
            )}
            <PermissionPreview data={data} refs={refs} />
          </div>
        )}

        {/* Conflits détectés */}
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
    </div>
  );
}

/** Aperçu des trois vues (modérateur / groupe acheteur / groupe sans accès). */
function PermissionPreview({ data, refs }: { data: EditFormData; refs: Refs }) {
  const rows = useMemo(() => {
    const labelOf = (list: RefOption[], ids: string[]) =>
      ids.map((id) => list.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
    return [
      ["Nom", data.lastName],
      ["Faction", refs.factions.find((f) => f.id === data.factionId)?.name ?? ""],
      ["Clan", labelOf(refs.clans, data.clanIds)],
      ["Cheveux", refs.hairColors.find((o) => o.id === data.hairColorId)?.label ?? ""],
      ["Kekkei Genkai", labelOf(refs.kekkeiGenkai, data.kekkeiGenkaiIds)],
    ] as const;
  }, [data, refs]);

  const Col = ({ title, reveal }: { title: string; reveal: boolean }) => (
    <div className="border border-border-default bg-elevated p-3">
      <p className="mb-1 font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">{title}</p>
      <dl className="space-y-0.5 text-[0.7rem]">
        {rows.map(([field, value]) => (
          <div key={field} className="flex justify-between gap-2">
            <dt className="text-ink-faint">{field}</dt>
            <dd className="text-ink-muted">
              {value ? (reveal ? value : "???") : <span className="italic text-ink-faint">Inconnu</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div>
      <p className={label}>Aperçu selon le lecteur</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Col title="Modérateur" reveal />
        <Col title="Groupe ayant acheté" reveal />
        <Col title="Groupe sans accès" reveal={false} />
      </div>
    </div>
  );
}
