import Link from "next/link";
import { prisma } from "@toile/database";
import { GRANT_SOURCE_LABELS, formatDossierTitle, type GrantSource } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { getProfileViewer } from "@/server/profiles/access";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  APPROVED: "Acceptée",
  REFUSED: "Refusée",
  CANCELLED: "Annulée",
};

/**
 * « Mes demandes » — pour les groupes du lecteur : demandes d'accès (avec la
 * réponse du tisseur et le prix consenti), accès détenus et leur origine,
 * accès révoqués et le motif. Rien ici ne concerne les AUTRES groupes.
 */
export default async function MesDemandesPage() {
  const current = await requireUser();
  const viewer = await getProfileViewer(current);
  const groupIds = viewer.groupIds;

  const [requests, grants] = groupIds.length
    ? await Promise.all([
        prisma.profilePurchaseRequest.findMany({
          where: { groupId: { in: groupIds } },
          orderBy: { requestedAt: "desc" },
          take: 100,
          include: {
            profile: { select: { id: true, code: true, title: true, characterFirstName: true, characterLastName: true } },
            group: { select: { name: true } },
          },
        }),
        prisma.profileAccessGrant.findMany({
          where: { groupId: { in: groupIds } },
          orderBy: { grantedAt: "desc" },
          take: 200,
          include: {
            profile: { select: { id: true, code: true, title: true, characterFirstName: true, characterLastName: true, archivedAt: true } },
            group: { select: { name: true } },
          },
        }),
      ])
    : [[], []];

  const titleOf = (p: { title: string | null; characterFirstName: string; characterLastName: string | null }) =>
    p.title ?? formatDossierTitle(p.characterFirstName, p.characterLastName);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link href="/profils" className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold">
        ← Dossiers de renseignement
      </Link>
      <h1 className="mt-3 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Mes demandes et mes accès
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Ce que vos groupes ont demandé, obtenu, ou perdu — et ce que le tisseur en a dit.
      </p>

      {groupIds.length === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Vous n&rsquo;appartenez à aucun groupe actif.
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Demandes d&rsquo;accès</h2>
        {requests.length === 0 ? (
          <p className="text-xs text-ink-faint italic">Aucune demande.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="border border-border-default bg-raised p-3 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/profils/${r.profile.id}`} className="text-sm text-ink hover:text-gold">
                    {titleOf(r.profile)}
                    <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{r.profile.code}</span>
                  </Link>
                  <span className={`font-mono-toile text-[0.65rem] uppercase tracking-wider ${
                    r.status === "PENDING" ? "text-warning" : r.status === "APPROVED" ? "text-gold" : r.status === "REFUSED" ? "text-blood-bright" : "text-ink-faint"
                  }`}>
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                <p className="mt-1 text-ink-faint">
                  {r.group.name} · {new Date(r.requestedAt).toLocaleDateString("fr-FR")}
                  {r.priceRyos != null && <span className="ml-2 font-mono-toile text-gold">{r.priceRyos.toLocaleString("fr-FR")} ryōs</span>}
                </p>
                {r.message && <p className="mt-1 text-ink-muted">Votre message : « {r.message} »</p>}
                {r.moderatorResponse && (
                  <p className="mt-1 border-l-2 border-gold-dim pl-2 text-ink-muted">
                    Réponse du tisseur : {r.moderatorResponse}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Accès de mes groupes</h2>
        {grants.length === 0 ? (
          <p className="text-xs text-ink-faint italic">Aucun accès.</p>
        ) : (
          <ul className="space-y-1.5">
            {grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-default/60 pb-1.5 text-xs">
                <span>
                  {g.profile.archivedAt ? (
                    <span className="text-ink-faint line-through">{titleOf(g.profile)}</span>
                  ) : (
                    <Link href={`/profils/${g.profile.id}`} className={g.revokedAt ? "text-ink-faint line-through" : "text-ink hover:text-gold"}>
                      {titleOf(g.profile)}
                    </Link>
                  )}
                  <span className="ml-1.5 font-mono-toile text-[0.65rem] text-ink-faint">{g.profile.code}</span>
                  <span className="ml-2 text-ink-faint">{g.group.name}</span>
                </span>
                <span className="text-[0.65rem]">
                  <span className="font-mono-toile uppercase tracking-wider text-gold">
                    {GRANT_SOURCE_LABELS[g.sourceType as GrantSource] ?? g.sourceType}
                  </span>
                  {g.priceRyos != null && <span className="ml-2 font-mono-toile text-ink-muted">{g.priceRyos.toLocaleString("fr-FR")} ryōs</span>}
                  {g.revokedAt && (
                    <span className="ml-2 text-blood-bright">
                      révoqué le {new Date(g.revokedAt).toLocaleDateString("fr-FR")}
                      {g.revokedReason && ` — ${g.revokedReason}`}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
