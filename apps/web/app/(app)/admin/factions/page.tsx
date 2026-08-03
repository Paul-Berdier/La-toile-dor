import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { FactionCreateForm, GroupCreateForm } from "@/components/admin/config-forms";

export const dynamic = "force-dynamic";

export default async function AdminFactionsPage() {
  const current = await requireUserWith(PERMISSIONS.GROUP_CREATE);

  const [factions, unaffiliatedGroups] = await Promise.all([
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: {
        groups: {
          where: { isActive: true },
          include: { members: { include: { user: { select: { displayName: true } } } } },
        },
      },
    }),
    prisma.group.findMany({
      where: { isActive: true, factionId: null },
      include: { members: { include: { user: { select: { displayName: true } } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      {current.permissions.has(PERMISSIONS.FACTION_MANAGE) && <FactionCreateForm />}

      <section className="border border-border-gold bg-raised p-4">
        <h2 className="font-display text-sm tracking-widest text-gold uppercase">
          Groupes sans faction
        </h2>
        <p className="mt-1 text-xs text-ink-faint">
          Une faction est un rattachement facultatif ; elle ne porte aucun rôle de chef.
        </p>
        <GroupList groups={unaffiliatedGroups} />
        <div className="mt-3"><GroupCreateForm /></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {factions.map((faction) => (
          <section key={faction.id} className="border border-border-default bg-raised p-4">
            <h2 className="font-display text-sm tracking-widest text-gold uppercase">
              {faction.name}
            </h2>
            <p className="mt-1 text-xs text-ink-faint">
              {faction.groups.length} groupe(s) rattaché(s) · aucun rôle de chef de faction
            </p>
            <GroupList groups={faction.groups} />
            <div className="mt-3">
              <GroupCreateForm factionId={faction.id} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function GroupList({
  groups,
}: {
  groups: { id: string; name: string; members: { isLeader: boolean; user: { displayName: string } }[] }[];
}) {
  return (
    <ul className="mt-3 space-y-2">
      {groups.map((group) => (
        <li key={group.id} className="border border-border-default bg-elevated p-3">
          <p className="text-sm text-ink">{group.name}</p>
          <p className="text-xs text-ink-muted">
            {group.members
              .map((member) => `${member.isLeader ? "◆ " : ""}${member.user.displayName}`)
              .join(", ") || "Groupe vide"}
          </p>
        </li>
      ))}
      {groups.length === 0 && <li className="text-xs text-ink-faint italic">Aucun groupe.</li>}
    </ul>
  );
}
