import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";

/**
 * Exigence de renseignement sur les cibles avant de clore une mission.
 *
 * Une mission accomplie sur une cible produit du renseignement : c'est la
 * matière même que la Toile revend. Sans contrainte, ce renseignement se perd
 * — l'équipe touche sa prime et le dossier reste vide. La modération règle donc
 * le niveau d'exigence, plutôt que le produit d'imposer le sien.
 */
export type TargetIntelMode = "OFF" | "WARN" | "REQUIRED";

export interface TargetIntelRule {
  mode: TargetIntelMode;
  /** Nombre de champs renseignés attendus par cible ayant un dossier */
  minFields: number;
  /** Exiger aussi que le sort de chaque cible soit constaté */
  requireOutcome: boolean;
}

export const DEFAULT_TARGET_INTEL_RULE: TargetIntelRule = {
  // WARN par défaut : on signale sans bloquer. Bloquer d'emblée sur une base
  // existante empêcherait de clore des missions déjà en cours.
  mode: "WARN",
  minFields: 3,
  requireOutcome: true,
};

export const TARGET_INTEL_MODE_LABELS: Record<TargetIntelMode, string> = {
  OFF: "Aucune exigence",
  WARN: "Signaler sans bloquer",
  REQUIRED: "Exiger avant de clore",
};

export const getTargetIntelRule = cache(async (): Promise<TargetIntelRule> => {
  const setting = await prisma.appSetting.findUnique({ where: { key: "mission_target_intel" } });
  const stored = (setting?.value ?? {}) as Partial<TargetIntelRule>;
  return { ...DEFAULT_TARGET_INTEL_RULE, ...stored };
});

export interface TargetIntelCheck {
  /** Messages à afficher — avertissements ou motifs de refus */
  issues: string[];
  /** Vrai si la règle interdit de clore la mission */
  blocking: boolean;
}

/**
 * Vérifie le renseignement des cibles d'une mission.
 *
 * Ne compte que les champs réellement ACQUIS (`KNOWN`) : une absence confirmée
 * ou une contradiction sont des renseignements légitimes, mais elles ne
 * démontrent pas qu'on a travaillé le dossier — et « Inconnu » encore moins.
 */
export async function checkTargetIntel(missionId: string): Promise<TargetIntelCheck> {
  const rule = await getTargetIntelRule();
  if (rule.mode === "OFF") return { issues: [], blocking: false };

  // Les CIBLES : c'est sur elles que la Toile attend du renseignement.
  const targets = await prisma.missionTarget.findMany({
    where: { missionId, role: "TARGET" },
    select: {
      outcome: true,
      label: true,
      profile: {
        select: {
          code: true,
          characterFirstName: true,
          fieldIntel: { where: { knowledgeState: "KNOWN" }, select: { fieldKey: true } },
        },
      },
    },
  });

  const issues: string[] = [];
  for (const target of targets) {
    const name = target.profile
      ? `${target.profile.code} — ${target.profile.characterFirstName}`
      : (target.label ?? "cible sans nom");

    if (rule.requireOutcome && target.outcome === "UNKNOWN") {
      issues.push(`${name} : le sort de la cible n'est pas constaté.`);
    }
    if (!target.profile) {
      issues.push(`${name} : aucune fiche ouverte — le renseignement recueilli sera perdu.`);
      continue;
    }
    const known = target.profile.fieldIntel.length;
    if (known < rule.minFields) {
      issues.push(
        `${name} : ${known} renseignement${known > 1 ? "s" : ""} sur les ${rule.minFields} attendus.`,
      );
    }
  }

  return { issues, blocking: rule.mode === "REQUIRED" && issues.length > 0 };
}
