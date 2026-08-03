-- Visibilité choisie par chaque chef pour son groupe sur une mission.
-- Privé par défaut afin de ne rien révéler lors du déploiement.
ALTER TABLE "MissionClaim"
ADD COLUMN "publicRoster" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MissionAssignment"
ADD COLUMN "publicRoster" BOOLEAN NOT NULL DEFAULT false;
