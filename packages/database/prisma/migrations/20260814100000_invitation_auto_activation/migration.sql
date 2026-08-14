-- Une invitation valide vaut désormais admission immédiate.
-- Le champ est conservé pour assurer la compatibilité avec les versions
-- précédentes de l'application pendant le déploiement.
ALTER TABLE "Invitation"
  ALTER COLUMN "requireApproval" SET DEFAULT false;

UPDATE "Invitation"
SET "requireApproval" = false
WHERE "requireApproval" = true;

-- Ne débloquer que les comptes effectivement créés par une invitation.
-- Les comptes PENDING provenant d'une autre procédure restent inchangés.
UPDATE "User" AS u
SET
  "status" = 'ACTIVE',
  "approvedAt" = COALESCE(u."approvedAt", CURRENT_TIMESTAMP)
WHERE u."status" = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM "Invitation" AS i
    WHERE i."usedById" = u."id"
  );
