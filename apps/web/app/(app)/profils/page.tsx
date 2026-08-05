import Link from "next/link";
import { prisma } from "@toile/database";
import { LIFE_STATUS_LABELS, REFERENCE_TYPES } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { listProfiles } from "@/server/profiles/queries";
import { QuickCreateProfile } from "@/components/profils/quick-create";
import { ProfileFilters } from "@/components/profils/profile-filters";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProfilsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const current = await requireUser();
  const sp = await searchParams;
  const missionId = first(sp.mission);

  const { rows, viewer } = await listProfiles(current, {
    q: first(sp.q)?.slice(0, 80),
    factionId: first(sp.faction),
    clanOptionId: first(sp.clan),
    lifeStatus: first(sp.etat),
    access: first(sp.acces) as "granted" | "pending" | "refused" | undefined,
  });

  // Options de filtre : modération uniquement (aucune fuite par les filtres)
  const [factions, clans, attachMission] = await Promise.all([
    viewer.canViewAll
      ? prisma.faction.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
    viewer.canViewAll
      ? prisma.profileReferenceOption.findMany({
          where: { type: REFERENCE_TYPES.CLAN_FAMILY, isActive: true },
          select: { id: true, label: true },
          orderBy: { sortOrder: "asc" },
        })
      : [],
    viewer.canManage && missionId
      ? prisma.mission.findUnique({ where: { id: missionId }, select: { id: true, code: true, publicTitle: true } })
      : null,
  ]);

  const withMission = (href: string) =>
    attachMission ? `${href}?mission=${attachMission.id}` : href;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            Dossiers de renseignement
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            {viewer.canViewAll
              ? "Tout ce que la Toile sait — et ce qu'elle vend."
              : "Ce que la Toile accepte de laisser entrevoir."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewer.canReview && (
            <Link href="/profils/demandes" className={buttonClasses("outline", "md")}>
              Demandes d&rsquo;accès
            </Link>
          )}
          {viewer.canManage && <QuickCreateProfile sourceMissionId={attachMission?.id} />}
        </div>
      </div>

      {attachMission && (
        <p className="mt-4 border border-gold-dim bg-gold-faint/20 px-4 py-2 text-xs text-gold">
          Renseignements de la mission <strong>{attachMission.code}</strong> —{" "}
          {attachMission.publicTitle} : créez un nouveau dossier ou ouvrez un dossier
          existant pour y verser les informations.
        </p>
      )}

      {/* Recherche + filtres (gradés selon le rôle), appliqués au fil de la frappe */}
      <ProfileFilters
        initial={{
          q: first(sp.q) ?? "",
          faction: first(sp.faction) ?? "",
          clan: first(sp.clan) ?? "",
          etat: first(sp.etat) ?? "",
          acces: first(sp.acces) ?? "",
        }}
        canViewAll={viewer.canViewAll}
        factions={factions.map((f) => ({ value: f.id, label: f.name }))}
        clans={clans.map((c) => ({ value: c.id, label: c.label }))}
        lifeStatuses={Object.entries(LIFE_STATUS_LABELS).map(([value, label]) => ({
          value,
          label,
        }))}
        missionId={attachMission?.id}
      />

      {rows.length === 0 && (
        <p className="mt-6 border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Aucun dossier ne correspond. La Toile garde ses secrets.
        </p>
      )}

      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={withMission(`/profils/${row.id}`)}
              className="flex h-full items-center gap-3 border border-border-default bg-raised p-3 transition-colors hover:border-border-gold hover:bg-hover-bg"
            >
              {row.hasVisiblePortrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/profils/${row.id}/image`}
                  alt=""
                  className="h-16 w-12 shrink-0 border border-border-gold object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-16 w-12 shrink-0 items-center justify-center border border-border-default bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(184,150,62,0.08)_4px,rgba(184,150,62,0.08)_8px)] font-display text-gold-dim"
                >
                  諜
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-mono-toile text-[0.65rem] tracking-wider text-ink-faint">
                  {row.code}
                </span>
                <span className="block truncate text-sm text-ink">
                  {row.firstName}
                  {/* Le nom n'est présent dans la charge utile que si le
                      lecteur y a droit — rien n'est masqué en CSS. */}
                  {row.lastName && (
                    <span className="ml-1 text-ink-muted">{row.lastName}</span>
                  )}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {row.accessBadge === "granted" && (
                    <span className="border border-gold-dim bg-gold-faint/30 px-1.5 py-0.5 text-[0.6rem] uppercase text-gold">
                      Accès obtenu
                    </span>
                  )}
                  {row.accessBadge === "pending" && (
                    <span className="border border-warning/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-warning">
                      Demande en attente
                    </span>
                  )}
                  {row.accessBadge === "refused" && (
                    <span className="border border-blood/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-blood-bright">
                      Refusée
                    </span>
                  )}
                  {viewer.canViewAll && (row.pendingRequests ?? 0) > 0 && (
                    <span className="border border-warning/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-warning">
                      {row.pendingRequests} demande{(row.pendingRequests ?? 0) > 1 ? "s" : ""}
                    </span>
                  )}
                  {viewer.canViewAll && (
                    <span className="px-1.5 py-0.5 text-[0.6rem] text-ink-faint">
                      {row.intelCount} renseignement{(row.intelCount ?? 0) > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
