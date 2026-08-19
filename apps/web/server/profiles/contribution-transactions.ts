import "server-only";
import { prisma, type Prisma, type ProfileContributionStatus } from "@toile/database";

type Tx = Prisma.TransactionClient;

const MAX_TRANSACTION_ATTEMPTS = 3;

export interface LockedContributionProfile {
  id: string;
  version: number;
  archivedAt: Date | null;
  mergedIntoId: string | null;
}

/**
 * Toutes les écritures issues d'une contribution sérialisent sur le dossier.
 * La fusion de profils doit prendre le même verrou (dans l'ordre des ids pour
 * deux profils) avant de déplacer les lignes liées.
 */
export async function lockContributionProfile(
  tx: Tx,
  profileId: string,
): Promise<LockedContributionProfile> {
  const [profile] = await tx.$queryRaw<LockedContributionProfile[]>`
    SELECT "id", "version", "archivedAt", "mergedIntoId"
    FROM "CharacterProfile"
    WHERE "id" = ${profileId}
    FOR UPDATE
  `;
  if (!profile || profile.archivedAt || profile.mergedIntoId) {
    throw new Error("PROFILE_UNAVAILABLE");
  }
  return profile;
}

/** Claim atomique d'une décision, lié au dossier lu avant la transaction. */
export async function claimPendingContribution(
  tx: Tx,
  input: {
    contributionId: string;
    profileId: string;
    status: ProfileContributionStatus;
    reviewerId: string;
    reviewNote: string | null;
    reviewedAt: Date;
  },
): Promise<boolean> {
  const claimed = await tx.profileIntelContribution.updateMany({
    where: {
      id: input.contributionId,
      profileId: input.profileId,
      status: "PENDING_REVIEW",
    },
    data: {
      status: input.status,
      reviewedById: input.reviewerId,
      reviewedAt: input.reviewedAt,
      reviewNote: input.reviewNote,
    },
  });
  return claimed.count === 1;
}

export function isRetryableContributionTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

/**
 * PostgreSQL peut annuler l'un des deux writers sérialisables. Une reprise est
 * sûre ici : toutes les écritures sont contenues dans la même transaction.
 */
export async function runContributionTransaction<T>(
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (!isRetryableContributionTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw new Error("UNREACHABLE_TRANSACTION_RETRY");
}
