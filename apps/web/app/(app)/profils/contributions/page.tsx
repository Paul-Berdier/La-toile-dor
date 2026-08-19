import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, PROFILE_FIELD_LABELS, type ProfileFieldKey } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { PendingContributions } from "@/components/profils/contribute";
import type { ContributionView } from "@/server/profiles/queries";

export const dynamic = "force-dynamic";

/**
 * File des contributions de renseignement à trancher — modération.
 * Regroupées par dossier ; la décision se prend avec le dossier ouvert à côté
 * (le lien), pas à l'aveugle.
 */
export default async function ContributionsPage({
  searchParams,
}: {
  searchParams: Promise<{ conflits?: string | string[] }>;
}) {
  await requireUserWith(PERMISSIONS.PROFILE_MANAGE);
  const sp = await searchParams;
  // « ?conflits=1 » : ne garder que les propositions qui contredisent une
  // valeur en place — celles que la modération doit trancher en priorité.
  const onlyConflicts = (Array.isArray(sp.conflits) ? sp.conflits[0] : sp.conflits) === "1";

  const rows = await prisma.profileIntelContribution.findMany({
    where: {
      status: "PENDING_REVIEW",
      profile: { archivedAt: null },
      ...(onlyConflicts ? { conflictsWithExisting: true } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      profile: { select: { id: true, code: true, title: true, characterFirstName: true, characterLastName: true } },
      group: { select: { name: true } },
      sourceMission: { select: { code: true } },
    },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.contributorId))] } },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.displayName]));

  const byProfile = new Map<string, { profile: (typeof rows)[number]["profile"]; items: ContributionView[] }>();
  for (const r of rows) {
    const entry = byProfile.get(r.profileId) ?? { profile: r.profile, items: [] };
    entry.items.push({
      id: r.id,
      fieldKey: r.fieldKey,
      fieldLabel: PROFILE_FIELD_LABELS[r.fieldKey as ProfileFieldKey] ?? r.fieldKey,
      proposedLabel: r.proposedLabel,
      knowledgeState: r.knowledgeState,
      confidence: r.confidence,
      note: r.note,
      status: r.status,
      sourceType: r.sourceType,
      groupName: r.group?.name ?? null,
      contributorName: nameOf.get(r.contributorId) ?? "—",
      sourceMissionCode: r.sourceMission?.code ?? null,
      conflictsWithExisting: r.conflictsWithExisting,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    });
    byProfile.set(r.profileId, entry);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link href="/profils" className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold">
        ← Dossiers de renseignement
      </Link>
      <h1 className="mt-3 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Renseignements proposés
      </h1>
      <p className="mt-1 mb-4 text-xs text-ink-faint">
        Ce que les groupes rapportent sur les dossiers qu&rsquo;ils détiennent. Accepter inscrit la
        valeur ; fusionner complète ; contradictoire garde les deux versions et le signale.
      </p>

      <nav aria-label="Filtre des propositions" className="mb-6 flex flex-wrap gap-2 text-xs">
        <Link
          href="/profils/contributions"
          aria-current={!onlyConflicts ? "page" : undefined}
          className={`border px-2.5 py-1 ${!onlyConflicts ? "border-gold text-gold" : "border-border-default text-ink-muted hover:border-gold"}`}
        >
          Toutes les propositions
        </Link>
        <Link
          href="/profils/contributions?conflits=1"
          aria-current={onlyConflicts ? "page" : undefined}
          className={`border px-2.5 py-1 ${onlyConflicts ? "border-blood text-blood-bright" : "border-border-default text-ink-muted hover:border-blood"}`}
        >
          ⚠ Conflits seulement
        </Link>
      </nav>

      {byProfile.size === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          {onlyConflicts ? "Aucun conflit en attente." : "Aucune proposition en attente."}
        </p>
      )}

      <ul className="space-y-5">
        {[...byProfile.values()].map(({ profile, items }) => (
          <li key={profile.id} className="border border-border-default bg-raised">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-gold p-4">
              <div>
                <p className="font-mono-toile text-xs text-ink-faint">{profile.code}</p>
                <Link href={`/profils/${profile.id}`} className="font-display text-base text-gold hover:underline">
                  {profile.title ?? `Dossier — ${[profile.characterFirstName, profile.characterLastName].filter(Boolean).join(" ")}`}
                </Link>
              </div>
              <span className="font-mono-toile text-[0.65rem] uppercase tracking-wider text-warning">
                {items.length} proposition{items.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="p-4">
              <PendingContributions rows={items} />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
