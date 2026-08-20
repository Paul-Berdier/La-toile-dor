-- `GroupMember.isLeader` porte l'autorité sur un groupe précis. Les anciens
-- outils d'administration pouvaient toutefois laisser ce marqueur sans le
-- rôle applicatif complémentaire `group_leader`, ce qui faisait disparaître
-- certaines capacités globales (revendication, invitations, demandes).
--
-- La réparation est additive : elle conserve tous les autres rôles, notamment
-- `moderator`, et ne retire rien aux comptes multi-rôles.
INSERT INTO "UserRole" ("userId", "roleId", "assignedAt")
SELECT DISTINCT member."userId", role."id", CURRENT_TIMESTAMP
FROM "GroupMember" AS member
INNER JOIN "Role" AS role ON role."slug" = 'group_leader'
WHERE member."isLeader" = true
ON CONFLICT ("userId", "roleId") DO NOTHING;
