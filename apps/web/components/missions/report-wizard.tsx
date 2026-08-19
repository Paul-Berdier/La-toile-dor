"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CONTRIBUTABLE_FIELD_KEYS,
  EMPTY_REPORT_PAYLOAD,
  LIST_FIELD_KEYS,
  MISSION_TARGET_OUTCOMES,
  MISSION_TARGET_OUTCOME_LABELS,
  PROFILE_FIELD_LABELS,
  REPORT_IMAGES_MAX,
  REPORT_IMAGE_MAX_BYTES,
  isReportEntryComplete,
  untreatedDossiers,
  type MissionReportPayload,
  type ProfileFieldKey,
  type ReportIntelEntry,
} from "@toile/shared";
import {
  discardMissionReportDraftAction,
  finalizeMissionReportAction,
  saveMissionReportDraftAction,
  type ReportActionResult,
} from "@/server/missions/report-actions";
import { Button } from "@/components/ui/button";
import { INTEL_PALETTE, IntelValueEditor, canDeclareNone, type IntelRefs } from "@/components/profils/intel-value-editor";

export interface WizardTarget {
  id: string;
  profileId: string | null;
  /** Prénom + nom + code : les valeurs PUBLIQUES d'un dossier */
  name: string;
  code: string | null;
  outcome: string;
  /** Précision déjà consignée (panneau des cibles) — préremplie ici */
  note?: string | null;
  /** Le groupe rapporteur lit-il ce dossier ? (affichage seulement) */
  canViewDossier?: boolean;
  /**
   * Libellés courants des champs (§41 « Valeur actuelle »). Fournis SEULEMENT
   * si le groupe rapporteur voit le dossier — sinon null, et le client
   * affiche « Confidentielle » sans avoir jamais reçu la valeur.
   */
  currentValues?: Record<string, string> | null;
}

const STEPS = ["Résultat", "Renseignements", "Validation"] as const;
const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const labelCls = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * Rapport de fin de mission en trois étapes, avec brouillon sauvegardé au fil
 * de la saisie et finalisation TOUT OU RIEN côté serveur.
 *
 * Étape 2 : par dossier cible, « Aucune nouvelle information » (un clic) ou
 * « + Ajouter un champ » ; « + Ninja découvert » ouvre un nouveau dossier pour
 * le groupe. Les valeurs en place ne sont JAMAIS affichées ici — l'équipe
 * dit ce qu'elle a vu, la modération compare.
 */
export function MissionReportWizard({
  missionId,
  missionCode,
  groupId,
  groupName,
  targets,
  refs,
  initialDraft,
  draftSavedAt,
  canFinalize,
}: {
  missionId: string;
  missionCode: string;
  groupId: string;
  groupName: string;
  targets: WizardTarget[];
  refs: IntelRefs;
  initialDraft: MissionReportPayload | null;
  draftSavedAt: string | null;
  /** Le brouillon est possible dès l'attribution ; le dépôt exige IN_PROGRESS. */
  canFinalize: boolean;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<MissionReportPayload>(() => {
    const base = initialDraft ?? EMPTY_REPORT_PAYLOAD;
    // Les sorts suivent les cibles actuelles : une cible ajoutée depuis le
    // brouillon apparaît, une cible retirée disparaît. Le sort et la note
    // déjà consignés (panneau des cibles) préremplissent la première visite.
    const known = new Map(base.outcomes.map((o) => [o.targetId, o]));
    return {
      ...base,
      outcomes: targets.map(
        (t) =>
          known.get(t.id) ?? {
            targetId: t.id,
            outcome: (t.outcome as never) ?? "UNKNOWN",
            ...(t.note ? { note: t.note } : {}),
          },
      ),
      // Les blocs `linked` (dossiers rattachés par l'équipe) survivent au
      // filtre : ils ne dépendent pas des cibles de la mission.
      dossiers: base.dossiers.filter((d) => d.linked || targets.some((t) => t.profileId === d.profileId)),
    };
  });
  const [step, setStep] = useState(initialDraft?.step ?? 0);
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(draftSavedAt);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<NonNullable<ReportActionResult["duplicates"]>>([]);
  const [duplicateConfirmationToken, setDuplicateConfirmationToken] = useState("");
  const [done, setDone] = useState<ReportActionResult["summary"] | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const finalizing = useRef(false);
  // Une fois finalisé, plus aucune sauvegarde : un timer en retard
  // ressusciterait le brouillon que le serveur vient d'effacer.
  const finalized = useRef(false);

  const enqueueDraftSave = useCallback(
    (snapshot: MissionReportPayload): Promise<boolean> => {
      setSaving(true);
      const run = saveChain.current.then(async () => {
        try {
          const res = await saveMissionReportDraftAction({ missionId, groupId, payload: snapshot });
          if (res.ok) {
            setSaved(new Date().toISOString());
            setDraftError(null);
            return true;
          }
          setDraftError(res.error ?? "Le brouillon n'a pas pu être enregistré.");
          return false;
        } catch {
          setDraftError("Le brouillon n'a pas pu être enregistré.");
          return false;
        }
      });
      const tail = run.then(() => undefined);
      saveChain.current = tail;
      void tail.then(() => {
        // Une sauvegarde plus récente a pu être ajoutée entre-temps :
        // l'indicateur ne s'éteint qu'une fois la file entière terminée.
        if (saveChain.current === tail) setSaving(false);
      });
      return run;
    },
    [missionId, groupId],
  );

  // ── Brouillon : sauvegarde 1,5 s après la dernière frappe ──
  useEffect(() => {
    if (!dirty.current || finalizing.current || finalized.current) return;
    const timer = setTimeout(() => {
      if (finalizing.current || finalized.current) return;
      const snapshot = { ...payload, step };
      // Les sauvegardes restent strictement ordonnées : une ancienne réponse
      // ne peut plus écraser une saisie plus récente.
      void enqueueDraftSave(snapshot);
    }, 1500);
    return () => clearTimeout(timer);
  }, [payload, step, enqueueDraftSave]);

  const update = useCallback((fn: (p: MissionReportPayload) => MissionReportPayload) => {
    dirty.current = true;
    setDuplicates([]);
    setDuplicateConfirmationToken("");
    setPayload(fn);
  }, []);
  const goTo = (s: number) => {
    // Naviguer dans un wizard VIERGE ne crée pas de brouillon : seul un
    // rapport déjà entamé (frappe ou brouillon existant) mémorise son étape.
    if (dirty.current || saved !== null) dirty.current = true;
    setDuplicates([]);
    setDuplicateConfirmationToken("");
    setStep(s);
  };

  // ── Étape 1 : sorts et résumé ──
  const setOutcome = (targetId: string, patch: Partial<{ outcome: string; note: string }>) =>
    update((p) => ({
      ...p,
      outcomes: p.outcomes.map((o) => (o.targetId === targetId ? { ...o, ...(patch as object) } : o)),
    }));

  const addImages = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    setImages((current) => {
      const next = [...current];
      for (const file of Array.from(list)) {
        if (next.length >= REPORT_IMAGES_MAX) { setError(`${REPORT_IMAGES_MAX} images maximum.`); break; }
        if (file.size > REPORT_IMAGE_MAX_BYTES) { setError(`Image « ${file.name} » trop lourde : 2 Mo maximum.`); continue; }
        next.push({ file, url: URL.createObjectURL(file) });
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Étape 2 : dossiers ──
  const dossierTargets = targets.filter((t): t is WizardTarget & { profileId: string } => Boolean(t.profileId));
  const dossierOf = (profileId: string) =>
    payload.dossiers.find((d) => d.profileId === profileId) ?? { profileId, noNewInfo: false, entries: [] };
  const setDossier = (profileId: string, patch: Partial<{ noNewInfo: boolean; entries: ReportIntelEntry[] }>) =>
    update((p) => {
      const existing = p.dossiers.find((d) => d.profileId === profileId);
      const next = { ...(existing ?? { profileId, noNewInfo: false, entries: [] }), ...patch };
      return {
        ...p,
        dossiers: existing ? p.dossiers.map((d) => (d.profileId === profileId ? next : d)) : [...p.dossiers, next],
      };
    });
  // Dossiers EXISTANTS rattachés par l'équipe (ninja croisé qui avait déjà sa
  // fiche) : les renseignements partent en revue, sauf si le groupe possède
  // le dossier — c'est le serveur qui tranche.
  const linkedDossiers = payload.dossiers.filter((d) => d.linked);
  const addLinked = (profile: { id: string; code: string; firstName: string; lastName?: string | null }, entries: ReportIntelEntry[] = []) =>
    update((p) =>
      p.dossiers.some((d) => d.profileId === profile.id)
        ? p
        : {
            ...p,
            dossiers: [
              ...p.dossiers,
              {
                profileId: profile.id,
                noNewInfo: false,
                entries,
                linked: true,
                name: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
                code: profile.code,
              },
            ],
          },
    );
  const removeLinked = (profileId: string) =>
    update((p) => ({ ...p, dossiers: p.dossiers.filter((d) => !(d.linked && d.profileId === profileId)) }));

  const addDiscovered = () =>
    update((p) => ({
      ...p,
      discovered: [
        ...p.discovered,
        { localId: `n${Date.now().toString(36)}`, firstName: "", outcome: "UNKNOWN", entries: [] },
      ],
    }));
  const setDiscovered = (localId: string, patch: Partial<MissionReportPayload["discovered"][number]>) =>
    update((p) => ({ ...p, discovered: p.discovered.map((d) => (d.localId === localId ? { ...d, ...patch } : d)) }));
  const removeDiscovered = (localId: string) =>
    update((p) => ({ ...p, discovered: p.discovered.filter((d) => d.localId !== localId) }));

  const untreated = useMemo(
    () => untreatedDossiers(payload, dossierTargets.map((t) => t.profileId)),
    [payload, dossierTargets],
  );
  const summaryOk = payload.summary.trim().length >= 10;
  const discoveredOk = payload.discovered.every((d) => d.firstName.trim().length > 0);
  // Entrées incomplètes : signalées AVANT le dépôt, avec le nom du dossier et
  // du champ — pas un « Required » anglais renvoyé par le serveur.
  const incompleteEntries = useMemo(() => {
    const out: { where: string; fields: string[] }[] = [];
    const nameOfTarget = new Map(dossierTargets.map((t) => [t.profileId, t.name]));
    for (const d of payload.dossiers) {
      if (d.noNewInfo) continue;
      const missing = d.entries
        .filter((e) => !isReportEntryComplete(e))
        .map((e) => PROFILE_FIELD_LABELS[e.fieldKey as ProfileFieldKey] ?? e.fieldKey);
      if (missing.length > 0) out.push({ where: d.name ?? nameOfTarget.get(d.profileId) ?? "Dossier", fields: missing });
    }
    for (const d of payload.discovered) {
      const missing = d.entries
        .filter((e) => !isReportEntryComplete(e))
        .map((e) => PROFILE_FIELD_LABELS[e.fieldKey as ProfileFieldKey] ?? e.fieldKey);
      if (missing.length > 0) out.push({ where: d.firstName.trim() || "Ninja découvert", fields: missing });
    }
    return out;
  }, [payload, dossierTargets]);
  // Un dossier rattaché sans le moindre renseignement n'a rien à faire là
  const emptyLinked = linkedDossiers.filter((d) => d.entries.length === 0);
  const entriesOk = incompleteEntries.length === 0 && emptyLinked.length === 0;

  // ── Étape 3 : finalisation ──
  const finalize = () => {
    if (!canFinalize || isPending || finalizing.current) return;
    // Bloque immédiatement tout timer restant et place l'instantané courant
    // après les sauvegardes déjà parties. Si le dépôt échoue (ou demande
    // une confirmation de doublon), le dernier état affiché reste donc durable.
    finalizing.current = true;
    const snapshot = { ...payload, step: 2 };
    startTransition(async () => {
      const draftSaved = await enqueueDraftSave(snapshot);
      if (!draftSaved) {
        finalizing.current = false;
        // Sans ce message, le bouton semblerait ne rien faire : l'échec du
        // pré-enregistrement doit être dit là où l'utilisateur regarde.
        setError("Le rapport n'a pas pu être déposé : le brouillon ne s'enregistre plus. Corrigez-le puis réessayez.");
        return;
      }
      const fd = new FormData();
      fd.set("missionId", missionId);
      fd.set("groupId", groupId);
      fd.set("payload", JSON.stringify(snapshot));
      if (duplicateConfirmationToken) fd.set("duplicateConfirmationToken", duplicateConfirmationToken);
      for (const img of images) fd.append("images", img.file);
      const res = await finalizeMissionReportAction(fd);
      if (!res.ok) {
        finalizing.current = false;
        if (res.duplicates?.length) {
          setDuplicates(res.duplicates);
          setDuplicateConfirmationToken(res.duplicateConfirmationToken ?? "");
          setError(null);
          return;
        }
        setError(res.error ?? "La finalisation a échoué.");
        return;
      }
      finalized.current = true;
      images.forEach((i) => URL.revokeObjectURL(i.url));
      setDone(res.summary ?? null);
      router.refresh();
    });
  };

  if (done) {
    return (
      <div role="status" className="border border-gold bg-gold-faint/20 p-4 text-sm text-ink">
        <p className="font-display tracking-widest text-gold uppercase">Rapport final enregistré</p>
        <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
          <li>· {done.outcomesRecorded} sort(s) de cible consigné(s) dans votre rapport — la modération consolide le sort officiel</li>
          <li>
            · {done.contributions} renseignement(s) — {done.appliedDirectly} inscrit(s) directement,{" "}
            {done.contributions - done.appliedDirectly} en attente de la modération
          </li>
          {done.discoveredProfiles.length > 0 && (
            <li>
              · Nouveaux dossiers ouverts pour {groupName} :{" "}
              {done.discoveredProfiles.map((p) => `${p.firstName} (${p.code})`).join(", ")}
            </li>
          )}
        </ul>
        <p className="mt-2 text-[0.7rem] text-ink-faint">
          Les tisseurs sont prévenus ; la clôture de la mission et la prime relèvent d&rsquo;eux.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Fil d'étapes */}
      <ol className="flex flex-wrap gap-2" aria-label="Étapes du rapport">
        {STEPS.map((title, i) => (
          <li key={title}>
            <button
              type="button"
              onClick={() => goTo(i)}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 border px-3 py-1.5 text-xs ${
                i === step ? "border-gold text-gold" : "border-border-default text-ink-faint hover:text-ink"
              }`}
            >
              <span className="font-mono-toile">{i + 1}</span>
              {title}
            </button>
          </li>
        ))}
        <li className="ml-auto self-center font-mono-toile text-[0.65rem] text-ink-faint" aria-live="polite">
          {saving ? "Brouillon : enregistrement…" : saved ? `Brouillon enregistré ${new Date(saved).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Brouillon : rien à enregistrer"}
        </li>
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          {targets.length > 0 && (
            <fieldset>
              <legend className={labelCls}>Sort de chaque cible</legend>
              <ul className="space-y-2">
                {targets.map((t) => {
                  const o = payload.outcomes.find((x) => x.targetId === t.id);
                  return (
                    <li key={t.id} className="grid gap-2 border border-border-default bg-elevated p-3 sm:grid-cols-[1fr_12rem]">
                      <div>
                        <p className="text-sm text-ink">
                          {t.name}
                          {t.code && <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{t.code}</span>}
                        </p>
                        <input
                          aria-label={`Précision sur ${t.name}`}
                          placeholder="Précision (facultative)"
                          className={`${input} mt-1`}
                          maxLength={1000}
                          value={o?.note ?? ""}
                          onChange={(e) => setOutcome(t.id, { note: e.target.value })}
                        />
                      </div>
                      <select
                        aria-label={`Sort de ${t.name}`}
                        className={input}
                        value={o?.outcome ?? "UNKNOWN"}
                        onChange={(e) => setOutcome(t.id, { outcome: e.target.value })}
                      >
                        {MISSION_TARGET_OUTCOMES.map((v) => <option key={v} value={v}>{MISSION_TARGET_OUTCOME_LABELS[v]}</option>)}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <div>
            <label htmlFor="rw-summary" className={labelCls}>Résumé de la mission *</label>
            <textarea
              id="rw-summary"
              rows={5}
              maxLength={20_000}
              className={input}
              placeholder="Ce qui a été vu, fait, et ce qu'il en coûte…"
              value={payload.summary}
              onChange={(e) => update((p) => ({ ...p, summary: e.target.value }))}
            />
            <p className="mt-1 text-[0.65rem] text-ink-faint">{payload.summary.trim().length} caractères — 10 minimum.</p>
          </div>
          <div>
            <p className={labelCls}>Preuves (facultatives)</p>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => addImages(e.target.files)} />
            {images.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {images.map((img, i) => (
                  <li key={img.url} className="relative border border-border-default bg-elevated p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Preuve ${i + 1}`} className="h-20 w-20 object-cover" />
                    <button type="button" aria-label={`Retirer la preuve ${i + 1}`}
                      onClick={() => setImages((c) => { URL.revokeObjectURL(img.url); return c.filter((_, j) => j !== i); })}
                      className="absolute -right-2 -top-2 h-5 w-5 border border-blood bg-base text-[0.6rem] leading-none text-blood-bright">✕</button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={images.length >= REPORT_IMAGES_MAX}
              className="border border-border-default px-2 py-1 text-xs text-ink-muted hover:border-gold hover:text-gold disabled:opacity-50">
              + Joindre des images
            </button>
            <span className="ml-2 text-[0.65rem] text-ink-faint">{images.length}/{REPORT_IMAGES_MAX} — les preuves ne sont pas conservées dans le brouillon</span>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {dossierTargets.length === 0 && payload.discovered.length === 0 && (
            <p className="text-xs text-ink-faint italic">
              Cette mission ne vise aucun dossier. Si vous avez croisé quelqu&rsquo;un, déclarez-le ci-dessous.
            </p>
          )}
          {dossierTargets.map((t) => (
            <DossierBlock
              key={t.id}
              title={t.name}
              code={t.code}
              profileId={t.profileId}
              currentValues={t.canViewDossier ? (t.currentValues ?? null) : null}
              dossier={dossierOf(t.profileId)}
              onChange={(patch) => setDossier(t.profileId, patch)}
              refs={refs}
            />
          ))}
          {linkedDossiers.map((d) => (
            <DossierBlock
              key={`linked-${d.profileId}`}
              title={d.name || "Dossier rattaché"}
              code={d.code ?? null}
              profileId={d.profileId}
              linked
              onRemove={() => removeLinked(d.profileId)}
              dossier={d}
              onChange={(patch) => setDossier(d.profileId, patch)}
              refs={refs}
            />
          ))}
          <LinkExistingDossier
            excludeIds={[...dossierTargets.map((t) => t.profileId), ...linkedDossiers.map((d) => d.profileId)]}
            onPick={(profile) => addLinked(profile)}
          />
          {payload.discovered.map((d) => (
            <div key={d.localId} className="border border-gold-dim bg-raised p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-xs tracking-widest text-gold uppercase">Ninja découvert</p>
                <button type="button" onClick={() => removeDiscovered(d.localId)} className="text-[0.7rem] text-ink-faint underline hover:text-blood-bright">retirer</button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input aria-label="Prénom" placeholder="Prénom *" className={input} maxLength={80} value={d.firstName} onChange={(e) => setDiscovered(d.localId, { firstName: e.target.value })} />
                <input aria-label="Nom" placeholder="Nom (facultatif)" className={input} maxLength={80} value={d.lastName ?? ""} onChange={(e) => setDiscovered(d.localId, { lastName: e.target.value })} />
                <select aria-label="Sort" className={input} value={d.outcome} onChange={(e) => setDiscovered(d.localId, { outcome: e.target.value as never })}>
                  {MISSION_TARGET_OUTCOMES.map((v) => <option key={v} value={v}>{MISSION_TARGET_OUTCOME_LABELS[v]}</option>)}
                </select>
              </div>
              <p className="mt-1 text-[0.65rem] text-ink-faint">
                Un dossier sera ouvert pour {groupName} — ce que vous notez ici y sera inscrit directement.
              </p>
              <div className="mt-2">
                <EntriesEditor entries={d.entries} onChange={(entries) => setDiscovered(d.localId, { entries })} refs={refs} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addDiscovered}>+ Ninja découvert</Button>
          {untreated.length > 0 && (
            <p className="text-xs text-warning">
              {untreated.length} dossier(s) encore sans réponse : ajoutez un renseignement ou cochez « Aucune nouvelle information ».
            </p>
          )}
          {incompleteEntries.length > 0 && (
            <p className="text-xs text-warning">
              Champs ajoutés sans valeur :{" "}
              {incompleteEntries.map((x) => `${x.where} (${x.fields.join(", ")})`).join(" · ")}.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <dl className="space-y-1 text-xs text-ink-muted">
            <div><dt className="inline text-ink-faint">Mission : </dt><dd className="inline font-mono-toile text-ink">{missionCode}</dd></div>
            <div><dt className="inline text-ink-faint">Au nom de : </dt><dd className="inline text-ink">{groupName}</dd></div>
            <div><dt className="inline text-ink-faint">Sorts consignés : </dt><dd className="inline">{payload.outcomes.filter((o) => o.outcome !== "UNKNOWN").length}/{targets.length}</dd></div>
            <div><dt className="inline text-ink-faint">Renseignements : </dt>
              <dd className="inline">{payload.dossiers.reduce((n, d) => n + d.entries.length, 0) + payload.discovered.reduce((n, d) => n + d.entries.length, 0)}</dd></div>
            <div><dt className="inline text-ink-faint">Dossiers « rien de neuf » : </dt><dd className="inline">{payload.dossiers.filter((d) => d.noNewInfo && d.entries.length === 0).length}</dd></div>
            <div><dt className="inline text-ink-faint">Ninjas découverts : </dt><dd className="inline">{payload.discovered.length}</dd></div>
            <div><dt className="inline text-ink-faint">Preuves : </dt><dd className="inline">{images.length}</dd></div>
          </dl>
          <ul className="space-y-0.5 text-xs">
            {!summaryOk && <li className="text-warning">· Le résumé (étape 1) doit faire au moins 10 caractères.</li>}
            {untreated.length > 0 && <li className="text-warning">· {untreated.length} dossier(s) non traité(s) à l&rsquo;étape 2.</li>}
            {!discoveredOk && <li className="text-warning">· Un ninja découvert n&rsquo;a pas de prénom.</li>}
            {incompleteEntries.map((x) => (
              <li key={x.where} className="text-warning">
                · {x.where} : valeur manquante pour {x.fields.join(", ")} (étape 2).
              </li>
            ))}
            {emptyLinked.length > 0 && (
              <li className="text-warning">
                · Un dossier rattaché n&rsquo;a aucun renseignement : ajoutez-en ou retirez-le (étape 2).
              </li>
            )}
          </ul>
          {duplicates.length > 0 && (
            <div className="border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
              <p className="font-medium">Des dossiers ressemblants existent déjà :</p>
              <ul className="mt-1 space-y-1.5">
                {duplicates.map((d) => {
                  const block = payload.discovered.find((x) => x.localId === d.localId);
                  return (
                    <li key={d.localId}>
                      · {block?.firstName}
                      <span className="mt-0.5 flex flex-wrap gap-1.5">
                        {d.matches.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            // « C'est lui » : le bloc découvert devient un
                            // rattachement au dossier existant — les
                            // renseignements saisis sont conservés.
                            onClick={() => {
                              if (!block) return;
                              const [firstName, ...rest] = m.name.split(" ");
                              update((p) => ({
                                ...p,
                                discovered: p.discovered.filter((x) => x.localId !== d.localId),
                              }));
                              addLinked(
                                { id: m.id, code: m.code, firstName: firstName ?? m.name, lastName: rest.join(" ") || null },
                                block.entries,
                              );
                            }}
                            className="border border-warning/60 px-1.5 py-0.5 text-[0.65rem] hover:border-gold hover:text-gold"
                          >
                            C&rsquo;est {m.code} {m.name}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1.5">
                S&rsquo;il s&rsquo;agit de la même personne, cliquez sur son dossier ci-dessus : vos renseignements y
                seront proposés. Sinon, confirmez la création.
              </p>
            </div>
          )}
          <p className="text-[0.7rem] text-ink-faint">
            Tout est enregistré d&rsquo;un bloc : rapport, sorts, renseignements, nouveaux dossiers. En cas d&rsquo;échec, rien n&rsquo;est écrit et votre brouillon reste.
          </p>
        </div>
      )}

      {draftError && <p role="status" className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">Brouillon non enregistré : {draftError}</p>}
      {error && <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">{error}</p>}
      {step === 2 && !canFinalize && (
        <p role="status" className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          Le brouillon est prêt. La mission doit d&rsquo;abord être marquée « en cours » avant le dépôt final.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {step > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => goTo(step - 1)}>← Précédent</Button>}
          {saved !== null && (
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              if (!window.confirm("Effacer le brouillon de ce rapport ?")) return;
              finalizing.current = true;
              startTransition(async () => {
                await saveChain.current;
                const res = await discardMissionReportDraftAction({ missionId, groupId });
                if (!res.ok) {
                  finalizing.current = false;
                  setError(res.error ?? "Le brouillon n'a pas pu être effacé.");
                  return;
                }
                setPayload({
                  ...EMPTY_REPORT_PAYLOAD,
                  outcomes: targets.map((target) => ({
                    targetId: target.id,
                    outcome: (target.outcome as never) ?? "UNKNOWN",
                  })),
                });
                setStep(0);
                setSaved(null);
                setDraftError(null);
                setDuplicates([]);
                setDuplicateConfirmationToken("");
                dirty.current = false;
                finalizing.current = false;
                router.refresh();
              });
            }}>Effacer le brouillon</Button>
          )}
        </div>
        {step < 2 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => goTo(step + 1)}>Suivant →</Button>
        ) : (
          <Button
            type="button"
            variant="gold"
            onClick={() => finalize()}
            disabled={!canFinalize || isPending || !summaryOk || untreated.length > 0 || !discoveredOk || !entriesOk}
          >
            {isPending
              ? "Enregistrement…"
              : duplicates.length > 0
                ? "Confirmer et terminer le rapport"
                : "Terminer la mission et enregistrer les renseignements"}
          </Button>
        )}
      </div>
    </div>
  );
}

function DossierBlock({
  title,
  code,
  profileId,
  dossier,
  onChange,
  refs,
  currentValues,
  linked = false,
  onRemove,
}: {
  title: string;
  code: string | null;
  profileId: string;
  dossier: { profileId: string; noNewInfo: boolean; entries: ReportIntelEntry[] };
  onChange: (patch: Partial<{ noNewInfo: boolean; entries: ReportIntelEntry[] }>) => void;
  refs: IntelRefs;
  /**
   * Libellés courants des champs (§41). `null` = dossier confidentiel pour ce
   * groupe (« Valeur actuelle : Confidentielle ») ; `undefined` = ne pas
   * afficher la ligne (dossier rattaché à la main, état inconnu du client).
   */
  currentValues?: Record<string, string> | null;
  /** Dossier existant rattaché par l'équipe (pas une cible officielle) */
  linked?: boolean;
  onRemove?: () => void;
}) {
  const treated = dossier.noNewInfo || dossier.entries.length > 0;
  const count = dossier.entries.length;
  // Ouvert au CHARGEMENT si non traité, puis la carte appartient à
  // l'utilisateur : un prop `open` réactif refermerait la carte à la première
  // information saisie, en plein milieu de l'édition.
  const [initiallyOpen] = useState(!treated);
  return (
    /* Carte repliable : une mission à cinq cibles reste lisible. Le résumé
       dit tout (✓, compte) même repliée. */
    <details
      {...(initiallyOpen ? { open: true } : {})}
      className={`border ${treated ? "border-gold-dim bg-raised" : "border-border-default bg-raised"}`}
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3">
        <span className="text-sm text-ink">
          {treated && <span aria-hidden className="mr-1.5 text-gold">✓</span>}
          {title}
          {code && <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{code}</span>}
          {linked && (
            <span className="ml-2 border border-copper/50 px-1 text-[0.6rem] uppercase tracking-wider text-copper">
              rattaché
            </span>
          )}
        </span>
        <span className="text-[0.7rem] text-ink-faint">
          {dossier.noNewInfo
            ? "Aucune nouvelle information"
            : count > 0
              ? `${count} information${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""}`
              : "À traiter"}
        </span>
      </summary>
      <div className="border-t border-border-default/60 p-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href={`/profils/${profileId}`}
            className="font-mono-toile text-[0.7rem] text-gold underline-offset-2 hover:underline"
          >
            諜 Voir le dossier
          </Link>
          <span className="flex items-center gap-3">
            {!linked && (
              <label className="flex min-h-[2rem] items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={dossier.noNewInfo}
                  // Cocher « rien de neuf » vide les entrées : pas d'ambiguïté à l'envoi
                  onChange={(e) => onChange(e.target.checked ? { noNewInfo: true, entries: [] } : { noNewInfo: false })}
                />
                Aucune nouvelle information
              </label>
            )}
            {linked && onRemove && (
              <button type="button" onClick={onRemove} className="text-[0.7rem] text-ink-faint underline hover:text-blood-bright">
                retirer ce dossier
              </button>
            )}
          </span>
        </div>
        {!dossier.noNewInfo && (
          <div className="mt-2">
            <EntriesEditor
              entries={dossier.entries}
              onChange={(entries) => onChange({ entries })}
              refs={refs}
              currentValues={currentValues}
            />
          </div>
        )}
      </div>
    </details>
  );
}

/** Liste d'entrées (champ → valeur) avec « + Ajouter un champ ». */
function EntriesEditor({
  entries,
  onChange,
  refs,
  currentValues,
}: {
  entries: ReportIntelEntry[];
  onChange: (entries: ReportIntelEntry[]) => void;
  refs: IntelRefs;
  /** cf. DossierBlock — null = confidentiel, undefined = ne rien afficher */
  currentValues?: Record<string, string> | null;
}) {
  const [picking, setPicking] = useState(false);
  const setEntry = (i: number, patch: Partial<ReportIntelEntry>) =>
    onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const remove = (i: number) => onChange(entries.filter((_, j) => j !== i));
  const usedKeys = new Set(entries.map((e) => e.fieldKey));
  return (
    <div className="space-y-2">
      {entries.map((e, i) => {
        const complete = isReportEntryComplete(e);
        return (
        <div key={`${e.fieldKey}-${i}`} className={`border bg-elevated p-2 ${complete ? "border-border-default" : "border-warning/60"}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gold">
              {PROFILE_FIELD_LABELS[e.fieldKey as ProfileFieldKey]}
              {!complete && <span className="ml-2 text-[0.65rem] normal-case text-warning">valeur manquante</span>}
            </p>
            <button type="button" onClick={() => remove(i)} className="min-h-[1.75rem] text-xs text-ink-faint underline hover:text-blood-bright">retirer</button>
          </div>
          {/* §41 : ce que la Toile sait déjà — jamais la valeur d'un dossier
              que le groupe ne possède pas (le serveur ne l'a pas envoyée). */}
          {currentValues !== undefined && (
            <p className="mt-0.5 text-[0.65rem] text-ink-faint">
              Valeur actuelle :{" "}
              {currentValues === null ? (
                <span className="font-mono-toile text-gold-dim">Confidentielle</span>
              ) : (
                <span className="text-ink-muted">{currentValues[e.fieldKey] ?? "Inconnu"}</span>
              )}
            </p>
          )}
          {canDeclareNone(e.fieldKey as ProfileFieldKey) && (
            <label className="mt-1 flex min-h-[1.75rem] items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={e.knowledgeState === "NONE_CONFIRMED"}
                onChange={(ev) => setEntry(i, { knowledgeState: ev.target.checked ? "NONE_CONFIRMED" : "KNOWN", value: undefined })} />
              Vérifié : il n&rsquo;y en a pas
            </label>
          )}
          {e.knowledgeState !== "NONE_CONFIRMED" && (
            <div className="mt-1">
              <IntelValueEditor fieldKey={e.fieldKey as ProfileFieldKey} value={e.value} onChange={(value) => setEntry(i, { value })} refs={refs} />
              {LIST_FIELD_KEYS.includes(e.fieldKey as ProfileFieldKey) && (
                <p className="mt-0.5 text-[0.6rem] text-ink-faint">Ajoute à la liste — ne retire rien.</p>
              )}
            </div>
          )}
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <select aria-label="Confiance" className={`${input} py-1`} value={e.confidence ?? "PROBABLE"} onChange={(ev) => setEntry(i, { confidence: ev.target.value as never })}>
              <option value="RUMOR">Rumeur</option>
              <option value="UNCONFIRMED">Non confirmé</option>
              <option value="PROBABLE">Probable</option>
              <option value="CONFIRMED">Confirmé</option>
            </select>
            <input aria-label="Précision" placeholder="Source / précision (facultatif)" className={`${input} py-1`} maxLength={2000}
              value={e.note ?? ""} onChange={(ev) => setEntry(i, { note: ev.target.value })} />
          </div>
        </div>
        );
      })}
      {picking ? (
        <div className="border border-border-gold bg-elevated p-2">
          {INTEL_PALETTE.map((section) => (
            <div key={section.title} className="mb-1.5">
              <p className="text-[0.6rem] uppercase tracking-wider text-ink-faint">{section.title}</p>
              <div className="flex flex-wrap gap-1">
                {/* Un champ déjà présent disparaît de la palette : le schéma
                    refuse les doublons, et un doublon gelait tout le brouillon. */}
                {section.keys
                  .filter((k) => CONTRIBUTABLE_FIELD_KEYS.includes(k) && !usedKeys.has(k))
                  .map((k) => (
                  <button key={k} type="button"
                    onClick={() => { onChange([...entries, { fieldKey: k, knowledgeState: "KNOWN", confidence: "PROBABLE" }]); setPicking(false); }}
                    className="min-h-[1.9rem] border border-border-default px-2 py-0.5 text-xs text-ink-muted hover:border-gold hover:text-gold">
                    {PROFILE_FIELD_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setPicking(false)} className="text-xs text-ink-faint underline">annuler</button>
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} className="min-h-[2rem] border border-border-default px-2 py-1 text-xs text-ink-muted hover:border-gold hover:text-gold">
          + Ajouter un champ
        </button>
      )}
    </div>
  );
}

/**
 * « Ninja croisé, dossier existant » : la même recherche publique que
 * l'association de cible — code, titre, prénom, nom, rien d'autre. Rattacher
 * un dossier n'en révèle pas le contenu : les renseignements saisis partent
 * en revue si le groupe ne le possède pas.
 */
function LinkExistingDossier({
  excludeIds,
  onPick,
}: {
  excludeIds: string[];
  onPick: (profile: { id: string; code: string; firstName: string; lastName?: string | null }) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; code: string; firstName: string; lastName?: string | null }[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profils/recherche?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (res.ok) setResults(await res.json());
      } catch {
        // Frappe suivante : requête annulée
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const visible = results.filter((r) => !excludeIds.includes(r.id));
  return (
    <div className="border border-dashed border-border-default p-3">
      <label htmlFor="rw-link-search" className={labelCls}>
        Ninja croisé qui a déjà un dossier ? Rattachez-le au rapport
      </label>
      <input
        id="rw-link-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Prénom, nom ou code (PRF-…)"
        autoComplete="off"
        className={input}
      />
      {visible.length > 0 && (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
          {visible.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(profile);
                  setQuery("");
                  setResults([]);
                }}
                className="w-full px-2 py-1 text-left text-xs text-ink-muted hover:bg-hover-bg hover:text-gold"
              >
                {[profile.firstName, profile.lastName].filter(Boolean).join(" ")}
                <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{profile.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
