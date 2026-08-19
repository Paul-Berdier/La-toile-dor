/**
 * Catalogue des événements de notification : libellés d'affichage (page
 * Échos) et listes réglables par l'utilisateur (préférences). Données pures,
 * partagées entre composants serveur et client.
 */

export interface EventLabel {
  glyph: string;
  text: string;
}

export const EVENT_LABELS: Record<string, EventLabel> = {
  PROFILE_REQUEST_CREATED: { glyph: "諜", text: "Nouvelle demande d'accès à un dossier de renseignement" },
  PROFILE_REQUEST_APPROVED: { glyph: "承", text: "Votre groupe possède désormais l'accès à un dossier" },
  PROFILE_REQUEST_REFUSED: { glyph: "断", text: "Votre demande d'accès à un dossier a été refusée" },
  PROFILE_UPDATED: { glyph: "筆", text: "Un dossier détenu par votre groupe a été mis à jour" },
  PROFILE_CONTRIBUTION_RECEIVED: { glyph: "報", text: "Un renseignement a été proposé sur un dossier — à examiner" },
  PROFILE_CONTRIBUTION_REVIEWED: { glyph: "裁", text: "La modération a tranché sur un renseignement que vous avez proposé" },
  MEMBER_PROMOTED: { glyph: "昇", text: "Vous avez été promu chef de votre groupe" },
  MISSION_AVAILABLE: { glyph: "🕸", text: "Un nouveau fil a été tendu sur la Toile" },
  CLAIM_ACCEPTED: { glyph: "承", text: "Votre revendication a été acceptée — le dossier vous est ouvert" },
  CLAIM_REJECTED: { glyph: "断", text: "Votre revendication a été refusée" },
  CLAIM_INFO_REQUESTED: { glyph: "問", text: "Le tisseur demande des précisions sur votre revendication" },
  MISSION_UPDATED: { glyph: "筆", text: "Le dossier d'un contrat attribué a été mis à jour" },
  MISSION_STATUS_CHANGED: { glyph: "変", text: "Le statut d'un contrat suivi a changé" },
  MISSION_DEADLINE_SOON: { glyph: "刻", text: "Un délai approche — moins d'un jour réel" },
  MISSION_EXPIRED: { glyph: "灰", text: "Un contrat a expiré" },
  MISSION_CANCELLED: { glyph: "断", text: "Un fil a été rompu — contrat annulé" },
  NEW_CLAIM: { glyph: "願", text: "Nouvelle revendication à examiner" },
  CLAIM_WITHDRAWN: { glyph: "退", text: "Une cellule retire sa revendication" },
  FINAL_REPORT_SUBMITTED: { glyph: "書", text: "Un rapport final a été transmis" },
  SYNC_ISSUE: { glyph: "乱", text: "Problème de synchronisation Discord" },
  ACCESS_DENIED_ALERT: { glyph: "警", text: "Tentatives d'accès refusées répétées" },
};

/** Événements que tout membre peut recevoir et régler. */
export const BASE_CONFIGURABLE_EVENTS = [
  "MISSION_AVAILABLE",
  "CLAIM_ACCEPTED",
  "CLAIM_REJECTED",
  "CLAIM_INFO_REQUESTED",
  "MISSION_UPDATED",
  "MISSION_STATUS_CHANGED",
  "MISSION_DEADLINE_SOON",
  "MISSION_EXPIRED",
  "MISSION_CANCELLED",
  "MEMBER_PROMOTED",
  "PROFILE_REQUEST_APPROVED",
  "PROFILE_REQUEST_REFUSED",
  "PROFILE_UPDATED",
  "PROFILE_CONTRIBUTION_REVIEWED",
] as const;

/** Événements adressés à la modération — réglables par elle seule. */
export const MODERATION_CONFIGURABLE_EVENTS = [
  "NEW_CLAIM",
  "CLAIM_WITHDRAWN",
  "FINAL_REPORT_SUBMITTED",
  "PROFILE_REQUEST_CREATED",
  "PROFILE_CONTRIBUTION_RECEIVED",
  "SYNC_ISSUE",
  "ACCESS_DENIED_ALERT",
] as const;

export const CONFIGURABLE_EVENTS: readonly string[] = [
  ...BASE_CONFIGURABLE_EVENTS,
  ...MODERATION_CONFIGURABLE_EVENTS,
];
