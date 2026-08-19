-- ─────────────────────────────────────────────────────────────────────────
-- Rapport final : rattachement durable au groupe rapporteur et idempotence.
-- Migration STRICTEMENT ADDITIVE et IDEMPOTENTE. Les rapports historiques
-- restent à NULL : leur groupe ne peut pas être déduit sans ambiguïté.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "MissionReport"
  ADD COLUMN IF NOT EXISTS "reportingGroupId" TEXT,
  ADD COLUMN IF NOT EXISTS "payload" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "MissionReport_missionId_reportingGroupId_key"
  ON "MissionReport"("missionId", "reportingGroupId");

DO $$ BEGIN
  ALTER TABLE "MissionReport"
    ADD CONSTRAINT "MissionReport_reportingGroupId_fkey"
    FOREIGN KEY ("reportingGroupId") REFERENCES "Group"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
