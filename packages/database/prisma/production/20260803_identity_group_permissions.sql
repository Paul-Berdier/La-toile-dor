-- Permissions introduites avec l'identité confidentielle et la gestion des groupes.
-- Script idempotent : peut être exécuté plusieurs fois en production.

BEGIN;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "Role"
    WHERE "slug" IN ('moderator', 'super_admin')
  ) <> 2 THEN
    RAISE EXCEPTION 'Rôles moderator/super_admin introuvables : exécuter le seed de référentiels.';
  END IF;
END
$$;

INSERT INTO "Permission" ("id", "key", "description")
VALUES
  ('perm_20260803_group_create', 'group.create', 'Créer un groupe'),
  ('perm_20260803_group_edit_any', 'group.edit.any', 'Modifier n''importe quel groupe'),
  ('perm_20260803_identity_view_real', 'identity.view.real', 'Consulter les identités réelles (prénom/nom)')
ON CONFLICT ("key") DO UPDATE
SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
WHERE role."slug" IN ('moderator', 'super_admin')
  AND permission."key" IN ('group.create', 'group.edit.any', 'identity.view.real')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Vérification attendue : 6 lignes (3 permissions × 2 rôles).
SELECT role."slug", permission."key"
FROM "RolePermission" AS role_permission
JOIN "Role" AS role ON role."id" = role_permission."roleId"
JOIN "Permission" AS permission ON permission."id" = role_permission."permissionId"
WHERE role."slug" IN ('moderator', 'super_admin')
  AND permission."key" IN ('group.create', 'group.edit.any', 'identity.view.real')
ORDER BY role."slug", permission."key";
