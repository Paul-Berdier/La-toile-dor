import Link from "next/link";
import { prisma } from "@toile/database";
import { LIFE_STATUS_LABELS, REFERENCE_TYPES } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { listProfiles } from "@/server/profiles/queries";
import { QuickCreateProfile } from "@/components/profils/quick-create";
import { ProfileFilters } from "@/components/profils/profile-filters";
import { DossierCard } from "@/components/profils/dossier-card";
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

  const { rows, viewer, total, page, pageCount } = await listProfiles(current, {
    q: first(sp.q)?.slice(0, 80),
    factionId: first(sp.faction),
    clanOptionId: first(sp.clan),
    lifeStatus: first(sp.etat),
    access: first(sp.acces) as "granted" | "pending" | "refused" | undefined,
    page: Number(first(sp.page)) || 1,
    sexCode: first(sp.sexe),
    rankId: first(sp.grade),
    withPortrait: first(sp.portrait) === "1",
    // Traits cumulés : chacun restreint davantage la recherche
    traitOptionIds: [
      first(sp.nature),
      first(sp.kg),
      first(sp.technique),
      first(sp.artefact),
      first(sp.style),
    ].filter((value): value is string => Boolean(value)),
  });

  /** Conserve les filtres courants en changeant de page. */
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const single = first(value);
      if (single && key !== "page") params.set(key, single);
    }
    if (target > 1) params.set("page", String(target));
    const query = params.toString();
    return query ? `/profils?${query}` : "/profils";
  };

  /** Référentiel proposé en filtre — modération uniquement. */
  const loadRefOptions = (type: string) =>
    viewer.canViewAll
      ? prisma.profileReferenceOption.findMany({
          where: { type, isActive: true },
          select: { id: true, label: true },
          orderBy: { sortOrder: "asc" },
        })
      : Promise.resolve([]);

  // Options de filtre : modération uniquement (aucune fuite par les filtres)
  const [
    factions,
    clans,
    attachMission,
    natures,
    kekkeiGenkai,
    clanTechniques,
    artifacts,
    combatStyles,
    ranks,
  ] = await Promise.all([
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
    loadRefOptions(REFERENCE_TYPES.CHAKRA_NATURE),
    loadRefOptions(REFERENCE_TYPES.KEKKEI_GENKAI),
    loadRefOptions(REFERENCE_TYPES.CLAN_TECHNIQUE),
    loadRefOptions(REFERENCE_TYPES.LEGENDARY_ARTIFACT),
    loadRefOptions(REFERENCE_TYPES.COMBAT_STYLE),
    viewer.canViewAll
      ? prisma.playerLevel.findMany({ select: { id: true, label: true }, orderBy: { order: "asc" } })
      : [],
  ]);
  const pendingContributions = viewer.canManage
    ? await prisma.profileIntelContribution.count({ where: { status: "PENDING_REVIEW" } })
    : 0;

  const asOptions = (rows: { id: string; label: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.label }));

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
          {viewer.canManage && (
            <Link href="/profils/contributions" className={buttonClasses("outline", "md")}>
              Renseignements proposés
              {pendingContributions > 0 && (
                <span className="ml-2 border border-warning/60 px-1.5 font-mono-toile text-[0.65rem] text-warning">
                  {pendingContributions}
                </span>
              )}
            </Link>
          )}
          {viewer.canCreate && (
            <QuickCreateProfile
              sourceMissionId={attachMission?.id}
              groups={viewer.groupIds.map((id) => ({ id, name: viewer.groupNames.get(id) ?? "Groupe" }))}
              canCreateWithoutGroup={viewer.canManage}
            />
          )}
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
          nature: first(sp.nature) ?? "",
          kg: first(sp.kg) ?? "",
          technique: first(sp.technique) ?? "",
          artefact: first(sp.artefact) ?? "",
          style: first(sp.style) ?? "",
          grade: first(sp.grade) ?? "",
          sexe: first(sp.sexe) ?? "",
          portrait: first(sp.portrait) ?? "",
        }}
        natures={asOptions(natures)}
        kekkeiGenkai={asOptions(kekkeiGenkai)}
        clanTechniques={asOptions(clanTechniques)}
        artifacts={asOptions(artifacts)}
        combatStyles={asOptions(combatStyles)}
        ranks={asOptions(ranks)}
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

      {/* Compteur : ce que la liste montre, sur ce qu'elle contient */}
      {total > 0 && (
        <p className="mt-4 font-mono-toile text-[0.65rem] uppercase tracking-widest text-ink-faint">
          {total} dossier{total > 1 ? "s" : ""}
          {pageCount > 1 && ` · page ${page} sur ${pageCount}`}
        </p>
      )}

      <ul
        className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-live="polite"
        aria-label="Dossiers"
      >
        {rows.map((row) => (
          <DossierCard
            key={row.id}
            row={row}
            href={withMission(`/profils/${row.id}`)}
            isModerator={viewer.canViewAll}
          />
        ))}
      </ul>

      {pageCount > 1 && (
        <nav
          aria-label="Pagination des dossiers"
          className="mt-6 flex items-center justify-between gap-3 border-t border-border-default pt-4"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClasses("outline", "sm")} rel="prev">
              ← Précédents
            </Link>
          ) : (
            <span />
          )}
          <span className="font-mono-toile text-[0.65rem] uppercase tracking-widest text-ink-faint">
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className={buttonClasses("outline", "sm")} rel="next">
              Suivants →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
