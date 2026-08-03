-- Le groupe devient l'unité d'autorité. Une faction n'est plus qu'un
-- rattachement facultatif du groupe.

-- Renommer le rôle sans recréer les associations RolePermission/UserRole.
UPDATE "Role"
SET "slug" = 'group_leader', "name" = 'Chef de groupe'
WHERE "slug" = 'faction_leader';

UPDATE "Role"
SET "slug" = 'group_member', "name" = 'Membre de groupe'
WHERE "slug" = 'faction_member';

-- Transférer l'ancien indicateur de chef uniquement vers les groupes dont la
-- personne est déjà membre, puis neutraliser tout chef de faction résiduel.
UPDATE "GroupMember" AS gm
SET "isLeader" = TRUE
FROM "Group" AS g, "FactionMember" AS fm
WHERE gm."groupId" = g."id"
  AND gm."userId" = fm."userId"
  AND g."factionId" = fm."factionId"
  AND fm."isLeader" = TRUE;

UPDATE "FactionMember" SET "isLeader" = FALSE WHERE "isLeader" = TRUE;

-- Un groupe indépendant survit à la suppression d'une faction.
ALTER TABLE "Group" DROP CONSTRAINT "Group_factionId_fkey";
ALTER TABLE "Group" ALTER COLUMN "factionId" DROP NOT NULL;
ALTER TABLE "Group"
  ADD CONSTRAINT "Group_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Deux groupes indépendants ne peuvent pas porter le même nom, sans imposer
-- une unicité globale aux groupes rattachés à des factions différentes.
CREATE UNIQUE INDEX "Group_unaffiliated_name_key"
  ON "Group" (LOWER("name"))
  WHERE "factionId" IS NULL;

-- L'attribution et les points restent valides pour un groupe sans faction.
ALTER TABLE "MissionAssignment" DROP CONSTRAINT "MissionAssignment_factionId_fkey";
ALTER TABLE "MissionAssignment" ALTER COLUMN "factionId" DROP NOT NULL;
ALTER TABLE "MissionAssignment"
  ADD CONSTRAINT "MissionAssignment_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MissionScore" DROP CONSTRAINT "MissionScore_factionId_fkey";
ALTER TABLE "MissionScore" ALTER COLUMN "factionId" DROP NOT NULL;
ALTER TABLE "MissionScore"
  ADD CONSTRAINT "MissionScore_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
