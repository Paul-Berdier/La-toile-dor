import Link from "next/link";
import { categoryLabel } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { listMembers } from "@/server/members";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function MembresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const current = await requireUser();
  const streamer = await isStreamerMode();
  const query = await searchParams;
  const q = first(query.q)?.trim().slice(0, 60) ?? "";
  const { members, total, page, pageCount } = await listMembers(current, {
    q,
    page: Number(first(query.page)) || 1,
  });
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (target > 1) params.set("page", String(target));
    const suffix = params.toString();
    return suffix ? `/membres?${suffix}` : "/membres";
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            Membres de la Toile
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            {total} membre{total > 1 ? "s" : ""} actif{total > 1 ? "s" : ""} — titres,
            responsabilités et parcours accomplis.
          </p>
        </div>
        <form method="get" className="flex w-full max-w-sm gap-2 sm:w-auto">
          <label htmlFor="member-search" className="sr-only">Rechercher un membre</label>
          <input
            id="member-search"
            name="q"
            defaultValue={q}
            maxLength={60}
            placeholder="Rechercher un Titre…"
            className="min-w-0 flex-1 border border-border-default bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
          />
          <button
            type="submit"
            className="border border-gold px-3 py-2 text-xs uppercase tracking-wider text-gold hover:bg-gold-faint/20"
          >
            Chercher
          </button>
        </form>
      </header>

      {members.length === 0 ? (
        <p className="mt-6 border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Aucun membre ne porte ce Titre.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => {
            const displayName = streamer ? maskValue("OPR", member.id) : member.displayName;
            return (
              <li key={member.id} className="border border-border-default bg-raised p-4 hover:border-border-gold">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {!streamer && member.hasPortrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/membres/${member.id}/portrait`}
                        alt={`Portrait de ${displayName}`}
                        loading="lazy"
                        className="h-12 w-12 shrink-0 border border-border-gold object-cover"
                      />
                    ) : (
                      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center border border-border-default bg-elevated font-display text-gold-dim">
                        者
                      </span>
                    )}
                    <div className="min-w-0">
                      <Link
                        href={`/membres/${member.id}`}
                        className="font-display text-base text-gold hover:underline"
                      >
                        {displayName}
                      </Link>
                      {!streamer && member.realName && (
                        <p className="truncate text-xs text-ink-muted">{member.realName}</p>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 border border-gold-dim px-2 py-0.5 text-[0.65rem] text-gold">
                    {member.levelLabel ?? "Grade inconnu"}
                  </span>
                </div>

                <p className="mt-3 text-xs text-ink-muted">
                  {member.roles.map(({ name }) => name).join(" · ") || "Sans rôle"}
                </p>

                {!streamer && member.publicBio && (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed whitespace-pre-line text-ink-faint">
                    {member.publicBio}
                  </p>
                )}

                {member.specialties.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1" aria-label="Spécialités">
                    {member.specialties.map((specialty) => (
                      <li key={specialty} className="border border-gold-dim px-1.5 py-0.5 text-[0.6rem] text-gold">
                        {categoryLabel(specialty)}
                      </li>
                    ))}
                  </ul>
                )}

                {member.groups.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1" aria-label="Groupes visibles">
                    {member.groups.map((membership) => (
                      <li key={membership.groupId}>
                        <Link
                          href={`/groupes/${membership.groupId}`}
                          className="border border-border-default px-1.5 py-0.5 text-[0.65rem] text-ink-faint hover:border-gold hover:text-gold"
                        >
                          {streamer ? maskValue("GRP", membership.groupId) : membership.group.name}
                          {membership.isLeader ? " ◆" : ""}
                          {membership.group.faction
                            ? ` · ${streamer ? maskValue("FAC", membership.group.faction.id) : membership.group.faction.name}`
                            : " · Sans faction"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <dl className="mt-3 grid grid-cols-3 gap-1 border-t border-border-default pt-3 text-center">
                  <div>
                    <dt className="text-[0.6rem] uppercase text-ink-faint">Missions</dt>
                    <dd className="font-mono-toile text-sm text-ink">{member.stats.resolved}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6rem] uppercase text-ink-faint">Points</dt>
                    <dd className="font-mono-toile text-sm text-gold">{member.stats.points}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6rem] uppercase text-ink-faint">Ryōs</dt>
                    <dd className="font-mono-toile text-sm text-ink">{member.stats.ryos.toLocaleString("fr-FR")}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pagination des membres" className="mt-6 flex items-center justify-between border-t border-border-default pt-4">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-sm text-ink-muted hover:text-gold">← Précédents</Link>
          ) : <span />}
          <span className="font-mono-toile text-xs text-ink-faint">Page {page} / {pageCount}</span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="text-sm text-ink-muted hover:text-gold">Suivants →</Link>
          ) : <span />}
        </nav>
      )}
    </main>
  );
}
