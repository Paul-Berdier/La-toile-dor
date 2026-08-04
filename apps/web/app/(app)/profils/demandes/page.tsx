import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { DecideRequestPanel } from "@/components/profils/request-access";

export const dynamic = "force-dynamic";

export default async function DemandesProfilPage() {
  const current = await requireUserWith(PERMISSIONS.PROFILE_PURCHASE_REVIEW);

  const requests = await prisma.profilePurchaseRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: {
      profile: { select: { id: true, code: true, characterFirstName: true } },
      group: {
        select: {
          id: true,
          name: true,
          _count: { select: { members: true } },
          scores: { select: { points: true } },
          profileGrants: { where: { revokedAt: null }, select: { id: true } },
        },
      },
    },
  });

  // Pseudonymes publics des chefs demandeurs (pas de relation directe en schéma)
  const requesters = await prisma.user.findMany({
    where: { id: { in: requests.map((r) => r.requestedById) } },
    select: { id: true, displayName: true },
  });
  const requesterName = new Map(requesters.map((u) => [u.id, u.displayName]));

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link href="/profils" className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold">
        ← Dossiers de renseignement
      </Link>
      <h1 className="mt-3 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Demandes d&rsquo;accès aux dossiers
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Fixez le prix en Ryōs (consigné ; le règlement se fait en RP).
      </p>

      {requests.length === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Aucune demande en attente.
        </p>
      )}

      <ul className="space-y-4">
        {requests.map((request) => {
          const totalPoints = request.group.scores.reduce((s, r) => s + r.points, 0);
          return (
            <li key={request.id} className="border border-border-default bg-raised">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-gold p-4">
                <div>
                  <Link href={`/profils/${request.profile.id}`} className="font-mono-toile text-xs text-ink-faint hover:text-gold">
                    {request.profile.code}
                  </Link>
                  <p className="text-sm font-medium text-ink">Dossier {request.profile.characterFirstName}</p>
                </div>
                <p className="text-xs text-ink-muted">
                  {new Date(request.requestedAt).toLocaleString("fr-FR")}
                </p>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <h2 className="text-[0.65rem] uppercase tracking-wider text-ink-faint">Groupe demandeur</h2>
                  <p className="mt-1 text-sm text-ink">{request.group.name}</p>
                  <p className="text-xs text-ink-muted">
                    Chef : {requesterName.get(request.requestedById) ?? "—"} ·{" "}
                    {request.group._count.members} membre(s)
                  </p>
                  <p className="text-xs text-ink-muted">
                    Classement : {totalPoints} pts · Dossiers déjà détenus : {request.group.profileGrants.length}
                  </p>
                  {request.message && (
                    <p className="mt-2 border-l-2 border-gold-dim pl-3 text-xs text-ink-muted italic">
                      « {request.message} »
                    </p>
                  )}
                </div>
                <DecideRequestPanel requestId={request.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
