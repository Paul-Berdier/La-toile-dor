-- Le contrôle renforcé devient indépendant de la politique automatique.
ALTER TABLE "Mission"
  ADD COLUMN "requiresEnhancedReview" BOOLEAN NOT NULL DEFAULT false;

-- L'ancien mode MANUAL_REVIEW ne faisait qu'ajouter un avertissement alors
-- que toutes les revendications sont déjà examinées par un modérateur.
-- On conserve la valeur dans l'enum pour compatibilité, mais les missions
-- existantes convergent vers WARNING + contrôle renforcé.
UPDATE "Mission"
SET
  "eligibilityMode" = 'WARNING',
  "requiresEnhancedReview" = true
WHERE "eligibilityMode" = 'MANUAL_REVIEW';

-- Les fils encore actifs créés par un chef ne doivent pas conserver un grade
-- élevé choisi avant le durcissement serveur. Ils restent utilisables, mais au
-- niveau initial ; la modération pourra corriger le compte ensuite.
UPDATE "Invitation" AS invitation
SET "playerLevelId" = (
  SELECT "id"
  FROM "PlayerLevel"
  ORDER BY "order" ASC
  LIMIT 1
)
WHERE invitation."status" = 'ACTIVE'
  AND invitation."usedById" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "UserRole" AS user_role
    INNER JOIN "Role" AS role ON role."id" = user_role."roleId"
    WHERE user_role."userId" = invitation."createdById"
      AND role."slug" IN ('super_admin', 'moderator')
  );
