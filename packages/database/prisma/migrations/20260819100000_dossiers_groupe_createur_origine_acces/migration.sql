-- ─────────────────────────────────────────────────────────────────────────
-- Dossiers ninjas : groupe créateur, titre, origine des accès.
--
-- STRICTEMENT ADDITIVE. Aucune colonne retirée, aucune ligne supprimée,
-- aucun accès existant révoqué. Chaque instruction est idempotente : la
-- migration peut être rejouée sans effet de bord.
-- ─────────────────────────────────────────────────────────────────────────

-- Origine d'un octroi d'accès
DO $$ BEGIN
  CREATE TYPE "ProfileGrantSource" AS ENUM ('CREATED_BY_GROUP', 'PURCHASED', 'MODERATOR_GRANTED', 'MISSION_GRANTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ProfileAccessGrant : origine, cause, motif de révocation
ALTER TABLE "ProfileAccessGrant"
  ADD COLUMN IF NOT EXISTS "sourceType"    "ProfileGrantSource" NOT NULL DEFAULT 'PURCHASED',
  ADD COLUMN IF NOT EXISTS "sourceId"      TEXT,
  ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

CREATE INDEX IF NOT EXISTS "ProfileAccessGrant_profileId_sourceType_idx"
  ON "ProfileAccessGrant"("profileId", "sourceType");

-- Backfill de l'origine des accès EXISTANTS. requestId discrimine sans
-- ambiguïté : l'approbation d'une demande le renseigne toujours, la clôture
-- de mission ne le renseigne jamais. On ne touche qu'aux lignes encore au
-- défaut sans cause connue, pour rester rejouable.
UPDATE "ProfileAccessGrant"
   SET "sourceType" = 'PURCHASED', "sourceId" = "requestId"
 WHERE "requestId" IS NOT NULL AND "sourceId" IS NULL;

UPDATE "ProfileAccessGrant"
   SET "sourceType" = 'MISSION_GRANTED'
 WHERE "requestId" IS NULL AND "priceRyos" IS NULL AND "sourceType" = 'PURCHASED';

-- CharacterProfile : groupe créateur et titre
ALTER TABLE "CharacterProfile"
  ADD COLUMN IF NOT EXISTS "createdByGroupId" TEXT,
  ADD COLUMN IF NOT EXISTS "title"            TEXT;

DO $$ BEGIN
  ALTER TABLE "CharacterProfile"
    ADD CONSTRAINT "CharacterProfile_createdByGroupId_fkey"
    FOREIGN KEY ("createdByGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CharacterProfile_createdByGroupId_idx"
  ON "CharacterProfile"("createdByGroupId");

-- Backfill du titre : « Dossier — Prénom Nom » pour tout dossier qui n'en a
-- pas. Le titre est public au même titre que le prénom : il n'expose rien de
-- plus que ce que la liste montrait déjà.
UPDATE "CharacterProfile"
   SET "title" = 'Dossier — ' || TRIM("characterFirstName" || ' ' || COALESCE("characterLastName", ''))
 WHERE "title" IS NULL;

-- Le groupe créateur des dossiers EXISTANTS n'est PAS deviné : ils ont été
-- ouverts par la modération, qui n'est le groupe de personne. Laisser NULL
-- est exact ; inventer un propriétaire donnerait à un groupe un droit
-- d'écriture qu'il n'a jamais eu.
