-- ─────────────────────────────────────────────────────────────────────────
-- Rapport de fin de mission : brouillon par (mission, groupe), sauvegardé au
-- fil de la saisie. STRICTEMENT ADDITIVE et IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "MissionReportDraft" (
  "id"        TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "groupId"   TEXT NOT NULL,
  "authorId"  TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionReportDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MissionReportDraft_missionId_groupId_key"
  ON "MissionReportDraft"("missionId", "groupId");

DO $$ BEGIN
  ALTER TABLE "MissionReportDraft" ADD CONSTRAINT "MissionReportDraft_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MissionReportDraft" ADD CONSTRAINT "MissionReportDraft_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
