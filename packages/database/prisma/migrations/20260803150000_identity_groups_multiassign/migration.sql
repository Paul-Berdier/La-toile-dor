-- Migration ADDITIVE : identité confidentielle, fiche de groupe,
-- multi-attribution des missions. Aucune suppression, aucun NOT NULL
-- sur des colonnes existantes, backfill inclus.

-- CreateEnum
CREATE TYPE "GroupOnboardingMode" AS ENUM ('NONE', 'EXISTING_GROUP', 'CREATE_NEW_GROUP');

-- AlterEnum : nouvelles catégories (servent aussi de spécialités de groupe)
ALTER TYPE "MissionCategory" ADD VALUE 'INFILTRATION';
ALTER TYPE "MissionCategory" ADD VALUE 'TRAQUE';
ALTER TYPE "MissionCategory" ADD VALUE 'CONTRE_ESPIONNAGE';
ALTER TYPE "MissionCategory" ADD VALUE 'GUERRE';

-- AlterEnum
ALTER TYPE "NotificationEvent" ADD VALUE 'MEMBER_PROMOTED';

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageMime" TEXT,
ADD COLUMN     "primaryCountry" TEXT,
ADD COLUMN     "primaryVillage" TEXT,
ADD COLUMN     "specialties" "MissionCategory"[] DEFAULT ARRAY[]::"MissionCategory"[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "groupOnboardingMode" "GroupOnboardingMode" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "MissionAssignment" ADD COLUMN     "assignedHeadcount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isLeadGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "MissionClaim" ADD COLUMN     "proposedHeadcount" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayNameNorm" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "privacyAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_displayNameNorm_key" ON "User"("displayNameNorm");

-- ─────────────────────────────────────────────────────────────
-- Backfill 1 : pseudonyme normalisé (uniquement quand il est sans conflit ;
-- les doublons éventuels seront résolus par l'onboarding de chaque compte)
-- ─────────────────────────────────────────────────────────────
UPDATE "User" u SET "displayNameNorm" = sub.norm
FROM (
  SELECT id,
         lower(regexp_replace(btrim("displayName"), '\s+', ' ', 'g')) AS norm,
         count(*) OVER (
           PARTITION BY lower(regexp_replace(btrim("displayName"), '\s+', ' ', 'g'))
         ) AS occurrences
  FROM "User"
) sub
WHERE u.id = sub.id AND sub.occurrences = 1 AND u."displayNameNorm" IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Backfill 2 : reconstruire une attribution pour chaque mission encore
-- rattachée à un groupe via l'ancienne colonne assignedGroupId et n'ayant
-- aucune attribution active. Aucune mission ne perd son groupe.
-- ─────────────────────────────────────────────────────────────
INSERT INTO "MissionAssignment"
  ("id", "missionId", "factionId", "groupId", "assignedById", "assignedAt",
   "active", "assignedHeadcount", "isLeadGroup", "notes")
SELECT
  'mig_' || md5(m."id" || m."assignedGroupId"),
  m."id", m."assignedFactionId", m."assignedGroupId", m."creatorId",
  COALESCE(m."assignedAt", m."createdAt"),
  true, GREATEST(m."groupSizeMin", 1), true,
  'Attribution reconstruite depuis l''ancienne colonne (migration)'
FROM "Mission" m
WHERE m."assignedGroupId" IS NOT NULL
  AND m."assignedFactionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MissionAssignment" a
    WHERE a."missionId" = m."id" AND a."groupId" = m."assignedGroupId" AND a."active"
  );

-- ─────────────────────────────────────────────────────────────
-- Garde-fous : au plus UNE attribution active par paire mission/groupe,
-- au plus UN groupe principal actif par mission, effectif >= 1.
-- Dédoublonnage défensif avant la pose des index partiels.
-- ─────────────────────────────────────────────────────────────
UPDATE "MissionAssignment" a SET "active" = false,
  "releasedAt" = CURRENT_TIMESTAMP,
  "releasedReason" = 'Doublon neutralisé par la migration'
WHERE a."active" AND EXISTS (
  SELECT 1 FROM "MissionAssignment" b
  WHERE b."missionId" = a."missionId" AND b."groupId" = a."groupId"
    AND b."active" AND b."assignedAt" > a."assignedAt"
);

CREATE UNIQUE INDEX "MissionAssignment_active_mission_group_key"
  ON "MissionAssignment"("missionId", "groupId") WHERE "active";

CREATE UNIQUE INDEX "MissionAssignment_active_lead_key"
  ON "MissionAssignment"("missionId") WHERE "active" AND "isLeadGroup";

ALTER TABLE "MissionAssignment"
  ADD CONSTRAINT "MissionAssignment_headcount_positive" CHECK ("assignedHeadcount" >= 1);
