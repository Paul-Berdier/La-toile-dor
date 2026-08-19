-- ─────────────────────────────────────────────────────────────────────────
-- Contributions de renseignement : un lecteur autorisé propose, la modération
-- (ou le groupe créateur) tranche. STRICTEMENT ADDITIVE et IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────

-- Deux événements de notification (ajout de valeurs d'enum : additif).
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'PROFILE_CONTRIBUTION_RECEIVED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'PROFILE_CONTRIBUTION_REVIEWED';

DO $$ BEGIN
  CREATE TYPE "ProfileContributionSource" AS ENUM ('GROUP', 'USER', 'MISSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProfileContributionStatus" AS ENUM
    ('PENDING_REVIEW', 'APPLIED', 'ACCEPTED', 'MERGED', 'REJECTED', 'CONTRADICTORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProfileIntelContribution" (
  "id"                    TEXT NOT NULL,
  "profileId"             TEXT NOT NULL,
  "fieldKey"              TEXT NOT NULL,
  "proposedValue"         JSONB NOT NULL,
  "proposedLabel"         TEXT NOT NULL,
  "knowledgeState"        "ProfileKnowledgeState" NOT NULL DEFAULT 'KNOWN',
  "confidence"            "IntelConfidence",
  "note"                  TEXT,
  "sourceType"            "ProfileContributionSource" NOT NULL,
  "groupId"               TEXT,
  "contributorId"         TEXT NOT NULL,
  "sourceMissionId"       TEXT,
  "status"                "ProfileContributionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "conflictsWithExisting" BOOLEAN NOT NULL DEFAULT false,
  "reviewedById"          TEXT,
  "reviewedAt"            TIMESTAMP(3),
  "reviewNote"            TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfileIntelContribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProfileIntelContribution_profileId_status_idx"
  ON "ProfileIntelContribution"("profileId", "status");
CREATE INDEX IF NOT EXISTS "ProfileIntelContribution_status_createdAt_idx"
  ON "ProfileIntelContribution"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ProfileIntelContribution_groupId_idx"
  ON "ProfileIntelContribution"("groupId");
CREATE INDEX IF NOT EXISTS "ProfileIntelContribution_sourceMissionId_idx"
  ON "ProfileIntelContribution"("sourceMissionId");

DO $$ BEGIN
  ALTER TABLE "ProfileIntelContribution" ADD CONSTRAINT "ProfileIntelContribution_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CharacterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProfileIntelContribution" ADD CONSTRAINT "ProfileIntelContribution_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProfileIntelContribution" ADD CONSTRAINT "ProfileIntelContribution_sourceMissionId_fkey"
    FOREIGN KEY ("sourceMissionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
