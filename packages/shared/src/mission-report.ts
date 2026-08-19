/**
 * Rapport de fin de mission — contrat partagé du parcours en trois étapes :
 *   1. Résultat     : sort de chaque cible, résumé, preuves ;
 *   2. Renseignement: par dossier, ce qu'on a appris (ou « rien de neuf »),
 *                     et les ninjas découverts (nouveaux dossiers) ;
 *   3. Validation   : « Terminer la mission et enregistrer les renseignements ».
 *
 * Le MÊME objet sert de brouillon (sauvegardé au fil de l'eau) et de charge
 * finale — un brouillon valide est finalisable tel quel.
 */
import { z } from "zod";
import { PROFILE_FIELD_KEYS } from "./profile-fields";
import { confidenceSchema } from "./profile-schemas";
import { CONTRIBUTION_VALUE_SCHEMAS, canDeclareNoneForField } from "./profile-contributions";

export const MISSION_TARGET_OUTCOMES = [
  "UNKNOWN", "ELIMINATED", "CAPTURED", "ESCAPED", "UNHARMED", "MISSING",
] as const;
export type MissionTargetOutcome = (typeof MISSION_TARGET_OUTCOMES)[number];

export const MISSION_TARGET_OUTCOME_LABELS: Record<MissionTargetOutcome, string> = {
  UNKNOWN: "Sort inconnu",
  ELIMINATED: "Éliminée",
  CAPTURED: "Capturée vivante",
  ESCAPED: "En fuite",
  UNHARMED: "Épargnée ou jamais atteinte",
  MISSING: "Disparue",
};

const cuid = z.string().cuid();
const MAX_ENTRY_JSON_CHARS = 20_000;
const MAX_DRAFT_JSON_CHARS = 250_000;

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Une information apprise sur UN champ d'UN dossier. */
export const reportIntelEntrySchema = z
  .object({
    fieldKey: z.enum(PROFILE_FIELD_KEYS),
    knowledgeState: z.enum(["KNOWN", "NONE_CONFIRMED"]).default("KNOWN"),
    // Un brouillon accepte une valeur encore incomplète (le champ vient juste
    // d'être ajouté), mais jamais une charge arbitrairement volumineuse.
    value: z.unknown().refine((v) => jsonSize(v) <= MAX_ENTRY_JSON_CHARS, "Valeur trop volumineuse.").optional(),
    confidence: confidenceSchema.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((entry, ctx) => {
    const schema = CONTRIBUTION_VALUE_SCHEMAS[entry.fieldKey];
    if (!schema) {
      ctx.addIssue({ code: "custom", path: ["fieldKey"], message: "Ce champ ne se renseigne pas par rapport." });
      return;
    }
    if (entry.knowledgeState === "NONE_CONFIRMED") {
      if (!canDeclareNoneForField(entry.fieldKey)) {
        ctx.addIssue({ code: "custom", path: ["knowledgeState"], message: "Ce champ ne se déclare pas « absent »." });
      }
      return;
    }
    // La valeur stricte est contrôlée à la FINALISATION. Le brouillon doit
    // pouvoir conserver le bloc dès son ajout, avant la première saisie.
  });
export type ReportIntelEntry = z.infer<typeof reportIntelEntrySchema>;

/** Ce qu'on rapporte sur un dossier existant (cible de la mission). */
function addUniqueEntryIssues(
  entries: readonly { fieldKey: string }[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.fieldKey)) {
      ctx.addIssue({ code: "custom", path: ["entries", index, "fieldKey"], message: "Ce champ est déjà renseigné." });
    }
    seen.add(entry.fieldKey);
  });
}

export const reportDossierSchema = z
  .object({
    profileId: cuid,
    /** « Aucune nouvelle information » — un clic, et le dossier est traité */
    noNewInfo: z.boolean().default(false),
    entries: z.array(reportIntelEntrySchema).max(40).default([]),
    /**
     * Dossier EXISTANT rattaché par l'équipe elle-même (pas une cible de la
     * mission) — un ninja croisé qui avait déjà sa fiche. Les renseignements
     * passent alors par la revue, sauf si le groupe possède le dossier. Le
     * nom et le code ne servent qu'à réafficher le bloc depuis le brouillon :
     * ce sont des valeurs PUBLIQUES, jamais une source de vérité.
     */
    linked: z.boolean().optional(),
    name: z.string().trim().max(160).optional(),
    code: z.string().trim().max(20).optional(),
  })
  .superRefine((dossier, ctx) => {
    addUniqueEntryIssues(dossier.entries, ctx);
    if (dossier.noNewInfo && dossier.entries.length > 0) {
      ctx.addIssue({ code: "custom", path: ["entries"], message: "« Rien de neuf » ne peut pas contenir de renseignements." });
    }
  });

/** Un ninja croisé en mission qui n'avait pas de dossier : on lui en ouvre un. */
export const reportDiscoveredSchema = z
  .object({
    /** Identifiant local (client) pour retrouver le bloc dans le brouillon */
    localId: z.string().min(1).max(40),
    // Vide autorisé dans le BROUILLON immédiatement après « + Ninja » ; la
    // finalisation impose le prénom.
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80).optional(),
    title: z.string().trim().max(120).optional(),
    /** Sort constaté — conservé dans la trace de mission du nouveau dossier */
    outcome: z.enum(MISSION_TARGET_OUTCOMES).default("UNKNOWN"),
    entries: z.array(reportIntelEntrySchema).max(40).default([]),
  })
  .superRefine((discovered, ctx) => addUniqueEntryIssues(discovered.entries, ctx));

const missionReportPayloadObject = z.object({
  /** Étape 1 */
  outcomes: z
    .array(
      z.object({
        targetId: cuid,
        outcome: z.enum(MISSION_TARGET_OUTCOMES),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .max(50)
    .default([]),
  summary: z.string().trim().max(20_000).default(""),
  /** Étape 2 */
  dossiers: z.array(reportDossierSchema).max(50).default([]),
  discovered: z.array(reportDiscoveredSchema).max(20).default([]),
  /** Étape atteinte (pour rouvrir le brouillon au bon endroit) */
  step: z.number().int().min(0).max(2).default(0),
});

export const missionReportPayloadSchema = missionReportPayloadObject.superRefine((payload, ctx) => {
  const unique = <T>(rows: readonly T[], key: (row: T) => string, path: string, message: string) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const value = key(row);
      if (seen.has(value)) ctx.addIssue({ code: "custom", path: [path, index], message });
      seen.add(value);
    });
  };
  unique(payload.outcomes, (o) => o.targetId, "outcomes", "Cette cible est répétée.");
  unique(payload.dossiers, (d) => d.profileId, "dossiers", "Ce dossier est répété.");
  unique(payload.discovered, (d) => d.localId, "discovered", "Ce ninja découvert est répété.");
  if (jsonSize(payload) > MAX_DRAFT_JSON_CHARS) {
    ctx.addIssue({ code: "custom", message: "Le brouillon est trop volumineux." });
  }
});
export type MissionReportPayload = z.infer<typeof missionReportPayloadSchema>;

/** Ce qu'il faut pour finaliser : le brouillon, plus un résumé suffisant. */
export const missionReportFinalizeSchema = z
  .object({
    missionId: cuid,
    outcomes: missionReportPayloadObject.shape.outcomes,
    summary: z.string().trim().min(10, "Le résumé doit contenir au moins 10 caractères.").max(20_000),
    dossiers: missionReportPayloadObject.shape.dossiers,
    discovered: missionReportPayloadObject.shape.discovered,
    step: missionReportPayloadObject.shape.step,
  })
  .superRefine((payload, ctx) => {
    if (!missionReportPayloadSchema.safeParse(payload).success) {
      ctx.addIssue({ code: "custom", message: "Le contenu du rapport est invalide." });
      return;
    }
    const validateEntries = (entries: readonly ReportIntelEntry[], path: (string | number)[]) => {
      entries.forEach((entry, index) => {
        if (entry.knowledgeState === "NONE_CONFIRMED") return;
        const schema = CONTRIBUTION_VALUE_SCHEMAS[entry.fieldKey];
        const result = schema?.safeParse(entry.value);
        if (!result?.success) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "value"],
            message: result?.error.errors[0]?.message ?? "Valeur invalide.",
          });
        }
      });
    };
    payload.dossiers.forEach((d, index) => validateEntries(d.entries, ["dossiers", index, "entries"]));
    payload.discovered.forEach((d, index) => {
      if (!d.firstName.trim()) {
        ctx.addIssue({ code: "custom", path: ["discovered", index, "firstName"], message: "Le prénom est obligatoire." });
      }
      validateEntries(d.entries, ["discovered", index, "entries"]);
    });
  });
export type MissionReportFinalizeInput = z.infer<typeof missionReportFinalizeSchema>;

/**
 * Nettoie les valeurs déjà valides avant stockage du brouillon. Les valeurs
 * partielles restent telles quelles pour pouvoir reprendre la saisie ; une
 * valeur finale, elle, est parsée à nouveau avant toute écriture métier.
 */
export function sanitizeMissionReportPayload(payload: MissionReportPayload): MissionReportPayload {
  const cleanEntry = (entry: ReportIntelEntry): ReportIntelEntry => {
    if (entry.knowledgeState === "NONE_CONFIRMED") return { ...entry, value: undefined };
    const parsed = CONTRIBUTION_VALUE_SCHEMAS[entry.fieldKey]?.safeParse(entry.value);
    return parsed?.success ? { ...entry, value: parsed.data } : entry;
  };
  return {
    ...payload,
    dossiers: payload.dossiers.map((d) => ({ ...d, entries: d.entries.map(cleanEntry) })),
    discovered: payload.discovered.map((d) => ({ ...d, entries: d.entries.map(cleanEntry) })),
  };
}

export const EMPTY_REPORT_PAYLOAD: MissionReportPayload = {
  outcomes: [],
  summary: "",
  dossiers: [],
  discovered: [],
  step: 0,
};

/**
 * Une entrée est-elle COMPLÈTE, c'est-à-dire finalisable telle quelle ? Le
 * brouillon accepte une valeur encore vide (le champ vient d'être ajouté) ;
 * le client s'en sert pour signaler ce qui manque AVANT d'essayer de déposer,
 * au lieu de laisser le serveur répondre « Required ».
 */
export function isReportEntryComplete(entry: ReportIntelEntry): boolean {
  if (entry.knowledgeState === "NONE_CONFIRMED") return canDeclareNoneForField(entry.fieldKey);
  const schema = CONTRIBUTION_VALUE_SCHEMAS[entry.fieldKey];
  return Boolean(schema?.safeParse(entry.value).success);
}

/**
 * Chaque dossier cible doit avoir été TRAITÉ : soit « rien de neuf », soit au
 * moins une information. On ne ferme pas une mission en laissant un dossier
 * dans le vague — c'est ce renseignement que la Toile revend.
 */
export function untreatedDossiers(
  payload: MissionReportPayload,
  targetProfileIds: readonly string[],
): string[] {
  const treated = new Set(
    payload.dossiers.filter((d) => d.noNewInfo || d.entries.length > 0).map((d) => d.profileId),
  );
  return targetProfileIds.filter((id) => !treated.has(id));
}
