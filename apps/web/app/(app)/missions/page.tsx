import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, type MissionFilters } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode } from "@/lib/streamer";
import { getBoard } from "@/server/missions";
import { MissionBoard } from "@/components/missions/board";
import { BoardFilters } from "@/components/missions/filters";
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
  };
}

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const current = await requireUser();
  const streamer = await isStreamerMode();
  const filters = parseFilters(await searchParams);

  const [board, levels] = await Promise.all([
    getBoard(current, filters, streamer),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" }, select: { slug: true, label: true } }),
  ]);

  return (
    <main className="px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            Tableau des contrats
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            {board.isModerator
              ? "Glissez un contrat d'une colonne à l'autre pour sceller son destin."
              : "Les fils disponibles attendent d'être saisis."}
          </p>
        </div>
        {current.permissions.has(PERMISSIONS.MISSION_CREATE) && (
          <Link href="/missions/nouvelle" className={buttonClasses("gold", "md")}>
            Tisser un contrat
          </Link>
        )}
      </div>

      <BoardFilters levels={levels} />
      <MissionBoard board={board} />
    </main>
  );
}
