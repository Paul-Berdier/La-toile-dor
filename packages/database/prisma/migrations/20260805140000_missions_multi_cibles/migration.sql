-- CreateEnum
CREATE TYPE "MissionTargetOutcome" AS ENUM ('UNKNOWN', 'ELIMINATED', 'CAPTURED', 'ESCAPED', 'UNHARMED', 'MISSING');

-- CreateTable
CREATE TABLE "MissionTarget" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "profileId" TEXT,
    "label" TEXT,
    "outcome" "MissionTargetOutcome" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "recordedAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissionTarget_missionId_profileId_key" ON "MissionTarget"("missionId", "profileId");

-- CreateIndex
CREATE INDEX "MissionTarget_missionId_idx" ON "MissionTarget"("missionId");

-- CreateIndex
CREATE INDEX "MissionTarget_profileId_idx" ON "MissionTarget"("profileId");

-- AddForeignKey
ALTER TABLE "MissionTarget" ADD CONSTRAINT "MissionTarget_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionTarget" ADD CONSTRAINT "MissionTarget_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise des cibles déjà saisies : chaque mission qui désignait un dossier
-- devient une ligne de cible. Rien n'est perdu, et `Mission.targetProfileId`
-- est conservée telle quelle — on ne réécrit pas l'existant.
INSERT INTO "MissionTarget" ("id", "missionId", "profileId", "createdAt")
SELECT gen_random_uuid()::text, "id", "targetProfileId", CURRENT_TIMESTAMP
FROM "Mission"
WHERE "targetProfileId" IS NOT NULL;
