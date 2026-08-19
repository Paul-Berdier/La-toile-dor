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
import { CONTRIBUTION_VALUE_SCHEMAS } from "./profile-contributions";

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

/** Une information apprise sur UN champ d'UN dossier. */
export const reportIntelEntrySchema = z
  .object({
    fieldKey: z.enum(PROFILE_FIELD_KEYS),
    knowledgeState: z.enum(["KNOWN", "NONE_CONFIRMED"]).default("KNOWN"),
    value: z.unknown().optional(),
    confidence: confidenceSchema.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((entry, ctx) => {
    const schema = CONTRIBUTION_VALUE_SCHEMAS[entry.fieldKey];
    if (!schema) {
      ctx.addIssue({ code: "custom", path: ["fieldKey"], message: "Ce champ ne se renseigne pas par rapport." });
      return;
    }
    if (entry.knowledgeState === "NONE_CONFIRMED") return;
    const res = schema.safeParse(entry.value);
    if (!res.success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: res.error.errors[0]?.message ?? "Valeur invalide." });
    }
  });
export type ReportIntelEntry = z.infer<typeof reportIntelEntrySchema>;

/** Ce qu'on rapporte sur un dossier existant (cible de la mission). */
export const reportDossierSchema = z.object({
  profileId: cuid,
  /** « Aucune nouvelle information » — un clic, et le dossier est traité */
  noNewInfo: z.boolean().default(false),
  entries: z.array(reportIntelEntrySchema).max(40).default([]),
});

/** Un ninja croisé en mission qui n'avait pas de dossier : on lui en ouvre un. */
export const reportDiscoveredSchema = z.object({
  /** Identifiant local (client) pour retrouver le bloc dans le brouillon */
  localId: z.string().min(1).max(40),
  firstName: z.string().trim().min(1, "Le prénom est obligatoire.").max(80),
  lastName: z.string().trim().max(80).optional(),
  title: z.string().trim().max(120).optional(),
  /** Sort constaté — le nouveau dossier devient cible de la mission */
  outcome: z.enum(MISSION_TARGET_OUTCOMES).default("UNKNOWN"),
  entries: z.array(reportIntelEntrySchema).max(40).default([]),
});

export const missionReportPayloadSchema = z.object({
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
export type MissionReportPayload = z.infer<typeof missionReportPayloadSchema>;

/** Ce qu'il faut pour finaliser : le brouillon, plus un résumé suffisant. */
export const missionReportFinalizeSchema = missionReportPayloadSchema.extend({
  missionId: cuid,
  summary: z
    .string()
    .trim()
    .min(10, "Le résumé doit contenir au moins 10 caractères.")
    .max(20_000),
});
export type MissionReportFinalizeInput = z.infer<typeof missionReportFinalizeSchema>;

export const EMPTY_REPORT_PAYLOAD: MissionReportPayload = {
  outcomes: [],
  summary: "",
  dossiers: [],
  discovered: [],
  step: 0,
};

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
