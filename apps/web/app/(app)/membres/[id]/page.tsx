import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryLabel } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { getMember } from "@/server/members";

export const dynamic = "force-dynamic";

export default async function MembrePage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser();
  const { id } = await params;
  const [member, streamer] = await Promise.all([
    getMember(current, id),
    isStreamerMode(),
  ]);
  if (!member) notFound();

  const displayName = streamer ? maskValue("OPR", member.id) : member.displayName;
  const successRate = member.stats.resolved > 0
    ? Math.round((member.stats.completed / member.stats.resolved) * 100)
    : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <Link href="/membres" className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold">
        ← Membres de la Toile
      </Link>

      <header className="mt-4 border border-border-gold bg-raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {!streamer && member.hasPortrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/membres/${member.id}/portrait`}
                alt={`Portrait de ${displayName}`}
                className="h-28 w-24 shrink-0 border border-border-gold object-cover"
              />
            ) : (
              <span aria-hidden className="flex h-28 w-24 shrink-0 items-center justify-center border border-border-gold bg-elevated font-display text-3xl text-gold-dim">
                者
              </span>
            )}
            <div className="min-w-0">
              <p className="font-mono-toile text-[0.65rem] uppercase tracking-widest text-ink-faint">
                Fiche membre
              </p>
              <h1 className="mt-1 font-display text-2xl text-gold">{displayName}</h1>
              {!streamer && member.realName && (
                <p className="mt-1 text-sm text-ink-muted">
                  Identité autorisée : <span className="text-ink">{member.realName}</span>
                </p>
              )}
              <p className="mt-2 text-sm text-ink-muted">
                {member.levelLabel ?? "Grade non renseigné"}
              </p>
            </div>
          </div>
          {current.session.userId === member.id && (
            <Link
              href="/compte"
              className="border border-gold px-3 py-2 text-xs uppercase tracking-wider text-gold hover:bg-gold-faint/20"
            >
              Modifier mes infos
            </Link>
          )}
        </div>
        {!streamer && member.publicBio && (
          <p className="mt-4 max-w-2xl border-t border-border-default pt-4 text-sm leading-relaxed whitespace-pre-line text-ink-muted">
            {member.publicBio}
          </p>
        )}
        {member.specialties.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Spécialités">
            {member.specialties.map((specialty) => (
              <li key={specialty} className="border border-gold-dim bg-gold-faint/20 px-2 py-0.5 text-[0.7rem] text-gold">
                {categoryLabel(specialty)}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">Responsabilités</h2>
            {member.roles.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {member.roles.map((role) => (
                  <li key={role.slug} className="border border-gold-dim bg-gold-faint/20 px-2 py-1 text-xs text-ink-muted">
                    {role.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint italic">Aucun rôle attribué.</p>
            )}
          </section>

          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">Groupes visibles</h2>
            {member.groups.length > 0 ? (
              <ul className="space-y-2">
                {member.groups.map((membership) => (
                  <li key={membership.groupId} className="border border-border-default bg-elevated p-3">
                    <Link href={`/groupes/${membership.groupId}`} className="text-sm text-ink hover:text-gold">
                      {streamer ? maskValue("GRP", membership.groupId) : membership.group.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {membership.isLeader ? "Chef de groupe" : "Agent"}
                      {membership.group.faction
                        ? ` · ${streamer ? maskValue("FAC", membership.group.faction.id) : membership.group.faction.name}`
                        : " · Sans faction"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-faint italic">
                Aucune appartenance de groupe visible depuis votre position.
              </p>
            )}
          </section>
        </div>

        <section className="border border-border-gold bg-raised p-5">
          <h2 className="mb-1 font-display text-sm tracking-widest text-gold uppercase">Parcours de mission</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Totaux des missions résolues uniquement — aucune opération en cours n’est révélée.
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Missions résolues" value={member.stats.resolved.toLocaleString("fr-FR")} />
            <Stat label="Accomplies" value={member.stats.completed.toLocaleString("fr-FR")} tone="gold" />
            <Stat label="Échouées" value={member.stats.failed.toLocaleString("fr-FR")} />
            <Stat label="Réussite" value={successRate === null ? "—" : `${successRate} %`} />
            <Stat label="Points reçus" value={member.stats.points.toLocaleString("fr-FR")} tone="gold" />
            <Stat label="Ryōs reçus" value={member.stats.ryos.toLocaleString("fr-FR")} />
          </dl>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gold" }) {
  return (
    <div className="border border-border-default bg-elevated p-3">
      <dt className="text-[0.6rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className={`mt-1 font-mono-toile text-lg ${tone === "gold" ? "text-gold" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
