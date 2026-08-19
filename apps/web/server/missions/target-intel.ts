import "server-only";
import type { Prisma } from "@toile/database";

/**
 * Répercussions d'une mission résolue sur les dossiers de renseignement.
 *
 * Une mission accomplie est un fait : si la cible a été éliminée, son dossier
 * doit le dire, et ceux qui ont fait le travail doivent pouvoir le lire. Sans
 * cela, la Toile vendrait des dossiers qu'elle sait périmés, et les agents qui
 * ont risqué leur vie devraient racheter l'information qu'ils ont eux-mêmes
 * rapportée.
 *
 * Trois effets, tous idempotents — une mission peut être rejouée sans
 * dupliquer ni écraser :
 *  1. l'état vital de chaque cible ;
 *  2. l'accès des groupes engagés aux dossiers des cibles ;
 *  3. la trace de la commande dans le dossier du commanditaire.
 */

/** Sorts qui changent l'état vital. Les autres sont consignés sans l'écrire. */
const OUTCOME_TO_LIFE_STATUS = {
  ELIMINATED: "DEAD",
  MISSING: "MISSING",
} as const;

type Outcome = keyof typeof OUTCOME_TO_LIFE_STATUS | "UNKNOWN" | "CAPTURED" | "ESCAPED" | "UNHARMED";

export const OUTCOME_LABELS: Record<Outcome, string> = {
  UNKNOWN: "Sort inconnu",
  ELIMINATED: "Éliminée",
  CAPTURED: "Capturée vivante",
  ESCAPED: "En fuite",
  UNHARMED: "Épargnée ou jamais atteinte",
  MISSING: "Disparue",
};

export interface TargetIntelResult {
  /** Dossiers dont l'état vital a été mis à jour */
  lifeStatusUpdated: string[];
  /** Accès ouverts (dossier × groupe) */
  grantsCreated: number;
  /** Cibles sans dossier : la Toile ne peut rien en consigner */
  targetsWithoutProfile: number;
}

/**
 * Applique les effets d'une mission résolue. À appeler DANS la transaction de
 * résolution : si la mission n'est pas enregistrée, ses effets ne doivent pas
 * l'être non plus.
 */
export async function applyMissionOutcomeToProfiles(
  tx: Prisma.TransactionClient,
  input: {
    missionId: string;
    missionCode: string;
    /** Groupes ayant réellement participé — ce sont eux qui gagnent l'accès */
    groupIds: string[];
    actorId: string;
    clientProfileId: string | null;
  },
): Promise<TargetIntelResult> {
  const targets = await tx.missionTarget.findMany({
    where: { missionId: input.missionId },
    select: { id: true, profileId: true, outcome: true, note: true },
  });

  const result: TargetIntelResult = {
    lifeStatusUpdated: [],
    grantsCreated: 0,
    targetsWithoutProfile: targets.filter((t) => !t.profileId).length,
  };

  for (const target of targets) {
    if (!target.profileId) continue;
    const profile = await tx.characterProfile.findUnique({
      where: { id: target.profileId },
      select: { id: true, code: true, lifeStatus: true, archivedAt: true, mergedIntoId: true, createdByGroupId: true },
    });
    // Un dossier archivé ou fusionné ne se met pas à jour au passage : la
    // fusion a ses propres règles, et l'archivage est une décision assumée.
    if (!profile || profile.archivedAt || profile.mergedIntoId) continue;

    const nextStatus = OUTCOME_TO_LIFE_STATUS[target.outcome as keyof typeof OUTCOME_TO_LIFE_STATUS];

    if (nextStatus && profile.lifeStatus !== nextStatus) {
      await tx.characterProfile.update({
        where: { id: profile.id },
        data: { lifeStatus: nextStatus, updatedById: input.actorId, version: { increment: 1 } },
      });
      // L'état vital devient une information ACQUISE, sourcée par la mission
      await tx.characterFieldIntel.upsert({
        where: { profileId_fieldKey: { profileId: profile.id, fieldKey: "lifeStatus" } },
        update: {
          knowledgeState: "KNOWN",
          confidence: "CONFIRMED",
          sourceMissionId: input.missionId,
          sourceNote: `Constaté lors de la mission ${input.missionCode}.`,
          updatedById: input.actorId,
        },
        create: {
          profileId: profile.id,
          fieldKey: "lifeStatus",
          knowledgeState: "KNOWN",
          confidence: "CONFIRMED",
          sourceMissionId: input.missionId,
          sourceNote: `Constaté lors de la mission ${input.missionCode}.`,
          updatedById: input.actorId,
        },
      });
      result.lifeStatusUpdated.push(profile.code);
    }

    // Trace systématique, même quand l'état vital ne bouge pas : savoir qu'une
    // cible a été visée et s'en est tirée est un renseignement en soi.
    await tx.characterProfileRevision.create({
      data: {
        profileId: profile.id,
        fieldKey: "lifeStatus",
        oldValue: { lifeStatus: profile.lifeStatus },
        newValue: {
          missionCode: input.missionCode,
          outcome: target.outcome,
          lifeStatus: nextStatus ?? profile.lifeStatus,
        },
        justification: `Mission ${input.missionCode} — ${OUTCOME_LABELS[target.outcome as Outcome]}${
          target.note ? ` : ${target.note}` : ""
        }`,
        confidence: "CONFIRMED",
        changedById: input.actorId,
        sourceMissionId: input.missionId,
      },
    });

    // Les groupes engagés obtiennent le dossier de la cible : ils l'ont payé
    // de leur peine. L'accès n'est pas un achat — priceRyos reste nul.
    //
    // Le groupe qui a ouvert le dossier y accède déjà par propriété : créer un
    // grant supplémentaire serait redondant. En revanche, cette propriété ne
    // doit pas priver les AUTRES groupes engagés de l'accès gagné sur une cible
    // officielle de la mission. Les ninjas découverts dans un rapport ne sont
    // plus des MissionTarget et ne passent donc pas par cette boucle.
    for (const groupId of input.groupIds) {
      if (profile.createdByGroupId === groupId) continue;
      const existing = await tx.profileAccessGrant.findFirst({
        where: { profileId: profile.id, groupId, revokedAt: null },
        select: { id: true },
      });
      if (existing) continue;
      await tx.profileAccessGrant.create({
        data: {
          profileId: profile.id,
          groupId,
          grantedById: input.actorId,
          priceRyos: null,
          // Étiqueté à l'ÉCRITURE : sans cela le défaut PURCHASED classerait
          // un accès gagné au prix du sang comme un achat, et la modération
          // révoquerait l'un comme l'autre sans savoir ce qu'elle retire.
          sourceType: "MISSION_GRANTED",
          sourceId: input.missionId,
        },
      });
      result.grantsCreated += 1;
    }
  }

  // Le commanditaire : ce qu'il commande dit quelque chose de lui.
  if (input.clientProfileId) {
    const client = await tx.characterProfile.findUnique({
      where: { id: input.clientProfileId },
      select: { id: true, archivedAt: true, mergedIntoId: true },
    });
    if (client && !client.archivedAt && !client.mergedIntoId) {
      await tx.characterProfileRevision.create({
        data: {
          profileId: client.id,
          fieldKey: "details",
          newValue: { commissioned: input.missionCode },
          justification: `A commandité la mission ${input.missionCode}, close ce jour.`,
          confidence: "CONFIRMED",
          changedById: input.actorId,
          sourceMissionId: input.missionId,
        },
      });
    }
  }

  return result;
}
