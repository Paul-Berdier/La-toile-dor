import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { UserActions } from "@/components/admin/user-actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "text-success",
  PENDING: "text-warning",
  SUSPENDED: "text-copper",
  REVOKED: "text-blood-bright",
};

const STATUS_LABELS_FR: Record<string, string> = {
  ACTIVE: "Actif",
  PENDING: "En attente",
  SUSPENDED: "Suspendu",
  REVOKED: "Révoqué",
};

export default async function AdminUtilisateursPage() {
  await requireUserWith(PERMISSIONS.USER_MANAGE);

  const [users, allRoles, allGroups, allLevels] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        discordAccount: { select: { username: true, discordId: true } },
        roles: { include: { role: true } },
        groupMemberships: {
          select: {
            groupId: true,
            isLeader: true,
            group: { select: { name: true, faction: { select: { name: true } } } },
          },
        },
        playerLevel: { select: { id: true, label: true } },
      },
    }),
    prisma.role.findMany({ select: { slug: true, name: true } }),
    prisma.group.findMany({
      where: { isActive: true },
      orderBy: [{ faction: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, faction: { select: { name: true } } },
    }),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
  ]);

  const groupOptions = allGroups.map((group) => ({
    id: group.id,
    name: group.name,
    factionName: group.faction?.name ?? null,
  }));

  return (
    <div className="overflow-x-auto border border-border-default bg-raised">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <caption className="sr-only">Utilisateurs de la Toile</caption>
        <thead>
          <tr className="border-b border-border-gold font-mono-toile text-[0.65rem] uppercase tracking-wider text-ink-faint">
            <th scope="col" className="px-4 py-3">Membre</th>
            <th scope="col" className="px-4 py-3">Discord</th>
            <th scope="col" className="px-4 py-3">Groupes</th>
            <th scope="col" className="px-4 py-3">Niveau</th>
            <th scope="col" className="px-4 py-3">Statut</th>
            <th scope="col" className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-border-default align-top hover:bg-hover-bg">
              <td className="px-4 py-3">
                <p className="text-ink">{user.displayName}</p>
                <p className="font-mono-toile text-[0.65rem] text-ink-faint">
                  {user.roles.map((r) => r.role.name).join(" · ") || "—"}
                </p>
                {user.village && (
                  <p className="text-[0.65rem] text-ink-faint">Village : {user.village}</p>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-ink-muted">
                {user.discordAccount
                  ? `@${user.discordAccount.username}`
                  : <span className="italic text-ink-faint">non lié</span>}
              </td>
              <td className="px-4 py-3 text-xs text-ink-muted">
                {user.groupMemberships
                  .map((membership) =>
                    `${membership.group.name}${membership.isLeader ? " ◆" : ""}${membership.group.faction ? ` · ${membership.group.faction.name}` : ""}`,
                  )
                  .join(", ") || "—"}
              </td>
              <td className="px-4 py-3 text-xs text-ink-muted">{user.playerLevel?.label ?? "—"}</td>
              <td className={`px-4 py-3 text-xs ${STATUS_STYLES[user.status]}`}>
                {STATUS_LABELS_FR[user.status]}
                {user.revokedReason && (
                  <p className="mt-0.5 text-[0.65rem] text-ink-faint">{user.revokedReason}</p>
                )}
              </td>
              <td className="px-4 py-3">
                {user.id !== "system" && (
                  <UserActions
                    userId={user.id}
                    status={user.status}
                    roles={user.roles.map((r) => r.role.slug)}
                    allRoles={allRoles}
                    groupMemberships={user.groupMemberships}
                    allGroups={groupOptions}
                    playerLevelId={user.playerLevel?.id ?? null}
                    allLevels={allLevels}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
