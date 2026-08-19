-- ─────────────────────────────────────────────────────────────────────────
-- Dossiers ninjas : classe, couleur des yeux, galerie d'images.
--
-- STRICTEMENT ADDITIVE et IDEMPOTENTE. Rien n'est supprimé ni écrasé :
-- l'ancien portrait (imageData/imageMime sur CharacterProfile) est COPIÉ dans
-- la galerie, pas déplacé — les deux colonnes restent en place.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Classe et couleur des yeux ──
-- Les référentiels NINJA_CLASS et EYE_COLOR n'ont besoin d'AUCUNE migration :
-- ProfileReferenceOption.type est une String libre. Le seed les peuple.
ALTER TABLE "CharacterProfile"
  ADD COLUMN IF NOT EXISTS "eyeColorId"          TEXT,
  ADD COLUMN IF NOT EXISTS "eyeColorSecondaryId" TEXT,
  ADD COLUMN IF NOT EXISTS "ninjaClassId"        TEXT;

DO $$ BEGIN
  ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_eyeColorId_fkey"
    FOREIGN KEY ("eyeColorId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_eyeColorSecondaryId_fkey"
    FOREIGN KEY ("eyeColorSecondaryId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_ninjaClassId_fkey"
    FOREIGN KEY ("ninjaClassId") REFERENCES "ProfileReferenceOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un second œil sans premier n'a pas de sens : l'hétérochromie complète une
-- couleur, elle ne la remplace pas.
DO $$ BEGIN
  ALTER TABLE "CharacterProfile" ADD CONSTRAINT "CharacterProfile_eye_secondary_requires_primary"
    CHECK ("eyeColorSecondaryId" IS NULL OR "eyeColorId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Galerie d'images ──
DO $$ BEGIN
  CREATE TYPE "ProfileImageType" AS ENUM ('PORTRAIT', 'APPEARANCE', 'EVIDENCE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProfileImage" (
  "id"              TEXT NOT NULL,
  "profileId"       TEXT NOT NULL,
  "imageData"       BYTEA NOT NULL,
  "imageMime"       TEXT NOT NULL,
  "sizeBytes"       INTEGER NOT NULL,
  "type"            "ProfileImageType" NOT NULL DEFAULT 'OTHER',
  "caption"         TEXT,
  "isPrimary"       BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "sourceMissionId" TEXT,
  "uploadedById"    TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "ProfileImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProfileImage_profileId_deletedAt_sortOrder_idx"
  ON "ProfileImage"("profileId", "deletedAt", "sortOrder");
CREATE INDEX IF NOT EXISTS "ProfileImage_sourceMissionId_idx"
  ON "ProfileImage"("sourceMissionId");

-- Un seul portrait principal VIVANT par dossier. Index partiel, comme les
-- deux autres déjà écrits à la main dans ce domaine.
CREATE UNIQUE INDEX IF NOT EXISTS "ProfileImage_one_primary_per_profile"
  ON "ProfileImage"("profileId") WHERE "isPrimary" = true AND "deletedAt" IS NULL;

DO $$ BEGIN
  ALTER TABLE "ProfileImage" ADD CONSTRAINT "ProfileImage_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProfileImage" ADD CONSTRAINT "ProfileImage_sourceMissionId_fkey"
    FOREIGN KEY ("sourceMissionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reprise du portrait existant : COPIÉ en galerie comme portrait principal.
-- L'ancienne colonne n'est PAS vidée — la route /image continue de la servir
-- tant que le code n'a pas basculé, et rien n'est perdu si l'on revient en
-- arrière. Rejouable : on ne reprend que les dossiers sans portrait principal.
INSERT INTO "ProfileImage" ("id", "profileId", "imageData", "imageMime", "sizeBytes", "type", "isPrimary", "sortOrder", "uploadedById", "createdAt")
SELECT gen_random_uuid()::text, p."id", p."imageData", p."imageMime", octet_length(p."imageData"), 'PORTRAIT', true, 0,
       COALESCE(p."updatedById", p."createdById", 'system'), p."updatedAt"
  FROM "CharacterProfile" p
 WHERE p."imageData" IS NOT NULL AND p."imageMime" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "ProfileImage" i
      WHERE i."profileId" = p."id" AND i."isPrimary" = true AND i."deletedAt" IS NULL
   );
