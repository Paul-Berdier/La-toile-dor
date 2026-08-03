-- Niveau pré-assigné par l'invitation (nullable pour les anciens fils).
ALTER TABLE "Invitation" ADD COLUMN "playerLevelId" TEXT;

-- Récompense exacte et parts individuelles à la résolution.
ALTER TABLE "Mission" ADD COLUMN "awardedRyo" INTEGER;
ALTER TABLE "MissionParticipant" ADD COLUMN "groupId" TEXT;
ALTER TABLE "MissionParticipant" ADD COLUMN "pointsAwarded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MissionParticipant" ADD COLUMN "ryoAwarded" INTEGER NOT NULL DEFAULT 0;

-- Les revendications conservent la sélection nominative avant attribution.
CREATE TABLE "MissionClaimParticipant" (
    "claimId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "MissionClaimParticipant_pkey" PRIMARY KEY ("claimId", "userId")
);

CREATE INDEX "MissionClaimParticipant_userId_idx"
ON "MissionClaimParticipant"("userId");

CREATE INDEX "MissionParticipant_missionId_groupId_idx"
ON "MissionParticipant"("missionId", "groupId");

-- Backfill prudent : l'ancien groupe principal est le meilleur rattachement
-- disponible pour les participations historiques.
UPDATE "MissionParticipant" AS participant
SET "groupId" = mission."assignedGroupId"
FROM "Mission" AS mission
WHERE participant."missionId" = mission."id"
  AND participant."groupId" IS NULL
  AND mission."assignedGroupId" IS NOT NULL;

ALTER TABLE "Invitation"
ADD CONSTRAINT "Invitation_playerLevelId_fkey"
FOREIGN KEY ("playerLevelId") REFERENCES "PlayerLevel"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Les comptes et fils historiques sans niveau reçoivent provisoirement le
-- niveau le plus bas. La modération peut ensuite corriger chaque fiche.
UPDATE "User"
SET "playerLevelId" = (SELECT "id" FROM "PlayerLevel" ORDER BY "order" ASC LIMIT 1)
WHERE "playerLevelId" IS NULL;

UPDATE "Invitation"
SET "playerLevelId" = (SELECT "id" FROM "PlayerLevel" ORDER BY "order" ASC LIMIT 1)
WHERE "playerLevelId" IS NULL;

ALTER TABLE "MissionClaimParticipant"
ADD CONSTRAINT "MissionClaimParticipant_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "MissionClaim"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MissionClaimParticipant"
ADD CONSTRAINT "MissionClaimParticipant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MissionParticipant"
ADD CONSTRAINT "MissionParticipant_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "Group"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Mission"
ADD CONSTRAINT "Mission_awardedRyo_nonnegative"
CHECK ("awardedRyo" IS NULL OR "awardedRyo" >= 0);
