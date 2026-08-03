"use client";

import { useState, useTransition } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as Tabs from "@radix-ui/react-tabs";
import {
  missionCreateSchema,
  MISSION_CATEGORIES,
  RANK_ORDER,
  RANK_DEFAULTS,
  ELIGIBILITY_MODE_LABELS,
  formatRyoRange,
  type MissionCreateInput,
  type Rank,
} from "@toile/shared";
import { createMissionAction, updateMissionAction } from "@/server/mission-create";
import { Button } from "@/components/ui/button";
import { RankSeal } from "./rank-seal";

const STEPS = [
  "Informations générales",
  "Classification & rang",
  "Informations publiques",
  "Informations confidentielles",
  "Niveau de la cible",
  "Récompenses",
  "Délais",
  "Critères d'éligibilité",
  "Notifications",
  "Vérification & publication",
] as const;

/** Champs validés à chaque étape (navigation bloquée si invalides). */
const STEP_FIELDS: (keyof MissionCreateInput)[][] = [
  ["publicTitle", "internalTitle"],
  ["category", "rank"],
  ["publicSummary"],
  ["confidentialDescription", "primaryObjective", "targetIdentity", "targetFactionId", "location", "clientName", "constraints", "prohibitions", "evidence"],
  ["targetLevelSlug", "minRecommendedLevelSlug", "groupSizeMin", "groupSizeMax"],
  ["rewardRyoMin", "rewardRyoMax", "basePoints"],
  ["expiresAt", "rpDuration"],
  ["eligibilityMode"],
  ["notifyLeaders", "visibility"],
  [],
];

interface MissionWizardProps {
  levels: { slug: string; label: string }[];
  factions: { id: string; name: string; isActive: boolean }[];
  mode?: "create" | "edit";
  missionId?: string;
  currentStatus?: string;
  initialValues?: MissionCreateInput;
}

export function CreateWizard({
  levels,
  factions,
  mode = "create",
  missionId,
  currentStatus,
  initialValues,
}: MissionWizardProps) {
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<MissionCreateInput>({
    resolver: zodResolver(missionCreateSchema),
    mode: "onBlur",
    defaultValues: initialValues ?? {
      publicTitle: "",
      category: "COLLECTE_INFORMATIONS",
      rank: "D",
      targetFactionId: "",
      secondaryObjectives: [],
      rewardRyoMin: RANK_DEFAULTS.D.rewardRyoMin,
      rewardRyoMax: RANK_DEFAULTS.D.rewardRyoMax,
      basePoints: RANK_DEFAULTS.D.defaultPoints,
      groupSizeMin: 1,
      groupSizeMax: RANK_DEFAULTS.D.recommendedGroupSize,
      eligibilityMode: "WARNING",
      visibility: { showCategory: true, showTargetLevel: true, showSummary: true },
      publish: false,
      notifyLeaders: true,
      rpDuration: null,
      expiresAt: null,
    },
  });

  const { register, watch, setValue, trigger, getValues, formState } = form;
  const values = watch();
  const objectives = useFieldArray({ control: form.control, name: "secondaryObjectives" });

  const applyRankDefaults = (rank: Rank) => {
    const defaults = RANK_DEFAULTS[rank];
    setValue("rank", rank);
    setValue("rewardRyoMin", defaults.rewardRyoMin);
    setValue("rewardRyoMax", defaults.rewardRyoMax);
    setValue("basePoints", defaults.defaultPoints);
    setValue("groupSizeMax", defaults.recommendedGroupSize);
    if (defaults.minLevelSlug) setValue("minRecommendedLevelSlug", defaults.minLevelSlug);
  };

  const nextStep = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    const valid = fields.length === 0 || (await trigger(fields as never[]));
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = (publish: boolean) => {
    setValue("publish", publish);
    startTransition(async () => {
      const result =
        mode === "edit" && missionId
          ? await updateMissionAction({ missionId, values: getValues() })
          : await createMissionAction(getValues());
      // En cas de succès l'action redirige ; on n'arrive ici qu'en erreur
      if (result && !result.ok) {
        setServerError(
          result.error ??
            (mode === "edit" ? "La modification a échoué." : "La création a échoué."),
        );
      }
    });
  };

  const err = (key: keyof MissionCreateInput) =>
    (formState.errors[key]?.message as string | undefined) ?? null;

  const input =
    "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
  const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      {/* Fil d'avancement */}
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Étapes">
        {STEPS.map((title, i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-2 py-1.5 text-left text-xs transition-colors lg:whitespace-normal ${
                i === step
                  ? "border-l-2 border-gold text-gold"
                  : i < step
                    ? "border-l-2 border-gold-dim text-ink-muted hover:text-ink"
                    : "border-l-2 border-transparent text-ink-faint"
              }`}
            >
              <span className="font-mono-toile">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={(e) => e.preventDefault()} className="border border-border-default bg-raised p-5">
        <h2 className="mb-4 font-display text-sm tracking-widest text-gold uppercase">
          {String(step + 1).padStart(2, "0")} · {STEPS[step]}
        </h2>

        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="publicTitle" className={label}>Titre public *</label>
              <input id="publicTitle" {...register("publicTitle")} className={input} placeholder="Ce que le tableau affichera à tous" />
              {err("publicTitle") && <p className="mt-1 text-xs text-blood-bright">{err("publicTitle")}</p>}
            </div>
            <div>
              <label htmlFor="internalTitle" className={label}>Titre interne (modération)</label>
              <input id="internalTitle" {...register("internalTitle")} className={input} />
            </div>
            <div>
              <label htmlFor="moderatorNotes" className={label}>Notes internes</label>
              <textarea id="moderatorNotes" rows={3} {...register("moderatorNotes")} className={input} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <fieldset>
              <legend className={label}>Rang *</legend>
              <div className="flex flex-wrap gap-2">
                {RANK_ORDER.map((rank) => (
                  <button
                    key={rank}
                    type="button"
                    onClick={() => applyRankDefaults(rank)}
                    aria-pressed={values.rank === rank}
                    className={`flex flex-col items-center gap-1 border p-2 transition-colors ${
                      values.rank === rank ? "border-gold bg-hover-bg" : "border-border-default hover:border-border-gold"
                    }`}
                  >
                    <RankSeal rank={rank} size={36} />
                    <span className="font-mono-toile text-[0.6rem] text-ink-faint">
                      {RANK_DEFAULTS[rank].defaultPoints} pts
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                Choisir un rang pré-remplit récompenses, points et effectifs (modifiables).
              </p>
            </fieldset>
            <div>
              <label htmlFor="category" className={label}>Catégorie *</label>
              <select id="category" {...register("category")} className={input}>
                {MISSION_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="publicSummary" className={label}>Résumé public (visible avant attribution)</label>
              <textarea id="publicSummary" rows={4} {...register("publicSummary")} className={input}
                placeholder="Ce que les chefs de groupe liront sur le tableau…" />
            </div>
            <fieldset className="space-y-2">
              <legend className={label}>Visibilité avant attribution</legend>
              {([
                ["showCategory", "Révéler la catégorie"],
                ["showTargetLevel", "Révéler le niveau de la cible"],
                ["showSummary", "Révéler le résumé public"],
              ] as const).map(([key, text]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-ink-muted">
                  <input type="checkbox" {...register(`visibility.${key}`)} className="accent-[var(--toile-gold)]" />
                  {text}
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="border border-blood/40 bg-blood/10 px-3 py-2 text-xs text-blood-bright">
              Ces champs ne quittent jamais le serveur pour un utilisateur non autorisé.
            </p>
            <div>
              <label htmlFor="confidentialDescription" className={label}>Briefing confidentiel</label>
              <textarea id="confidentialDescription" rows={4} {...register("confidentialDescription")} className={input} />
            </div>
            <div>
              <label htmlFor="primaryObjective" className={label}>Objectif principal</label>
              <textarea id="primaryObjective" rows={2} {...register("primaryObjective")} className={input} />
            </div>
            <fieldset>
              <legend className={label}>Objectifs secondaires</legend>
              {objectives.fields.map((field, i) => (
                <div key={field.id} className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    {...register(`secondaryObjectives.${i}.label`)}
                    className={`${input} flex-1`}
                    placeholder="Libellé"
                  />
                  <input
                    type="number"
                    {...register(`secondaryObjectives.${i}.points`, { valueAsNumber: true })}
                    className="w-20 border border-border-default bg-elevated px-2 py-2 text-sm text-ink"
                    placeholder="pts"
                    aria-label="Points"
                  />
                  <label className="flex items-center gap-1 text-xs text-ink-muted">
                    <input type="checkbox" {...register(`secondaryObjectives.${i}.secret`)} className="accent-[var(--toile-blood)]" />
                    secret
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => objectives.remove(i)}>Retirer</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => objectives.append({ label: "", points: 0 })}>
                Ajouter un objectif
              </Button>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="targetIdentity" className={label}>Nom(s) de la ou des cibles</label>
                <textarea id="targetIdentity" rows={2} {...register("targetIdentity")} className={input} />
              </div>
              <div>
                <label htmlFor="targetFactionId" className={label}>Faction de la ou des cibles</label>
                <select id="targetFactionId" {...register("targetFactionId")} className={input}>
                  <option value="">— Aucune / inconnue —</option>
                  {factions.map((faction) => (
                    <option key={faction.id} value={faction.id} disabled={!faction.isActive}>
                      {faction.name}{faction.isActive ? "" : " — inactive"}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-faint">
                  Visible uniquement par les chefs des groupes acceptés et la modération.
                </p>
              </div>
              <div>
                <label htmlFor="location" className={label}>Localisation</label>
                <input id="location" {...register("location")} className={input} />
              </div>
              <div>
                <label htmlFor="clientName" className={label}>Commanditaire</label>
                <input id="clientName" {...register("clientName")} className={input} />
                <p className="mt-1 text-xs text-ink-faint">Visible uniquement par la modération.</p>
              </div>
              <div>
                <label htmlFor="evidence" className={label}>Preuves à rapporter</label>
                <input id="evidence" {...register("evidence")} className={input} />
              </div>
            </div>
            <div>
              <label htmlFor="constraints" className={label}>Contraintes</label>
              <textarea id="constraints" rows={2} {...register("constraints")} className={input} />
            </div>
            <div>
              <label htmlFor="prohibitions" className={label}>Interdictions</label>
              <textarea id="prohibitions" rows={2} {...register("prohibitions")} className={input} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="targetLevelSlug" className={label}>Niveau estimé de la cible</label>
              <select id="targetLevelSlug" {...register("targetLevelSlug")} className={input}>
                <option value="">—</option>
                {levels.map((level) => (
                  <option key={level.slug} value={level.slug}>{level.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="minRecommendedLevelSlug" className={label}>Niveau minimal recommandé</label>
              <select id="minRecommendedLevelSlug" {...register("minRecommendedLevelSlug")} className={input}>
                <option value="">—</option>
                {levels.map((level) => (
                  <option key={level.slug} value={level.slug}>{level.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="groupSizeMin" className={label}>Effectif minimal</label>
              <input id="groupSizeMin" type="number" min={1} max={50}
                {...register("groupSizeMin", { valueAsNumber: true })} className={input} />
            </div>
            <div>
              <label htmlFor="groupSizeMax" className={label}>Effectif maximal</label>
              <input id="groupSizeMax" type="number" min={1} max={50}
                {...register("groupSizeMax", { valueAsNumber: true })} className={input} />
              {err("groupSizeMax") && <p className="mt-1 text-xs text-blood-bright">{err("groupSizeMax")}</p>}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="rewardRyoMin" className={label}>Récompense minimale (ryōs)</label>
              <input id="rewardRyoMin" type="number" min={0} step={1000}
                {...register("rewardRyoMin", { valueAsNumber: true })} className={input} />
            </div>
            <div>
              <label htmlFor="rewardRyoMax" className={label}>Récompense maximale (ryōs)</label>
              <input id="rewardRyoMax" type="number" min={0} step={1000}
                {...register("rewardRyoMax", { valueAsNumber: true })} className={input} />
              {err("rewardRyoMax") && <p className="mt-1 text-xs text-blood-bright">{err("rewardRyoMax")}</p>}
            </div>
            <div>
              <label htmlFor="basePoints" className={label}>Points de base</label>
              <input id="basePoints" type="number" min={0}
                {...register("basePoints", { valueAsNumber: true })} className={input} />
            </div>
            <p className="self-end text-xs text-ink-faint">
              Fourchette indicative du rang {values.rank} :{" "}
              {formatRyoRange(RANK_DEFAULTS[values.rank as Rank].rewardRyoMin, RANK_DEFAULTS[values.rank as Rank].rewardRyoMax)}
            </p>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <div>
              <label htmlFor="expiresAt" className={label}>Date d&rsquo;expiration réelle (UTC)</label>
              <input
                id="expiresAt"
                type="datetime-local"
                className={input}
                value={toLocalDateTime(values.expiresAt)}
                onChange={(e) => {
                  setValue("expiresAt", e.target.value ? new Date(e.target.value).toISOString() : null);
                  if (e.target.value) setValue("rpDuration", null);
                }}
              />
            </div>
            <p className="text-center font-mono-toile text-[0.65rem] text-ink-faint">— ou —</p>
            <fieldset>
              <legend className={label}>Durée en temps RP</legend>
              <div className="flex flex-wrap items-center gap-2">
                {(["years", "months", "weeks"] as const).map((unit) => (
                  <label key={unit} className="flex items-center gap-1.5 text-sm text-ink-muted">
                    <input
                      type="number"
                      min={0}
                      max={unit === "years" ? 100 : unit === "months" ? 12 : 4}
                      value={values.rpDuration?.[unit] ?? 0}
                      onChange={(e) => {
                        const current = values.rpDuration ?? { years: 0, months: 0, weeks: 0 };
                        setValue("rpDuration", { ...current, [unit]: Number(e.target.value) || 0 });
                        setValue("expiresAt", null);
                      }}
                      className="w-20 border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink"
                      aria-label={unit === "years" ? "Années RP" : unit === "months" ? "Mois RP" : "Semaines RP"}
                    />
                    {unit === "years" ? "ans" : unit === "months" ? "mois" : "semaines"} RP
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-faint">
                Rappel : 1 jour réel ≈ 1 mois RP · 1 semaine réelle ≈ 1 année RP. Laisser vide
                pour une mission sans limite de temps.
              </p>
            </fieldset>
          </div>
        )}

        {step === 7 && (
          <fieldset className="space-y-2">
            <legend className={label}>Application des critères (niveau, effectif)</legend>
            {([
              ["RECOMMENDATION", "Critères affichés, aucun signalement ni blocage"],
              ["WARNING", "Revendication acceptée, écarts signalés au tisseur"],
              ["STRICT", "Revendication refusée au moindre écart"],
              ["MANUAL_REVIEW", "Revendication acceptée mais toujours marquée à contrôler"],
            ] as const).map(([value, text]) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink-muted">
                <input type="radio" value={value} {...register("eligibilityMode")} className="mt-1 accent-[var(--toile-gold)]" />
                <span>
                  <strong className="font-medium text-ink">{ELIGIBILITY_MODE_LABELS[value]}</strong>
                  {` — ${text}`}
                </span>
              </label>
            ))}
            <p className="pt-2 text-xs leading-relaxed text-ink-faint">
              L&rsquo;effectif et le niveau sont contrôlés sur les agents nommément
              sélectionnés par le chef dans sa revendication.
            </p>
          </fieldset>
        )}

        {step === 8 && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" {...register("notifyLeaders")} className="accent-[var(--toile-gold)]" />
              {mode === "edit" && currentStatus !== "DRAFT"
                ? "Prévenir automatiquement les groupes concernés"
                : "Prévenir les chefs de groupe à la publication"}
            </label>
            <p className="text-xs text-ink-faint">
              {mode === "edit" && currentStatus !== "DRAFT"
                ? "Seuls les membres des groupes actuellement attribués recevront un écho public de la modification."
                : "Chaque chef reste maître de ses préférences (rangs, catégories, fréquence, période silencieuse)."}
            </p>
          </div>
        )}

        {step === 9 && (
          <div className="space-y-4">
            <Tabs.Root defaultValue="visitor">
              <Tabs.List className="flex flex-wrap gap-1 border-b border-border-default" aria-label="Aperçus par rôle">
                {([
                  ["visitor", "Visiteur"],
                  ["leader", "Chef (avant attribution)"],
                  ["assigned", "Agent attribué"],
                  ["acceptedLeader", "Chef attribué"],
                  ["moderator", "Modérateur"],
                ] as const).map(([value, text]) => (
                  <Tabs.Trigger
                    key={value}
                    value={value}
                    className="border-b-2 border-transparent px-3 py-2 text-xs text-ink-muted data-[state=active]:border-gold data-[state=active]:text-gold"
                  >
                    {text}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="visitor" className="p-4 text-sm text-ink-muted">
                <p className="italic">
                  Un visiteur sans invitation ne voit RIEN : ni cette mission, ni le tableau.
                  Il est renvoyé au seuil de connexion.
                </p>
              </Tabs.Content>
              <Tabs.Content value="leader" className="space-y-1 p-4 text-sm">
                <PreviewRow label="Titre" value={values.publicTitle || "—"} />
                <PreviewRow label="Rang" value={values.rank} />
                <PreviewRow label="Catégorie" value={values.visibility?.showCategory ? (MISSION_CATEGORIES.find((c) => c.value === values.category)?.label ?? "") : "— voilée —"} />
                <PreviewRow label="Résumé" value={values.visibility?.showSummary ? values.publicSummary || "—" : "— voilé —"} />
                <PreviewRow label="Niveau cible" value={values.visibility?.showTargetLevel ? levels.find((l) => l.slug === values.targetLevelSlug)?.label ?? "—" : "— voilé —"} />
                <PreviewRow label="Récompense" value={formatRyoRange(values.rewardRyoMin || 0, values.rewardRyoMax || 0)} />
                <PreviewRow label="Effectif" value={`${values.groupSizeMin} à ${values.groupSizeMax}`} />
                <p className="mt-2 text-xs text-blood-bright">
                  Cibles, faction des cibles, lieu, commanditaire et briefing : jamais transmis à ce niveau.
                </p>
              </Tabs.Content>
              <Tabs.Content value="assigned" className="space-y-1 p-4 text-sm">
                <PreviewRow label="Briefing" value={values.confidentialDescription || "—"} />
                <PreviewRow label="Objectif" value={values.primaryObjective || "—"} />
                <PreviewRow label="Lieu" value={values.location || "—"} />
                <PreviewRow
                  label="Objectifs secondaires"
                  value={`${(values.secondaryObjectives ?? []).filter((o) => !o.secret).length} visibles / ${(values.secondaryObjectives ?? []).length} au total (les « secrets » restent voilés)`}
                />
                <p className="mt-2 text-xs text-blood-bright">
                  Noms et faction des cibles, commanditaire : non transmis aux agents.
                </p>
              </Tabs.Content>
              <Tabs.Content value="acceptedLeader" className="space-y-1 p-4 text-sm">
                <PreviewRow label="Cible(s)" value={values.targetIdentity || "—"} />
                <PreviewRow
                  label="Faction de la cible"
                  value={factions.find((faction) => faction.id === values.targetFactionId)?.name ?? "—"}
                />
                <p className="mt-2 text-xs text-blood-bright">
                  Le commanditaire reste réservé à la modération.
                </p>
              </Tabs.Content>
              <Tabs.Content value="moderator" className="space-y-1 p-4 text-sm">
                <PreviewRow label="Commanditaire" value={values.clientName || "—"} />
                <PreviewRow label="Titre interne" value={values.internalTitle || "—"} />
                <PreviewRow label="Notes" value={values.moderatorNotes || "—"} />
                <PreviewRow label="Éligibilité" value={values.eligibilityMode} />
                <p className="text-xs text-ink-faint">+ l&rsquo;intégralité des niveaux précédents.</p>
              </Tabs.Content>
            </Tabs.Root>

            {serverError && (
              <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-sm text-blood-bright">
                {serverError}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-border-default pt-4">
              {mode === "create" || currentStatus === "DRAFT" ? (
                <>
                  <Button variant="outline" onClick={() => submit(false)} disabled={isPending}>
                    {mode === "edit" ? "Enregistrer le brouillon" : "Enregistrer en brouillon"}
                  </Button>
                  <Button variant="gold" onClick={() => submit(true)} disabled={isPending}>
                    {isPending ? "Tissage…" : "Publier sur la Toile"}
                  </Button>
                </>
              ) : (
                <Button variant="gold" onClick={() => submit(true)} disabled={isPending}>
                  {isPending ? "Modification…" : "Enregistrer les modifications"}
                </Button>
              )}
            </div>
          </div>
        )}

        {step < 9 && (
          <div className="mt-6 flex justify-between border-t border-border-default pt-4">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                ← Précédent
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outline" onClick={nextStep}>
              Suivant →
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-36 shrink-0 text-[0.65rem] uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="min-w-0 text-ink-muted">{value}</span>
    </div>
  );
}
