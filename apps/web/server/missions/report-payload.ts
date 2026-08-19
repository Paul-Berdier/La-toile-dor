import {
  sanitizeMissionReportPayload,
  type MissionReportFinalizeInput,
  type MissionReportPayload,
} from "@toile/shared";

/**
 * Forme JSON immuable conservée avec un rapport final.
 *
 * La mission et le groupe sont portés par les relations du rapport : le JSON
 * ne contient que l'observation structurée qui pourra être relue ou comparée
 * aux rapports des autres groupes.
 */
export function toStoredMissionReportPayload(
  input: MissionReportFinalizeInput,
): MissionReportPayload {
  return sanitizeMissionReportPayload({
    outcomes: input.outcomes,
    summary: input.summary,
    dossiers: input.dossiers,
    discovered: input.discovered,
    step: input.step,
  });
}
