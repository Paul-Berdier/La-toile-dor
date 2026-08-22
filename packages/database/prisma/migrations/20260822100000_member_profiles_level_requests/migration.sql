-- Fiche publique des membres. Migration additive : aucune donnée existante
-- n'est supprimée ou réinterprétée.
ALTER TABLE "User"
  ADD COLUMN "publicBio" TEXT,
  ADD COLUMN "specialties" "MissionCategory"[] NOT NULL DEFAULT ARRAY[]::"MissionCategory"[],
  ADD COLUMN "portraitData" BYTEA,
  ADD COLUMN "portraitMime" TEXT;

-- Demandes contrôlées d'évolution de grade.
CREATE TYPE "UserLevelChangeRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "UserLevelChangeRequest" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "requestedById" TEXT,
  "currentLevelId" TEXT,
  "requestedLevelId" TEXT NOT NULL,
  "groupId" TEXT,
  "reason" TEXT NOT NULL,
  "status" "UserLevelChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "UserLevelChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserLevelChangeRequest_status_requestedAt_idx"
  ON "UserLevelChangeRequest"("status", "requestedAt");
CREATE INDEX "UserLevelChangeRequest_targetUserId_status_idx"
  ON "UserLevelChangeRequest"("targetUserId", "status");
CREATE INDEX "UserLevelChangeRequest_requestedById_requestedAt_idx"
  ON "UserLevelChangeRequest"("requestedById", "requestedAt");
CREATE INDEX "UserLevelChangeRequest_groupId_idx"
  ON "UserLevelChangeRequest"("groupId");

-- Une seule demande en attente par membre ; l'historique approuvé/refusé
-- reste illimité.
CREATE UNIQUE INDEX "UserLevelChangeRequest_one_pending_per_target"
  ON "UserLevelChangeRequest"("targetUserId")
  WHERE "status" = 'PENDING';

ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_currentLevelId_fkey"
  FOREIGN KEY ("currentLevelId") REFERENCES "PlayerLevel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_requestedLevelId_fkey"
  FOREIGN KEY ("requestedLevelId") REFERENCES "PlayerLevel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserLevelChangeRequest"
  ADD CONSTRAINT "UserLevelChangeRequest_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Événements de notification associés au workflow.
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_LEVEL_CHANGE_REQUESTED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_LEVEL_CHANGE_APPROVED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'USER_LEVEL_CHANGE_REJECTED';

-- Permission étroite : les modérateurs peuvent traiter les grades sans
-- recevoir le très large droit user.manage.
INSERT INTO "Permission" ("id", "key", "description")
VALUES (
  'permission_user_level_manage',
  'user.level.manage',
  'Traiter les demandes et modifier les grades des membres'
)
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON permission."key" = 'user.level.manage'
WHERE role."slug" IN ('moderator', 'super_admin')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
