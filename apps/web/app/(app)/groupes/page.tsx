import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, categoryLabel } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";

export const dynamic = "force-dynamic";

export default async function GroupesPage() {
  const current = await requireUser();
  const streamer = await isStreamerMode();
  const isModeration = current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY);

  const groups = await prisma.group.findMany({
    where: isModeration
      ? { isActive: true }
      : { isActive: true, members: { some: { userId: current.session.userId } } },
    include: {
      faction: { select: { name: true } },
      members: { select: { isLeader: true } },
    },
    orderBy: [{ faction: { name: "asc" } }, { name: "asc" }],
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        {isModeration ? "Tous les groupes" : "Mes groupes"}
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        {isModeration
          ? "La modération voit toutes les cellules de la Toile."
          : "Les cellules auxquelles votre fil est noué."}
      </p>

      {groups.length === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Aucun groupe ne vous est rattaché pour l&rsquo;instant.
        </p>
      )}

      <ul className="space-y-3">
        {groups.map((group) => (
          <li key={group.id}>
            <Link
              href={`/groupes/${group.id}`}
              className="flex items-center gap-4 border border-border-default bg-raised p-4 transition-colors hover:border-border-gold hover:bg-hover-bg"
            >
              {group.imageMime ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/groupes/${group.id}/image`}
                  alt=""
                  className="h-12 w-12 shrink-0 border border-border-gold object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center border border-border-default bg-elevated font-display text-gold-dim"
                >
                  組
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {streamer ? maskValue("GRP", group.id) : group.name}
                </span>
                <span className="block truncate text-xs text-ink-faint">
                  {streamer ? maskValue("FAC", group.factionId) : group.faction.name}
                  {" · "}
                  {group.members.length} membre{group.members.length > 1 ? "s" : ""}
                  {" · "}
                  {group.members.filter((m) => m.isLeader).length} chef
                  {group.members.filter((m) => m.isLeader).length > 1 ? "s" : ""}
                </span>
                {group.specialties.length > 0 && !streamer && (
                  <span className="mt-1 block truncate text-[0.7rem] text-gold-dim">
                    {group.specialties.map((s) => categoryLabel(s)).join(" · ")}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
