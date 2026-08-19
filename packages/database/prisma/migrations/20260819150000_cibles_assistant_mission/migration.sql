-- ─────────────────────────────────────────────────────────────────────────
-- Cibles choisies dans l'assistant de création de mission.
--
-- Depuis la migration « missions_multi_cibles », les missions créées ou
-- modifiées par l'assistant n'écrivaient que `Mission.targetProfileId`
-- (colonne historique) SANS ligne `MissionTarget` : la clôture (état vital,
-- octrois MISSION_GRANTED) et l'accès des groupes engagés, qui lisent
-- `MissionTarget`, ignoraient donc ces cibles. Le code écrit désormais les
-- deux ; cette reprise rattrape l'existant.
--
-- Migration STRICTEMENT ADDITIVE et IDEMPOTENTE : une cible déjà présente
-- n'est pas dupliquée (contrainte unique missionId+profileId respectée par le
-- NOT EXISTS), aucune ligne n'est modifiée ni supprimée.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO "MissionTarget" ("id", "missionId", "profileId", "createdAt")
SELECT gen_random_uuid()::text, m."id", m."targetProfileId", CURRENT_TIMESTAMP
FROM "Mission" m
WHERE m."targetProfileId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "MissionTarget" t
    WHERE t."missionId" = m."id" AND t."profileId" = m."targetProfileId"
  );
