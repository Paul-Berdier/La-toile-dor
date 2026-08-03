/**
 * Sérialiseurs de mission à trois niveaux de confidentialité.
 *
 * PRINCIPE : un champ confidentiel n'EXISTE PAS dans le DTO d'un niveau
 * inférieur. La confidentialité est garantie par construction — jamais par
 * un masquage CSS ou un champ vidé côté client.
 *
 * - PublicMissionView   : chef de groupe AVANT attribution (et cartes Kanban)
 * - AssignedMissionView : groupe attribué + participants explicites
 * - ModeratorMissionView: modérateurs et super administrateurs
 */

import type { TimeRemaining } from "./rp-time";

export type MissionViewLevel = "public" | "assigned" | "moderator";

// ── Formes d'entrée minimales (compatibles avec le modèle Prisma) ──

export interface MissionRecord {
  id: string;
  code: string;
  status: string;
  rank: string;
  category: string;
  publicTitle: string;
  publicSummary: string | null;
  rewardRyoMin: number;
  rewardRyoMax: number;
  basePoints: number;
  targetLevelId: string | null;
  minRecommendedLevelId: string | null;
  groupSizeMin: number;
  groupSizeMax: number;
  confidentialDescription: string | null;
  primaryObjective: string | null;
  secondaryObjectives: unknown;
  targetIdentity: string | null;
  location: string | null;
  clientName: string | null;
  constraints: string | null;
  prohibitions: string | null;
  evidence: string | null;
  internalTitle: string | null;
  moderatorNotes: string | null;
  eligibilityMode: string;
  createdAt: Date;
  publishedAt: Date | null;
  expiresAt: Date | null;
  assignedFactionId: string | null;
  assignedGroupId: string | null;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  failureReason: string | null;
  cancellationReason: string | null;
  visibility?: {
    showCategory: boolean;
    showTargetLevel: boolean;
    showSummary: boolean;
  } | null;
}

export interface PublicMissionView {
  level: "public";
  id: string;
  code: string;
  status: string;
  rank: string;
  /** null si le modérateur a choisi de ne pas révéler la catégorie */
  category: string | null;
  publicTitle: string;
  publicSummary: string | null;
  rewardRyoMin: number;
  rewardRyoMax: number;
  basePoints: number;
  targetLevelId: string | null;
  minRecommendedLevelId: string | null;
  groupSizeMin: number;
  groupSizeMax: number;
  publishedAt: string | null;
  timeRemaining: TimeRemaining;
  claimCount: number;
  /** La mission comporte un volet confidentiel (indicateur, pas le contenu) */
  hasConfidential: boolean;
}

export interface AssignedMissionView
  extends Omit<PublicMissionView, "level" | "category"> {
  level: "assigned";
  category: string; // toujours visible après attribution
  confidentialDescription: string | null;
  primaryObjective: string | null;
  /** Les objectifs secondaires marqués `secret` sont exclus pour ce niveau */
  secondaryObjectives: { label: string; points?: number }[];
  targetIdentity: string | null;
  location: string | null;
  clientName: string | null;
  constraints: string | null;
  prohibitions: string | null;
  evidence: string | null;
  assignedFactionId: string | null;
  assignedGroupId: string | null;
  assignedAt: string | null;
}

export interface ModeratorMissionView
  extends Omit<AssignedMissionView, "level" | "secondaryObjectives"> {
  level: "moderator";
  internalTitle: string | null;
  moderatorNotes: string | null;
  eligibilityMode: string;
  secondaryObjectives: { label: string; secret?: boolean; points?: number }[];
  resolvedAt: string | null;
  failureReason: string | null;
  cancellationReason: string | null;
  visibility: {
    showCategory: boolean;
    showTargetLevel: boolean;
    showSummary: boolean;
  };
}

export type MissionView =
  | PublicMissionView
  | AssignedMissionView
  | ModeratorMissionView;

interface SerializeContext {
  timeRemaining: TimeRemaining;
  claimCount: number;
}

function parseSecondaryObjectives(
  raw: unknown,
): { label: string; secret?: boolean; points?: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (o): o is { label: string; secret?: boolean; points?: number } =>
      typeof o === "object" && o !== null && typeof (o as { label?: unknown }).label === "string",
  );
}

export function toPublicView(m: MissionRecord, ctx: SerializeContext): PublicMissionView {
  const vis = m.visibility ?? { showCategory: true, showTargetLevel: true, showSummary: true };
  return {
    level: "public",
    id: m.id,
    code: m.code,
    status: m.status,
    rank: m.rank,
    category: vis.showCategory ? m.category : null,
    publicTitle: m.publicTitle,
    publicSummary: vis.showSummary ? m.publicSummary : null,
    rewardRyoMin: m.rewardRyoMin,
    rewardRyoMax: m.rewardRyoMax,
    basePoints: m.basePoints,
    targetLevelId: vis.showTargetLevel ? m.targetLevelId : null,
    minRecommendedLevelId: m.minRecommendedLevelId,
    groupSizeMin: m.groupSizeMin,
    groupSizeMax: m.groupSizeMax,
    publishedAt: m.publishedAt?.toISOString() ?? null,
    timeRemaining: ctx.timeRemaining,
    claimCount: ctx.claimCount,
    hasConfidential: Boolean(
      m.confidentialDescription || m.targetIdentity || m.location || m.clientName,
    ),
  };
}

export function toAssignedView(m: MissionRecord, ctx: SerializeContext): AssignedMissionView {
  const base = toPublicView(m, ctx);
  return {
    ...base,
    level: "assigned",
    category: m.category,
    publicSummary: m.publicSummary,
    targetLevelId: m.targetLevelId,
    confidentialDescription: m.confidentialDescription,
    primaryObjective: m.primaryObjective,
    secondaryObjectives: parseSecondaryObjectives(m.secondaryObjectives)
      .filter((o) => !o.secret)
      .map(({ label, points }) => ({ label, points })),
    targetIdentity: m.targetIdentity,
    location: m.location,
    clientName: m.clientName,
    constraints: m.constraints,
    prohibitions: m.prohibitions,
    evidence: m.evidence,
    assignedFactionId: m.assignedFactionId,
    assignedGroupId: m.assignedGroupId,
    assignedAt: m.assignedAt?.toISOString() ?? null,
  };
}

export function toModeratorView(m: MissionRecord, ctx: SerializeContext): ModeratorMissionView {
  const assigned = toAssignedView(m, ctx);
  return {
    ...assigned,
    level: "moderator",
    internalTitle: m.internalTitle,
    moderatorNotes: m.moderatorNotes,
    eligibilityMode: m.eligibilityMode,
    secondaryObjectives: parseSecondaryObjectives(m.secondaryObjectives),
    resolvedAt: m.resolvedAt?.toISOString() ?? null,
    failureReason: m.failureReason,
    cancellationReason: m.cancellationReason,
    visibility: m.visibility ?? {
      showCategory: true,
      showTargetLevel: true,
      showSummary: true,
    },
  };
}

export function serializeMission(
  m: MissionRecord,
  level: MissionViewLevel,
  ctx: SerializeContext,
): MissionView {
  switch (level) {
    case "moderator":
      return toModeratorView(m, ctx);
    case "assigned":
      return toAssignedView(m, ctx);
    default:
      return toPublicView(m, ctx);
  }
}
