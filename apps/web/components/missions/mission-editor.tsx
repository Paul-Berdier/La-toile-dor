"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MISSION_CATEGORIES,
  MISSION_DEADLINE_MODES,
  PROFILE_FIELD_LABELS,
  RANK_ORDER,
  checkMissionForPublication,
  formatMissionRank,
  formatRpDuration,
  generateMissionPublicTitle,
  missionBlockingErrors,
  missionTemplate,
  rankLooksLow,
  suggestMissionRank,
  type MissionDeadlineMode,
  type MissionEditorInput,
  type ProfileFieldKey,
  type Rank,
} from "@toile/shared";
import {
  describeProfileForEditorAction,
  duplicateMissionAction,
  saveMissionAction,
} from "@/server/missions/editor-actions";
import { Button } from "@/components/ui/button";
import { RankSeal } from "./rank-seal";
import { ProfilePicker, type PickedProfile } from "./profile-picker";

/**
 * ÉDITEUR DE MISSION — une page, pas dix écrans.
 *
 * L'ancien parcours faisait cliquer neuf fois « Suivant » pour une mission qui
 * tient en quatre décisions : quel type, quel rang, contre qui, pour combien.
 * Tout le reste était soit facultatif, soit déjà écrit dans les dossiers.
 *
 * Ici : l'essentiel en haut, les personnes juste après (des DOSSIERS, pas du
 * texte), le détail plus bas, l'accessoire replié. À droite, l'aperçu de ce
 * que le tableau montrera et la liste de ce qui manque — pour ne pas
 * découvrir les erreurs une par une au moment de publier.
 */

interface EditorOption {
  slug: string;
  label: string;
}

interface RankConfigLite {
  rank: Rank;
  rewardRyoMin: number;
  rewardRyoMax: number;
  defaultPoints: number;
  recommendedGroupSize: number;
  minLevelSlug: string | null;
}

export interface MissionEditorProps {
  mode: "create" | "edit";
  missionId?: string;
  levels: EditorOption[];
  rankConfigs: RankConfigLite[];
  /** Temps RP : durée réelle d'un mois RP, pour afficher les équivalences */
  rpMonthMs: number;
  initialValues: MissionEditorInput;
  initialPicked: PickedProfile[];
  /** Super-modérateur : peut imposer un titre à la main (motivé) */
  canOverrideTitle: boolean;
  status?: string;
}

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const labelCls = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";
const sectionCls = "border border-border-default bg-raised p-4";
const headingCls = "font-display text-sm tracking-widest text-gold uppercase";

const DEADLINE_LABELS: Record<MissionDeadlineMode, string> = {
  NONE: "Aucun délai",
  REAL: "Durée réelle",
  RP: "Durée RP",
  DATE: "Date précise",
};

/** Champs de dossier proposés comme « informations recherchées » (§58). */
const SOUGHT_CHOICES: ProfileFieldKey[] = [
  "rank", "ninjaClass", "faction", "clans", "chakraNatures", "kekkeiGenkai",
  "eyeColor", "hairColor", "height", "combatStyles", "techniques", "lifeStatus",
  "details", "strengths", "weaknesses",
];

export function MissionEditor({
  mode,
  missionId,
  levels,
  rankConfigs,
  rpMonthMs,
  initialValues,
  initialPicked,
  canOverrideTitle,
  status,
}: MissionEditorProps) {
  const router = useRouter();
  const [values, setValues] = useState<MissionEditorInput>(initialValues);
  const [picked, setPicked] = useState<PickedProfile[]>(initialPicked);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dirty = useRef(false);
  // L'identifiant peut naître d'un premier enregistrement de brouillon
  const idRef = useRef<string | undefined>(missionId);

  const set = useCallback(<K extends keyof MissionEditorInput>(key: K, value: MissionEditorInput[K]) => {
    dirty.current = true;
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  const updatePicked = useCallback((next: PickedProfile[]) => {
    dirty.current = true;
    setPicked(next);
    setValues((current) => ({
      ...current,
      links: next.map((p) => ({ profileId: p.profileId, role: p.role, isPrimary: p.isPrimary })),
    }));
  }, []);

  const targets = useMemo(() => picked.filter((p) => p.role === "TARGET"), [picked]);
  const clients = useMemo(() => picked.filter((p) => p.role === "CLIENT"), [picked]);
  const template = useMemo(() => missionTemplate(values.category), [values.category]);
  const rankConfig = useMemo(
    () => rankConfigs.find((c) => c.rank === values.rank),
    [rankConfigs, values.rank],
  );

  // ── Aperçu public : recalculé à chaque frappe, comme le verra le tableau ──
  const preview = useMemo(
    () =>
      generateMissionPublicTitle({
        category: values.category,
        rank: values.rank,
        rankModifier: values.rankModifier,
        targets: targets.map((t) => ({
          gradeLabel: t.gradeLabel,
          // L'ordre exact n'est pas connu du client : le libellé suffit à
          // grouper, et le serveur recalcule le titre définitif.
          gradeOrder: t.gradeLabel ? gradeRank(t.gradeLabel, levels) : null,
          originLabel: t.originLabel,
        })),
        originVisibility: values.originVisibility,
      }),
    [values.category, values.rank, values.rankModifier, values.originVisibility, targets, levels],
  );

  const suggestedRank = useMemo(
    () =>
      suggestMissionRank(
        targets.map((t) => ({ gradeOrder: t.gradeLabel ? gradeRank(t.gradeLabel, levels) : null })),
        values.category,
      ),
    [targets, values.category, levels],
  );
  const rankWarning = rankLooksLow(values.rank, suggestedRank);

  const checks = useMemo(
    () =>
      checkMissionForPublication(values, {
        targetCount: targets.length,
        clientCount: clients.length,
      }),
    [values, targets.length, clients.length],
  );
  const blocking = missionBlockingErrors(checks);

  // ── Brouillon : enregistré 2 s après la dernière frappe ──
  const save = useCallback(
    (publish: boolean, redirectAfter: boolean) =>
      new Promise<boolean>((resolve) => {
        startTransition(async () => {
          const res = await saveMissionAction({
            missionId: idRef.current,
            values,
            publish,
            redirectAfter,
          });
          // En cas de succès avec redirection, l'action redirige : on n'arrive
          // ici qu'en erreur ou en enregistrement silencieux.
          if (res && !res.ok) {
            setError(res.error ?? "L'enregistrement a échoué.");
            resolve(false);
            return;
          }
          if (res?.missionId) idRef.current = res.missionId;
          setError(null);
          setSavedAt(new Date());
          dirty.current = false;
          resolve(true);
        });
      }),
    [values],
  );

  useEffect(() => {
    // Pas d'autosave sur une mission PUBLIÉE : on ne modifie pas un contrat
    // affiché au tableau sans le vouloir.
    if (!dirty.current || (status && status !== "DRAFT")) return;
    const timer = setTimeout(() => {
      setSavingDraft(true);
      void save(false, false).finally(() => setSavingDraft(false));
    }, 2000);
    return () => clearTimeout(timer);
  }, [values, picked, save, status]);

  // Ctrl+S enregistre, Ctrl+Entrée ouvre la confirmation — jamais la
  // publication directe : un contrat publié part en notification.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSavingDraft(true);
        void save(false, false).finally(() => setSavingDraft(false));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setConfirmPublish(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const applyRankDefaults = (rank: Rank) => {
    const config = rankConfigs.find((c) => c.rank === rank);
    dirty.current = true;
    setValues((current) => ({
      ...current,
      rank,
      ...(config
        ? {
            rewardRyoMin: config.rewardRyoMin,
            rewardRyoMax: config.rewardRyoMax,
            basePoints: config.defaultPoints,
            groupSizeMax: config.recommendedGroupSize,
            minRecommendedLevelSlug: config.minLevelSlug ?? current.minRecommendedLevelSlug,
          }
        : {}),
    }));
  };

  const focusField = (field: string) => {
    const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      {/* ─────────── Colonne principale ─────────── */}
      <div className="min-w-0 space-y-4">
        {/* ESSENTIEL */}
        <section className={sectionCls} data-field="category">
          <h2 className={`${headingCls} mb-3`}>Essentiel</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="me-category" className={labelCls}>Type de mission *</label>
              <select
                id="me-category"
                className={input}
                value={values.category}
                onChange={(e) => set("category", e.target.value as MissionEditorInput["category"])}
              >
                {MISSION_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div data-field="deadline">
              <label htmlFor="me-deadline-mode" className={labelCls}>Délai</label>
              <select
                id="me-deadline-mode"
                className={input}
                value={values.deadline.mode}
                onChange={(e) =>
                  set("deadline", { ...values.deadline, mode: e.target.value as MissionDeadlineMode })
                }
              >
                {MISSION_DEADLINE_MODES.map((m) => (
                  <option key={m} value={m}>{DEADLINE_LABELS[m]}</option>
                ))}
              </select>
              <DeadlineFields
                deadline={values.deadline}
                rpMonthMs={rpMonthMs}
                onChange={(next) => set("deadline", next)}
              />
            </div>
          </div>

          <fieldset className="mt-4" data-field="rank">
            <legend className={labelCls}>Rang *</legend>
            <div className="flex flex-wrap items-center gap-2">
              {RANK_ORDER.map((rank) => (
                <button
                  key={rank}
                  type="button"
                  onClick={() => applyRankDefaults(rank)}
                  aria-pressed={values.rank === rank}
                  aria-label={`Rang ${rank}`}
                  className={`flex flex-col items-center gap-1 border p-1.5 transition-colors ${
                    values.rank === rank ? "border-gold bg-hover-bg" : "border-border-default hover:border-border-gold"
                  }`}
                >
                  <RankSeal rank={rank} size={30} />
                  <span className="font-mono-toile text-[0.6rem] text-ink-faint">{rank}</span>
                </button>
              ))}
              {/* Nuance : « B+ » est un B plus rude, pas un rang de plus */}
              <span className="ml-2 flex items-center gap-1">
                {(["MINUS", "NONE", "PLUS"] as const).map((modifier) => (
                  <button
                    key={modifier}
                    type="button"
                    onClick={() => set("rankModifier", modifier)}
                    aria-pressed={values.rankModifier === modifier}
                    aria-label={`Nuance ${formatMissionRank(values.rank, modifier)}`}
                    className={`min-h-[2rem] border px-2 py-1 font-mono-toile text-xs ${
                      values.rankModifier === modifier
                        ? "border-gold text-gold"
                        : "border-border-default text-ink-faint hover:border-border-gold"
                    }`}
                  >
                    {formatMissionRank(values.rank, modifier)}
                  </button>
                ))}
              </span>
            </div>
            {rankWarning && suggestedRank && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning">
                ⚠ Ce rang paraît faible au regard des cibles.
                <button
                  type="button"
                  onClick={() => applyRankDefaults(suggestedRank as Rank)}
                  className="border border-warning/60 px-1.5 py-0.5 hover:border-gold hover:text-gold"
                >
                  Utiliser {suggestedRank}
                </button>
              </p>
            )}
          </fieldset>

          <div className="mt-4 grid gap-3 sm:grid-cols-3" data-field="rewardRyoMin">
            <div>
              <label htmlFor="me-reward-min" className={labelCls}>Récompense min (ryōs)</label>
              <input
                id="me-reward-min"
                type="number"
                min={0}
                className={input}
                value={values.rewardRyoMin}
                onChange={(e) => set("rewardRyoMin", Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label htmlFor="me-reward-max" className={labelCls}>Récompense max</label>
              <input
                id="me-reward-max"
                type="number"
                min={0}
                className={input}
                value={values.rewardRyoMax}
                onChange={(e) => set("rewardRyoMax", Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <label htmlFor="me-points" className={labelCls}>Points</label>
              <input
                id="me-points"
                type="number"
                min={0}
                className={input}
                value={values.basePoints}
                onChange={(e) => set("basePoints", Number(e.target.value) || 0)}
              />
            </div>
          </div>
          {rankConfig && (
            <p className="mt-1.5 text-[0.7rem] text-ink-faint">
              Rang {formatMissionRank(values.rank, values.rankModifier)} — habituel :{" "}
              {rankConfig.rewardRyoMin.toLocaleString("fr-FR")} à {rankConfig.rewardRyoMax.toLocaleString("fr-FR")} ryōs.
              {(values.rewardRyoMin !== rankConfig.rewardRyoMin || values.rewardRyoMax !== rankConfig.rewardRyoMax) && (
                <button
                  type="button"
                  onClick={() => {
                    set("rewardRyoMin", rankConfig.rewardRyoMin);
                    set("rewardRyoMax", rankConfig.rewardRyoMax);
                  }}
                  className="ml-2 border border-border-default px-1.5 py-0.5 hover:border-gold hover:text-gold"
                >
                  Utiliser
                </button>
              )}
            </p>
          )}
        </section>

        {/* PERSONNES — des dossiers, jamais du texte libre */}
        <section className={sectionCls} data-field="links">
          <h2 className={`${headingCls} mb-1`}>Personnes</h2>
          <p className="mb-3 text-xs text-ink-faint">
            Cibles et commanditaires sont des <strong className="text-ink-muted">dossiers</strong> : leur grade,
            leur classe et leur village en sont repris, et le titre public s&rsquo;en déduit.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs uppercase tracking-wider text-ink-faint">
                Cibles {targets.length > 0 && <span className="text-gold">({targets.length})</span>}
              </h3>
              <ProfilePicker
                role="TARGET"
                picked={picked}
                onChange={updatePicked}
                describeProfile={describeProfileForEditorAction}
              />
            </div>
            <div>
              <h3 className="mb-1.5 text-xs uppercase tracking-wider text-ink-faint">
                Commanditaires {clients.length > 0 && <span className="text-gold">({clients.length})</span>}
              </h3>
              <ProfilePicker
                role="CLIENT"
                picked={picked}
                onChange={updatePicked}
                describeProfile={describeProfileForEditorAction}
              />
            </div>
          </div>

          {/* Rôles secondaires : proposés seulement quand le type le justifie */}
          {template.emphasizeRoles.some((r) => r !== "TARGET" && r !== "CLIENT") && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs uppercase tracking-wider text-ink-faint hover:text-gold">
                Autres personnes (contacts, sujets)
              </summary>
              <div className="mt-2 grid gap-4 lg:grid-cols-2">
                {template.emphasizeRoles
                  .filter((r) => r !== "TARGET" && r !== "CLIENT")
                  .map((role) => (
                    <div key={role}>
                      <h3 className="mb-1.5 text-xs uppercase tracking-wider text-ink-faint">
                        {role === "SUBJECT" ? "Sujets" : role === "CONTACT" ? "Contacts" : "Personnes d'intérêt"}
                      </h3>
                      <ProfilePicker
                        role={role}
                        picked={picked}
                        onChange={updatePicked}
                        describeProfile={describeProfileForEditorAction}
                      />
                    </div>
                  ))}
              </div>
            </details>
          )}
        </section>

        {/* OBJECTIF */}
        <section className={sectionCls} data-field="primaryObjective">
          <h2 className={`${headingCls} mb-3`}>Objectif</h2>
          <label htmlFor="me-objective" className={labelCls}>{template.objectiveLabel}</label>
          <textarea
            id="me-objective"
            rows={2}
            className={input}
            placeholder={template.objectivePlaceholder}
            maxLength={2000}
            value={values.primaryObjective ?? ""}
            onChange={(e) => set("primaryObjective", e.target.value)}
          />

          <div className="mt-3">
            <p className={labelCls}>Objectifs secondaires</p>
            <ul className="space-y-1.5">
              {values.secondaryObjectives.map((objective, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Objectif secondaire ${index + 1}`}
                    className={`${input} flex-1`}
                    maxLength={300}
                    value={objective.label}
                    onChange={(e) =>
                      set(
                        "secondaryObjectives",
                        values.secondaryObjectives.map((o, i) =>
                          i === index ? { ...o, label: e.target.value } : o,
                        ),
                      )
                    }
                  />
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={objective.secret ?? false}
                      onChange={(e) =>
                        set(
                          "secondaryObjectives",
                          values.secondaryObjectives.map((o, i) =>
                            i === index ? { ...o, secret: e.target.checked } : o,
                          ),
                        )
                      }
                    />
                    secret
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      set("secondaryObjectives", values.secondaryObjectives.filter((_, i) => i !== index))
                    }
                    className="min-h-[1.75rem] text-xs text-ink-faint underline hover:text-blood-bright"
                  >
                    retirer
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                set("secondaryObjectives", [...values.secondaryObjectives, { label: "" }])
              }
            >
              + Ajouter un objectif secondaire
            </Button>
          </div>
        </section>

        {/* PRISE D'INFORMATION : ce que la Toile cherche à apprendre */}
        {template.intelFocused && (
          <section className={sectionCls} data-field="soughtFieldKeys">
            <h2 className={`${headingCls} mb-1`}>Informations recherchées</h2>
            <p className="mb-2 text-xs text-ink-faint">
              Elles seront proposées d&rsquo;un clic dans le rapport de fin de mission, pour chaque dossier.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SOUGHT_CHOICES.map((key) => {
                const active = values.soughtFieldKeys.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      set(
                        "soughtFieldKeys",
                        active
                          ? values.soughtFieldKeys.filter((k) => k !== key)
                          : [...values.soughtFieldKeys, key],
                      )
                    }
                    className={`min-h-[1.9rem] border px-2 py-0.5 text-xs ${
                      active ? "border-gold text-gold" : "border-border-default text-ink-faint hover:border-border-gold"
                    }`}
                  >
                    {PROFILE_FIELD_LABELS[key]}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* INFORMATIONS OPÉRATIONNELLES */}
        <section className={sectionCls}>
          <h2 className={`${headingCls} mb-3`}>Informations opérationnelles</h2>
          <div className="space-y-3">
            <div>
              <label htmlFor="me-location" className={labelCls}>Lieu</label>
              <input
                id="me-location"
                className={input}
                maxLength={500}
                value={values.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="me-confidential" className={labelCls}>Instructions (volet confidentiel)</label>
              <textarea
                id="me-confidential"
                rows={3}
                className={input}
                maxLength={10_000}
                value={values.confidentialDescription ?? ""}
                onChange={(e) => set("confidentialDescription", e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="me-constraints" className={labelCls}>Contraintes</label>
                <textarea
                  id="me-constraints"
                  rows={2}
                  className={input}
                  maxLength={3000}
                  value={values.constraints ?? ""}
                  onChange={(e) => set("constraints", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="me-prohibitions" className={labelCls}>Interdictions</label>
                <textarea
                  id="me-prohibitions"
                  rows={2}
                  className={input}
                  maxLength={3000}
                  value={values.prohibitions ?? ""}
                  onChange={(e) => set("prohibitions", e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="me-evidence" className={labelCls}>Preuves à rapporter</label>
              <input
                id="me-evidence"
                className={input}
                maxLength={3000}
                value={values.evidence ?? ""}
                onChange={(e) => set("evidence", e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="me-summary" className={labelCls}>
                Résumé public <span className="normal-case text-ink-faint">— visible de tous au tableau</span>
              </label>
              <textarea
                id="me-summary"
                rows={2}
                className={input}
                maxLength={2000}
                placeholder="Ce que la Toile accepte de dire du contrat."
                value={values.publicSummary ?? ""}
                onChange={(e) => set("publicSummary", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* OPTIONS AVANCÉES — repliées */}
        <details className={sectionCls}>
          <summary className={`cursor-pointer ${headingCls}`}>Options avancées</summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="me-internal" className={labelCls}>Titre interne (modération)</label>
                <input
                  id="me-internal"
                  className={input}
                  maxLength={120}
                  placeholder="Opération Serpent Rouge"
                  value={values.internalTitle ?? ""}
                  onChange={(e) => set("internalTitle", e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="me-min-level" className={labelCls}>Niveau minimal des agents</label>
                <select
                  id="me-min-level"
                  className={input}
                  value={values.minRecommendedLevelSlug ?? ""}
                  onChange={(e) => set("minRecommendedLevelSlug", e.target.value)}
                >
                  <option value="">Aucun</option>
                  {levels.map((level) => (
                    <option key={level.slug} value={level.slug}>{level.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="me-notes" className={labelCls}>Notes internes</label>
              <textarea
                id="me-notes"
                rows={2}
                className={input}
                maxLength={5000}
                value={values.moderatorNotes ?? ""}
                onChange={(e) => set("moderatorNotes", e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="me-size-min" className={labelCls}>Effectif minimal</label>
                <input
                  id="me-size-min"
                  type="number"
                  min={1}
                  className={input}
                  value={values.groupSizeMin}
                  onChange={(e) => set("groupSizeMin", Number(e.target.value) || 1)}
                />
              </div>
              <div>
                <label htmlFor="me-size-max" className={labelCls}>Effectif maximal</label>
                <input
                  id="me-size-max"
                  type="number"
                  min={1}
                  className={input}
                  value={values.groupSizeMax}
                  onChange={(e) => set("groupSizeMax", Number(e.target.value) || 1)}
                />
              </div>
            </div>

            <fieldset>
              <legend className={labelCls}>Visibilité avant attribution</legend>
              <div className="space-y-1.5 text-xs text-ink-muted">
                {([
                  ["showCategory", "Montrer le type de mission"],
                  ["showTargetLevel", "Montrer le niveau de la cible"],
                  ["showSummary", "Montrer le résumé public"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={values.visibility[key]}
                      onChange={(e) => set("visibility", { ...values.visibility, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.originVisibility === "SHOW"}
                    onChange={(e) => set("originVisibility", e.target.checked ? "SHOW" : "HIDE")}
                  />
                  Montrer l&rsquo;origine des cibles dans le titre public
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.notifyLeaders}
                    onChange={(e) => set("notifyLeaders", e.target.checked)}
                  />
                  Prévenir les chefs de groupe à la publication
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={values.requiresEnhancedReview}
                    onChange={(e) => set("requiresEnhancedReview", e.target.checked)}
                  />
                  Exiger un examen renforcé avant le démarrage
                </label>
              </div>
            </fieldset>

            <div>
              <label htmlFor="me-eligibility" className={labelCls}>Politique d&rsquo;éligibilité</label>
              <select
                id="me-eligibility"
                className={input}
                value={values.eligibilityMode}
                onChange={(e) => set("eligibilityMode", e.target.value as MissionEditorInput["eligibilityMode"])}
              >
                <option value="RECOMMENDATION">Recommandation</option>
                <option value="WARNING">Avertissement</option>
                <option value="STRICT">Strict</option>
              </select>
            </div>

            {canOverrideTitle && (
              <div className="border border-copper/50 p-3">
                <label htmlFor="me-title-override" className={labelCls}>
                  Titre public imposé <span className="normal-case text-copper">— dérogation</span>
                </label>
                <input
                  id="me-title-override"
                  className={input}
                  maxLength={120}
                  placeholder={preview.title}
                  value={values.titleOverride ?? ""}
                  onChange={(e) => set("titleOverride", e.target.value)}
                />
                {values.titleOverride && (
                  <>
                    <label htmlFor="me-title-reason" className={`${labelCls} mt-2`}>Justification *</label>
                    <input
                      id="me-title-reason"
                      className={input}
                      maxLength={500}
                      value={values.titleOverrideReason ?? ""}
                      onChange={(e) => set("titleOverrideReason", e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        set("titleOverride", undefined);
                        set("titleOverrideReason", undefined);
                      }}
                    >
                      Revenir au titre automatique
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </details>
      </div>

      {/* ─────────── Colonne d'aperçu (collante) ─────────── */}
      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <div className="space-y-3">
          <section className="border border-border-gold bg-raised p-4">
            <h2 className="mb-2 font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">
              Aperçu public
            </h2>
            <p className="font-display text-base leading-snug text-gold" aria-live="polite">
              {values.titleOverride?.trim() || preview.title}
            </p>
            {values.titleOverride?.trim() && (
              <p className="mt-1 text-[0.65rem] text-copper">Titre imposé — le titre calculé serait « {preview.title} ».</p>
            )}
            <dl className="mt-3 space-y-1 border-t border-border-default pt-2 text-[0.7rem]">
              <Row label="Rang" value={formatMissionRank(values.rank, values.rankModifier)} />
              <Row label="Niveau cible" value={preview.segments.targetLevel ?? "aucune cible"} />
              <Row
                label="Origine"
                value={
                  preview.segments.origin ??
                  (targets.length === 0 ? "aucune cible" : "masquée")
                }
              />
              <Row
                label="Récompense"
                value={`${values.rewardRyoMin.toLocaleString("fr-FR")} – ${values.rewardRyoMax.toLocaleString("fr-FR")} ryōs`}
              />
              <Row label="Expiration" value={deadlineSummary(values.deadline, rpMonthMs)} />
            </dl>
          </section>

          <section className="border border-border-default bg-raised p-4">
            <h2 className="mb-2 font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">
              Vérification
            </h2>
            <ul className="space-y-1 text-xs">
              {checks.map((check) => (
                <li key={`${check.field}-${check.label}`} className="flex items-start gap-1.5">
                  <span
                    aria-hidden
                    className={
                      check.level === "error"
                        ? "text-blood-bright"
                        : check.level === "warning"
                          ? "text-warning"
                          : "text-gold"
                    }
                  >
                    {check.level === "error" ? "✕" : check.level === "warning" ? "⚠" : "✓"}
                  </span>
                  <button
                    type="button"
                    onClick={() => focusField(check.field)}
                    className={`text-left underline-offset-2 hover:underline ${
                      check.level === "error"
                        ? "text-blood-bright"
                        : check.level === "warning"
                          ? "text-warning"
                          : "text-ink-muted"
                    }`}
                  >
                    {check.message}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {mode === "edit" && missionId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                const copy = window.confirm(
                  "Copier également les cibles et les commanditaires dans la nouvelle mission ?",
                );
                startTransition(async () => {
                  const res = await duplicateMissionAction({ missionId, copyLinks: copy });
                  if (!res.ok) setError(res.error ?? "La duplication a échoué.");
                  else if (res.missionId) router.push(`/missions/${res.missionId}/modifier`);
                });
              }}
            >
              Dupliquer cette mission
            </Button>
          )}
        </div>
      </aside>

      {/* ─────────── Barre d'actions collante ─────────── */}
      <div className="sticky bottom-16 z-20 flex flex-wrap items-center justify-between gap-2 border border-border-gold bg-obsidian/95 px-3 py-2 backdrop-blur md:bottom-4 lg:col-span-2">
        <p className="text-xs text-ink-faint" aria-live="polite">
          {savingDraft
            ? "Brouillon : enregistrement…"
            : savedAt
              ? `Brouillon enregistré à ${savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
              : status && status !== "DRAFT"
                ? "Mission publiée — les modifications sont enregistrées à la demande."
                : "Brouillon : rien à enregistrer"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => {
              setSavingDraft(true);
              void save(false, mode === "create").finally(() => setSavingDraft(false));
            }}
          >
            Enregistrer {status && status !== "DRAFT" ? "" : "le brouillon"}
          </Button>
          {(!status || status === "DRAFT") && (
            <Button
              size="sm"
              variant="gold"
              disabled={isPending || blocking.length > 0}
              onClick={() => setConfirmPublish(true)}
            >
              Publier la mission
            </Button>
          )}
        </div>
      </div>

      {/* Confirmation de publication — jamais par raccourci seul */}
      {confirmPublish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Publier la mission"
          className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/80 p-4"
        >
          <div className="w-full max-w-md border border-border-gold bg-raised p-5">
            <h2 className={headingCls}>Publier la mission</h2>
            <p className="mt-2 text-sm text-ink">{values.titleOverride?.trim() || preview.title}</p>
            <p className="mt-1 text-xs text-ink-faint">
              Le tableau l&rsquo;affichera à tous les chefs de groupe
              {values.notifyLeaders ? " et une notification leur sera envoyée." : "."}
            </p>
            {checks.filter((c) => c.level === "warning").length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs text-warning">
                {checks
                  .filter((c) => c.level === "warning")
                  .map((c) => (
                    <li key={c.label}>⚠ {c.message}</li>
                  ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmPublish(false)}>
                Annuler
              </Button>
              <Button
                size="sm"
                variant="gold"
                disabled={isPending}
                onClick={() => {
                  setConfirmPublish(false);
                  void save(true, true);
                }}
              >
                Publier
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="whitespace-nowrap text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right text-ink-muted">{value}</dd>
    </div>
  );
}

/** Champs du délai selon le mode choisi — un seul à remplir. */
function DeadlineFields({
  deadline,
  rpMonthMs,
  onChange,
}: {
  deadline: MissionEditorInput["deadline"];
  rpMonthMs: number;
  onChange: (next: MissionEditorInput["deadline"]) => void;
}) {
  if (deadline.mode === "NONE") return null;
  if (deadline.mode === "REAL") {
    return (
      <div className="mt-2">
        <label htmlFor="me-real-hours" className="sr-only">Durée en heures</label>
        <input
          id="me-real-hours"
          type="number"
          min={1}
          className={input}
          placeholder="Heures"
          value={deadline.realHours ?? ""}
          onChange={(e) => onChange({ ...deadline, realHours: Number(e.target.value) || null })}
        />
        {deadline.realHours ? (
          <p className="mt-1 text-[0.7rem] text-ink-faint">
            ≈ {formatRpEquivalent(deadline.realHours * 3600_000, rpMonthMs)} en temps RP
          </p>
        ) : null}
      </div>
    );
  }
  if (deadline.mode === "RP") {
    const rp = deadline.rp ?? { years: 0, months: 0, weeks: 0 };
    const totalMs =
      (rp.years * 7 + rp.months) * rpMonthMs + rp.weeks * (rpMonthMs / 4);
    return (
      <div className="mt-2">
        <div className="grid grid-cols-3 gap-2">
          {(["years", "months", "weeks"] as const).map((unit) => (
            <span key={unit}>
              <label htmlFor={`me-rp-${unit}`} className="mb-0.5 block text-[0.6rem] uppercase text-ink-faint">
                {unit === "years" ? "Années" : unit === "months" ? "Mois" : "Semaines"}
              </label>
              <input
                id={`me-rp-${unit}`}
                type="number"
                min={0}
                className={input}
                value={rp[unit]}
                onChange={(e) => onChange({ ...deadline, rp: { ...rp, [unit]: Number(e.target.value) || 0 } })}
              />
            </span>
          ))}
        </div>
        {totalMs > 0 && (
          <p className="mt-1 text-[0.7rem] text-ink-faint">
            ≈ {Math.round(totalMs / 3600_000)} h réelles
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2">
      <label htmlFor="me-deadline-at" className="sr-only">Date d&rsquo;expiration</label>
      <input
        id="me-deadline-at"
        type="datetime-local"
        className={input}
        value={deadline.at ? deadline.at.slice(0, 16) : ""}
        onChange={(e) =>
          onChange({ ...deadline, at: e.target.value ? new Date(e.target.value).toISOString() : null })
        }
      />
    </div>
  );
}

function deadlineSummary(deadline: MissionEditorInput["deadline"], rpMonthMs: number): string {
  switch (deadline.mode) {
    case "NONE":
      return "Sans limite";
    case "REAL":
      return deadline.realHours ? `${deadline.realHours} h` : "à préciser";
    case "RP": {
      const rp = deadline.rp;
      if (!rp) return "à préciser";
      const parts = [
        rp.years ? `${rp.years} an${rp.years > 1 ? "s" : ""} RP` : null,
        rp.months ? `${rp.months} mois RP` : null,
        rp.weeks ? `${rp.weeks} sem. RP` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" ") : "à préciser";
    }
    case "DATE":
      return deadline.at ? new Date(deadline.at).toLocaleString("fr-FR") : "à préciser";
  }
}

function formatRpEquivalent(realMs: number, rpMonthMs: number): string {
  const months = realMs / rpMonthMs;
  if (months < 1) return `${Math.round(months * 4)} semaine(s) RP`;
  if (months < 7) return `${Math.round(months)} mois RP`;
  return `${(months / 7).toFixed(1)} année(s) RP`;
}

/** Ordre hiérarchique d'un grade d'après son libellé (les niveaux du serveur). */
function gradeRank(label: string, levels: EditorOption[]): number | null {
  const index = levels.findIndex((l) => l.label === label);
  return index >= 0 ? index : null;
}
