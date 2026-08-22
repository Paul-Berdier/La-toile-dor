/**
 * Gabarits des messages privés — UNIQUEMENT des données publiques
 * (code, rang, titre public, libellés). Jamais de cible, lieu ou commanditaire.
 */

export interface NotificationPayload {
  code?: string;
  rank?: string;
  title?: string;
  category?: string;
  fromStatus?: string;
  toStatus?: string;
  groupName?: string;
  note?: string | null;
  warnings?: number;
  [key: string]: unknown;
}

const appUrl = () => process.env.APP_URL ?? "";

function missionLine(payload: NotificationPayload): string {
  return `**[${payload.rank ?? "?"}] ${payload.code ?? ""}** — ${payload.title ?? "Contrat"}`;
}

export function formatNotification(event: string, payload: NotificationPayload): string {
  const lines: string[] = [];
  let destination = "/missions";
  switch (event) {
    case "MISSION_AVAILABLE":
      lines.push("🕸️ **Un nouveau fil vient d'être tendu sur la Toile.**", missionLine(payload));
      break;
    case "CLAIM_ACCEPTED":
      lines.push("✅ **Votre revendication a été acceptée.** Le dossier complet vous attend.", missionLine(payload));
      break;
    case "CLAIM_REJECTED":
      lines.push("❌ **Votre revendication a été refusée.**", missionLine(payload));
      if (payload.note) lines.push(`Note du tisseur : ${payload.note}`);
      break;
    case "CLAIM_INFO_REQUESTED":
      lines.push("❓ **Le tisseur demande des précisions sur votre revendication.**", missionLine(payload));
      if (payload.note) lines.push(`Note : ${payload.note}`);
      break;
    case "MISSION_STATUS_CHANGED":
      lines.push("🧵 **Le statut d'un contrat suivi a changé.**", missionLine(payload), `${payload.fromStatus} → ${payload.toStatus}`);
      break;
    case "MISSION_DEADLINE_SOON":
      lines.push("⏳ **Un délai approche.**", missionLine(payload));
      break;
    case "MISSION_EXPIRED":
      lines.push("🕯️ **Un contrat a expiré.**", missionLine(payload));
      break;
    case "MISSION_CANCELLED":
      lines.push("✂️ **Un fil a été rompu — contrat annulé.**", missionLine(payload));
      break;
    case "MISSION_UPDATED":
      lines.push("📜 **Le dossier d'un contrat attribué a été mis à jour.**", missionLine(payload));
      break;
    case "NEW_CLAIM":
      lines.push(
        "📥 **Nouvelle revendication à examiner.**",
        missionLine(payload),
        payload.groupName ? `Cellule : ${payload.groupName}` : "",
        payload.warnings ? `⚠ ${payload.warnings} avertissement(s) d'éligibilité` : "",
      );
      break;
    case "CLAIM_WITHDRAWN":
      lines.push("↩️ **Une cellule retire sa revendication.**", missionLine(payload));
      break;
    case "FINAL_REPORT_SUBMITTED":
      lines.push("🖋️ **Rapport final transmis.**", missionLine(payload));
      break;
    case "SYNC_ISSUE":
      lines.push("⚠️ **Problème de synchronisation Discord détecté.**");
      break;
    case "ACCESS_DENIED_ALERT":
      lines.push("🚨 **Tentatives d'accès refusées répétées sur la Toile.**");
      break;
    case "USER_LEVEL_CHANGE_REQUESTED":
      destination = "/grades";
      lines.push(
        "📜 **Une demande de changement de grade est à examiner.**",
        payload.title ? `Membre : ${payload.title}` : "",
      );
      if (payload.note) lines.push(`Évolution : ${payload.note}`);
      break;
    case "USER_LEVEL_CHANGE_APPROVED":
      destination = "/grades";
      lines.push("✅ **Votre changement de grade a été approuvé.**");
      if (payload.title) lines.push(String(payload.title));
      if (payload.note) lines.push(`Décision : ${payload.note}`);
      break;
    case "USER_LEVEL_CHANGE_REJECTED":
      destination = "/grades";
      lines.push("❌ **Votre demande de changement de grade a été refusée.**");
      if (payload.title) lines.push(String(payload.title));
      if (payload.note) lines.push(`Décision : ${payload.note}`);
      break;
    default:
      lines.push("🕸️ **La Toile frémit.**", missionLine(payload));
  }
  if (appUrl()) lines.push(`→ ${appUrl()}${destination}`);
  return lines.filter(Boolean).join("\n");
}

/** Digest : plusieurs notifications regroupées en un seul message. */
export function formatDigest(items: { event: string; payload: NotificationPayload }[]): string {
  const header = `🕸️ **La Toile a frémi ${items.length} fois.**`;
  const body = items
    .slice(0, 15)
    .map((item) => `• ${formatNotification(item.event, item.payload).split("\n").slice(0, 2).join(" — ")}`)
    .join("\n");
  const more = items.length > 15 ? `\n… et ${items.length - 15} autre(s).` : "";
  return `${header}\n${body}${more}`;
}
