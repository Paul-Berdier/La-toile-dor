-- ─────────────────────────────────────────────────────────────────────────
-- Missions : liens vers les dossiers (cibles ET commanditaires), snapshots
-- du grade/classe/faction, et titre public généré.
--
-- La table « MissionTarget » devient le LIEN mission ↔ dossier, quel que soit
-- le rôle. On ne la renomme pas : le renommage coûterait une migration
-- destructive pour aucun gain fonctionnel.
--
-- STRICTEMENT ADDITIVE ET IDEMPOTENTE :
--   · aucune colonne ni table supprimée (targetIdentity, targetProfileId,
--     targetFactionId, targetLevelId, clientName, clientProfileId restent —
--     ce sont les données des missions déjà saisies) ;
--   · l'index unique (missionId, profileId) devient (missionId, profileId,
--     role) : il ne perd aucune ligne, il en autorise davantage ;
--   · les backfills sont gardés par NOT EXISTS / WHERE.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "MissionProfileRole" AS ENUM
    ('TARGET', 'CLIENT', 'CONTACT', 'SUBJECT', 'PERSON_OF_INTEREST', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MissionRankModifier" AS ENUM ('NONE', 'PLUS', 'MINUS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MissionOriginVisibility" AS ENUM ('SHOW', 'HIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Lien mission ↔ dossier : rôle, principal, snapshots ──────────────────
ALTER TABLE "MissionTarget"
  ADD COLUMN IF NOT EXISTS "role" "MissionProfileRole" NOT NULL DEFAULT 'TARGET',
  ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "snapshotRankId" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotClassId" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotFactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshotAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

DO $$ BEGIN
  ALTER TABLE "MissionTarget"
    ADD CONSTRAINT "MissionTarget_snapshotRankId_fkey"
    FOREIGN KEY ("snapshotRankId") REFERENCES "PlayerLevel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MissionTarget"
    ADD CONSTRAINT "MissionTarget_snapshotClassId_fkey"
    FOREIGN KEY ("snapshotClassId") REFERENCES "ProfileReferenceOption"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MissionTarget"
    ADD CONSTRAINT "MissionTarget_snapshotFactionId_fkey"
    FOREIGN KEY ("snapshotFactionId") REFERENCES "Faction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- L'unicité passe de (mission, dossier) à (mission, dossier, rôle) : un
-- commanditaire peut être aussi la cible de son propre contrat (trahison,
-- contrat sur soi-même). Aucune ligne existante n'est perdue.
DROP INDEX IF EXISTS "MissionTarget_missionId_profileId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MissionTarget_missionId_profileId_role_key"
  ON "MissionTarget"("missionId", "profileId", "role");
CREATE INDEX IF NOT EXISTS "MissionTarget_missionId_role_idx"
  ON "MissionTarget"("missionId", "role");

-- ── Mission : titre généré, nuance de rang, origine, champs recherchés ───
ALTER TABLE "Mission"
  -- false pour l'EXISTANT : les titres déjà écrits à la main sont conservés
  -- tels quels. Les missions créées par le nouvel éditeur passeront à true.
  ADD COLUMN IF NOT EXISTS "titleAuto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "titleOverrideReason" TEXT,
  ADD COLUMN IF NOT EXISTS "rankModifier" "MissionRankModifier" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "originVisibility" "MissionOriginVisibility" NOT NULL DEFAULT 'SHOW',
  ADD COLUMN IF NOT EXISTS "soughtFieldKeys" JSONB;

-- ── Backfill 1 : le commanditaire legacy devient un lien CLIENT ──────────
-- `Mission.clientProfileId` reste en place (rien n'est supprimé) ; le lien
-- permet aux nouvelles vues de traiter cibles et commanditaires de la même
-- façon, et à une mission d'en avoir plusieurs.
INSERT INTO "MissionTarget" ("id", "missionId", "profileId", "role", "isPrimary", "createdAt")
SELECT gen_random_uuid()::text, m."id", m."clientProfileId", 'CLIENT', true, CURRENT_TIMESTAMP
FROM "Mission" m
WHERE m."clientProfileId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MissionTarget" t
    WHERE t."missionId" = m."id"
      AND t."profileId" = m."clientProfileId"
      AND t."role" = 'CLIENT'
  );

-- ── Backfill 2 : snapshots des liens déjà posés ─────────────────────────
-- On fige l'état ACTUEL du dossier pour les liens qui n'en ont pas encore.
-- C'est la meilleure approximation disponible : l'historique du grade n'est
-- pas rejouable. Une seule fois — la garde `snapshotAt IS NULL` rend la
-- migration rejouable sans réécrire ce qui a été figé depuis.
UPDATE "MissionTarget" t
SET "snapshotRankId"    = p."rankId",
    "snapshotClassId"   = p."ninjaClassId",
    "snapshotFactionId" = p."factionId",
    "snapshotAt"        = CURRENT_TIMESTAMP
FROM "CharacterProfile" p
WHERE t."profileId" = p."id"
  AND t."snapshotAt" IS NULL;

-- ── Backfill 3 : une cible principale par mission ───────────────────────
-- La plus ancienne cible fait la cible principale, faute de mieux : c'est
-- celle autour de laquelle la mission a été écrite.
UPDATE "MissionTarget" t
SET "isPrimary" = true
WHERE t."role" = 'TARGET'
  AND t."id" = (
    SELECT t2."id" FROM "MissionTarget" t2
    WHERE t2."missionId" = t."missionId" AND t2."role" = 'TARGET'
    ORDER BY t2."createdAt" ASC, t2."id" ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM "MissionTarget" t3
    WHERE t3."missionId" = t."missionId" AND t3."role" = 'TARGET' AND t3."isPrimary"
  );

-- ── Nettoyage de données : EligibilityMode.MANUAL_REVIEW ────────────────
-- La valeur n'est plus produite par l'application (le zod ne l'accepte plus)
-- et l'éditeur la remappait à la volée. On la convertit une bonne fois, sans
-- toucher à l'enum lui-même (le retirer serait destructif).
UPDATE "Mission"
SET "eligibilityMode" = 'WARNING', "requiresEnhancedReview" = true
WHERE "eligibilityMode" = 'MANUAL_REVIEW';
