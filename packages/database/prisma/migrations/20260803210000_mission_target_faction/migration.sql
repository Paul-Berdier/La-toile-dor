-- Faction RP de la cible, distincte de la faction facultative des groupes
-- participant à la mission. Nullable pour préserver les missions historiques.
ALTER TABLE "Mission"
ADD COLUMN "targetFactionId" TEXT;

CREATE INDEX "Mission_targetFactionId_idx"
ON "Mission"("targetFactionId");

ALTER TABLE "Mission"
ADD CONSTRAINT "Mission_targetFactionId_fkey"
FOREIGN KEY ("targetFactionId") REFERENCES "Faction"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
