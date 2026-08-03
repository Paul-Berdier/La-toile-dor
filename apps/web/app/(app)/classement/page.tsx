import Link from "next/link";
import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";

export const dynamic = "force-dynamic";

interface FactionScore {
  id: string;
  name: string;
  points: number;
  completed: number;
  failed: number;
  ryosEarned: number;
  bestStreak: number;
  sanctions: number;
  groups: { id: string; name: string; points: number }[];
}

export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<{ saison?: string }>;
}) {
  await requireUser();
  const streamer = await isStreamerMode();
  const { saison } = await searchParams;

  const seasons = await prisma.leaderboardSeason.findMany({ orderBy: { startsAt: "desc" } });
  const activeSeason = saison === "toutes" ? null : seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.isActive) ?? null;

  const [factions, scores, resolvedMissions] = await Promise.all([
    prisma.faction.findMany({
      where: { isActive: true },
      include: { groups: { where: { isActive: true } } },
    }),
    prisma.missionScore.findMany({
      where: activeSeason ? { seasonId: activeSeason.id } : {},
      orderBy: { createdAt: "asc" },
    }),
    prisma.mission.findMany({
      where: { status: { in: ["COMPLETED", "FAILED"] }, assignedFactionId: { not: null } },
      select: {
        assignedFactionId: true,
        status: true,
        rewardRyoMin: true,
        rewardRyoMax: true,
        resolvedAt: true,
      },
      orderBy: { resolvedAt: "asc" },
    }),
  ]);

  const rows: FactionScore[] = factions.map((faction) => {
    const factionScores = scores.filter((s) => s.factionId === faction.id);
    const missions = resolvedMissions.filter((m) => m.assignedFactionId === faction.id);
    // Série de victoires la plus longue (missions résolues, ordre chronologique)
    let bestStreak = 0;
    let streak = 0;
    for (const mission of missions) {
      if (mission.status === "COMPLETED") {
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 0;
      }
    }
    const groupTotals = new Map<string, number>();
    for (const score of factionScores) {
      if (score.groupId) {
        groupTotals.set(score.groupId, (groupTotals.get(score.groupId) ?? 0) + score.points);
      }
    }
    return {
      id: faction.id,
      name: streamer ? maskValue("FAC", faction.id) : faction.name,
      points: factionScores.reduce((sum, s) => sum + s.points, 0),
      completed: missions.filter((m) => m.status === "COMPLETED").length,
      failed: missions.filter((m) => m.status === "FAILED").length,
      ryosEarned: missions
        .filter((m) => m.status === "COMPLETED")
        .reduce((sum, m) => sum + Math.round((m.rewardRyoMin + m.rewardRyoMax) / 2), 0),
      bestStreak,
      sanctions: factionScores.filter((s) => s.reason === "ADMIN_PENALTY" || s.reason === "RP_VIOLATION").length,
      groups: faction.groups
        .map((group) => ({
          id: group.id,
          name: streamer ? maskValue("GRP", group.id) : group.name,
          points: groupTotals.get(group.id) ?? 0,
        }))
        .sort((a, b) => b.points - a.points),
    };
  });

  rows.sort((a, b) => b.points - a.points);
  const maxPoints = Math.max(1, ...rows.map((r) => r.points));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            La constellation des factions
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            Plus le fil est épais, plus la faction pèse sur la Toile.
          </p>
        </div>
        <nav aria-label="Filtrer par saison" className="flex flex-wrap gap-1">
          {seasons.map((season) => (
            <Link
              key={season.id}
              href={`/classement?saison=${season.id}`}
              aria-current={activeSeason?.id === season.id ? "true" : undefined}
              className={`border px-3 py-1 text-xs ${
                activeSeason?.id === season.id
                  ? "border-gold bg-gold text-obsidian"
                  : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
              }`}
            >
              {season.name}
            </Link>
          ))}
          <Link
            href="/classement?saison=toutes"
            aria-current={!activeSeason ? "true" : undefined}
            className={`border px-3 py-1 text-xs ${
              !activeSeason
                ? "border-gold bg-gold text-obsidian"
                : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
            }`}
          >
            Toute la durée
          </Link>
        </nav>
      </div>

      {/* Constellation — masquée sur mobile où la liste ci-dessous prend le relais */}
      <section
        aria-label="Toile des factions"
        className="mt-6 hidden border border-border-gold bg-raised sm:block"
      >
        <Constellation rows={rows} maxPoints={maxPoints} />
      </section>

      {/* Podium */}
      <section aria-label="Podium" className="mt-6 grid gap-3 sm:grid-cols-3">
        {rows.slice(0, 3).map((row, i) => (
          <div
            key={row.id}
            className={`border p-4 text-center ${
              i === 0
                ? "border-gold bg-gold-faint/30 sm:order-2"
                : i === 1
                  ? "border-border-strong sm:order-1"
                  : "border-copper/60 sm:order-3"
            }`}
          >
            <p className="font-display text-2xl text-gold">{["Ⅰ", "Ⅱ", "Ⅲ"][i]}</p>
            <p className="mt-1 truncate text-sm font-medium text-ink">{row.name}</p>
            <p className="font-mono-toile text-lg text-gold">{row.points} pts</p>
            <p className="text-[0.65rem] text-ink-faint">
              {row.completed} accomplies · série max {row.bestStreak}
            </p>
          </div>
        ))}
      </section>

      {/* Détail par faction */}
      <section aria-label="Statistiques détaillées" className="mt-6 space-y-3">
        {rows.map((row, i) => {
          const total = row.completed + row.failed;
          const successRate = total > 0 ? Math.round((row.completed / total) * 100) : null;
          return (
            <details key={row.id} className="group border border-border-default bg-raised">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-4 hover:bg-hover-bg">
                <span className="w-8 font-display text-lg text-gold-dim">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
                {/* Fil de progression */}
                <span aria-hidden className="hidden h-px flex-1 bg-border-default sm:block">
                  <span
                    className="block h-px bg-gold transition-all"
                    style={{ width: `${Math.max(2, (row.points / maxPoints) * 100)}%` }}
                  />
                </span>
                <span className="font-mono-toile text-sm text-gold">{row.points} pts</span>
              </summary>
              <dl className="grid grid-cols-2 gap-3 border-t border-border-default p-4 text-xs sm:grid-cols-5">
                <Stat label="Taux de réussite" value={successRate !== null ? `${successRate} %` : "—"} />
                <Stat label="Accomplies" value={String(row.completed)} />
                <Stat label="Échouées" value={String(row.failed)} />
                <Stat label="Ryōs gagnés" value={row.ryosEarned.toLocaleString("fr-FR")} />
                <Stat
                  label="Sanctions"
                  value={String(row.sanctions)}
                  danger={row.sanctions > 0}
                />
              </dl>
              {row.groups.length > 0 && (
                <ul className="border-t border-border-default p-4 text-xs text-ink-muted">
                  {row.groups.map((group) => (
                    <li key={group.id} className="flex justify-between py-0.5">
                      <span>{group.name}</span>
                      <span className="font-mono-toile">{group.points} pts</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </section>
    </main>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt className="text-[0.6rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 font-mono-toile ${danger ? "text-blood-bright" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** Toile SVG : chaque faction est un nœud relié au centre par un fil d'or
    dont l'épaisseur et l'éclat reflètent ses points. */
function Constellation({ rows, maxPoints }: { rows: FactionScore[]; maxPoints: number }) {
  const cx = 400;
  const cy = 210;
  const radius = 150;
  const nodes = rows.map((row, i) => {
    // Décalage angulaire et rayon variés (déterministes) : une toile
    // irrégulière, pas une rose des vents.
    const angle = (i * Math.PI * 2) / Math.max(3, rows.length) - Math.PI / 2 + 0.42 + ((i * 53) % 7) / 10;
    const r = radius * (0.72 + ((i * 37) % 8) / 22);
    return {
      ...row,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r * 0.78,
      weight: row.points / maxPoints,
    };
  });

  return (
    <svg viewBox="0 0 800 420" className="h-auto w-full" role="img" aria-label="Réseau des factions">
      {/* Anneaux de la toile */}
      <g fill="none" stroke="var(--toile-gold-faint)" strokeWidth="0.6">
        {[60, 105, 150].map((r) => (
          <ellipse key={r} cx={cx} cy={cy} rx={r} ry={r * 0.78} />
        ))}
      </g>
      {/* Fils entre factions voisines */}
      <g stroke="var(--toile-gold-dim)" strokeWidth="0.5" opacity="0.5">
        {nodes.map((node, i) => {
          const next = nodes[(i + 1) % nodes.length];
          if (!next || nodes.length < 2) return null;
          return <line key={node.id} x1={node.x} y1={node.y} x2={next.x} y2={next.y} />;
        })}
      </g>
      {/* Fils centraux pondérés */}
      {nodes.map((node) => (
        <line
          key={node.id}
          x1={cx}
          y1={cy}
          x2={node.x}
          y2={node.y}
          stroke="var(--toile-gold)"
          strokeWidth={0.6 + node.weight * 3.4}
          opacity={0.35 + node.weight * 0.6}
        />
      ))}
      {/* Centre : l'araignée de la Toile */}
      <circle cx={cx} cy={cy} r="7" fill="var(--toile-gold-bright)" />
      <circle cx={cx} cy={cy} r="12" fill="none" stroke="var(--toile-gold-dim)" strokeWidth="0.8" />
      {/* Nœuds de faction */}
      {nodes.map((node) => (
        <g key={node.id}>
          <circle
            cx={node.x}
            cy={node.y}
            r={5 + node.weight * 9}
            fill="var(--toile-bg-elevated)"
            stroke="var(--toile-gold)"
            strokeWidth={1 + node.weight * 1.5}
          />
          <text
            x={node.x}
            y={node.y < cy ? node.y - (5 + node.weight * 9) - 24 : node.y + (5 + node.weight * 9) + 18}
            textAnchor="middle"
            fontSize="13"
            fill="var(--toile-ink)"
            fontFamily="var(--toile-font-body)"
          >
            {node.name.replace("[FICTIF] ", "")}
          </text>
          <text
            x={node.x}
            y={node.y < cy ? node.y - (5 + node.weight * 9) - 9 : node.y + (5 + node.weight * 9) + 33}
            textAnchor="middle"
            fontSize="11"
            fill="var(--toile-gold)"
            fontFamily="var(--toile-font-mono)"
          >
            {node.points} pts
          </text>
        </g>
      ))}
    </svg>
  );
}
