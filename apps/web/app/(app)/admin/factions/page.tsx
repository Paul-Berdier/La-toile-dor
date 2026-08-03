import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { FactionCreateForm, GroupCreateForm } from "@/components/admin/config-forms";

export const dynamic = "force-dynamic";

export default async function AdminFactionsPage() {
  await requireUserWith(PERMISSIONS.FACTION_MANAGE);

  const factions = await prisma.faction.findMany({
    orderBy: { name: "asc" },
    include: {
      members: { include: { user: { select: { displayName: true, status: true } } } },
      groups: {
        where: { isActive: true },
        include: { members: { include: { user: { select: { displayName: true } } } } },
      },
    },
  });

  return (
    <div className="space-y-6">
      <FactionCreateForm />

      <div className="grid gap-4 lg:grid-cols-2">
        {factions.map((faction) => (
          <section key={faction.id} className="border border-border-default bg-raised p-4">
            <h2 className="font-display text-sm tracking-widest text-gold uppercase">
              {faction.name}
            </h2>
            <p className="mt-1 text-xs text-ink-faint">
              {faction.members.length} membre(s) ·{" "}
              {faction.members.filter((m) => m.isLeader).length} chef(s)
            </p>

            <ul className="mt-3 space-y-2">
              {faction.groups.map((group) => (
                <li key={group.id} className="border border-border-default bg-elevated p-3">
                  <p className="text-sm text-ink">{group.name}</p>
                  <p className="text-xs text-ink-muted">
                    {group.members
                      .map((m) => `${m.isLeader ? "◆ " : ""}${m.user.displayName}`)
                      .join(", ") || "Cellule vide"}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <GroupCreateForm factionId={faction.id} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
