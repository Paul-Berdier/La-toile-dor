import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, type MissionFilters } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode } from "@/lib/streamer";
import { getBoard } from "@/server/missions";
import { MissionBoard } from "@/components/missions/board";
import { BoardFilters } from "@/components/missions/filters";
import { BoardSummary, type SummaryTile } from "@/components/missions/board-summary";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(sp: SearchParams): MissionFilters {
  const csv = (key: string) => first(sp[key])?.split(",").filter(Boolean);
  const num = (key: string) => {
    const raw = Number(first(sp[key]));
    return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  };
  return {
    q: first(sp.q)?.slice(0, 200),
    rank: csv("rank") as MissionFilters["rank"],
    category: csv("category") as MissionFilters["category"],
    targetLevel: csv("level"),
    ryoMin: num("ryoMin"),
    ryoMax: num("ryoMax"),
    compatibleWithMyGroup: first(sp.compatible) === "1",
    claimed: first(sp.claimed) === "1" ? true : undefined,
    noTimeLimit: first(sp.noLimit) === "1" ? true : undefined,
    unassigned: first(sp.sansEquipe) === "1" ? true : undefined,
    expiringSoon: first(sp.urgent) === "1" ? true : undefined,
  };
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const current = await requireUser();
  const streamer = await isStreamerMode();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [board, levels] = await Promise.all([
    getBoard(current, filters, streamer),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" }, select: { slug: true, label: true } }),
  ]);

  const isModerator = board.isModerator;
  const myGroupIds = board.myGroups.map((group) => group.id);
  const soon = new Date(Date.now() + 48 * 3600 * 1000);

  // ── Résumé : ce qui appelle une action ──
  // Les comptes ne sont PAS filtrés (sinon ils bougeraient avec les filtres,
  // et ne diraient plus « ce qui reste à faire »). Ils respectent en revanche
  // la confidentialité : un chef ne compte que ses propres groupes.
  const [available, expiringSoon, unassigned, myInProgress, myPendingClaims, pendingClaims, toRegularise] =
    await Promise.all([
      prisma.mission.count({ where: { status: "AVAILABLE" } }),
      prisma.mission.count({
        where: { status: "AVAILABLE", expiresAt: { gt: new Date(), lte: soon } },
      }),
      isModerator
        ? prisma.mission.count({
            where: { status: "AVAILABLE", assignments: { none: { active: true } } },
          })
        : 0,
      myGroupIds.length > 0
        ? prisma.mission.count({
            where: {
              status: { in: ["ASSIGNED", "IN_PROGRESS"] },
              assignments: { some: { active: true, groupId: { in: myGroupIds } } },
            },
          })
        : 0,
      myGroupIds.length > 0
        ? prisma.missionClaim.count({
            where: { groupId: { in: myGroupIds }, status: { in: ["PENDING", "INFO_REQUESTED"] } },
          })
        : 0,
      isModerator
        ? prisma.missionClaim.count({ where: { status: { in: ["PENDING", "INFO_REQUESTED"] } } })
        : 0,
      isModerator
        ? prisma.mission.count({
            where: {
              status: { notIn: ["ARCHIVED"] },
              OR: [
                { targetIdentity: { not: null } },
                { clientName: { not: null } },
                { titleAuto: false },
              ],
            },
          })
        : 0,
    ]);

  const tiles: SummaryTile[] = [
    { label: "À prendre", value: available, href: "/missions" },
    {
      label: "Expirent sous 48 h",
      value: expiringSoon,
      href: "/missions?urgent=1",
      tone: "urgent",
      hint: "Contrats disponibles dont le délai court",
    },
  ];
  if (isModerator) {
    tiles.push({
      label: "Candidatures à traiter",
      value: pendingClaims,
      href: "/revendications",
      tone: "warning",
    });
    tiles.push({
      label: "Sans équipe",
      value: unassigned,
      href: "/missions?sansEquipe=1",
      hint: "Contrats publiés qu'aucun groupe n'a encore pris",
    });
    tiles.push({
      label: "À régulariser",
      value: toRegularise,
      href: "/missions/regulariser",
      tone: "warning",
      hint: "Cibles en texte libre ou titre écrit à la main",
    });
  } else if (myGroupIds.length > 0) {
    tiles.push({
      label: "Mes contrats en cours",
      value: myInProgress,
      href: "/missions?vue=liste",
    });
    tiles.push({
      label: "Mes candidatures",
      value: myPendingClaims,
      href: "/missions?claimed=1",
      tone: "warning",
    });
  }

  return (
    <main className="min-w-0 px-4 py-6 lg:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            Tableau des contrats
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            {isModerator
              ? "Ce que la Toile propose, et ce qu'elle attend de vous."
              : "Les fils disponibles attendent d'être saisis."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current.permissions.has(PERMISSIONS.MISSION_CREATE) && (
            <Link href="/missions/nouvelle" className={buttonClasses("gold", "md")}>
              Tisser un contrat
            </Link>
          )}
        </div>
      </div>

      <BoardSummary tiles={tiles} />
      <BoardFilters levels={levels} />
      <MissionBoard board={board} />
    </main>
  );
}
