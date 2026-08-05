import Link from "next/link";
import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { Leaderboard, type LeaderRow } from "@/components/classement/leaderboard";

export const dynamic = "force-dynamic";

interface GroupScore extends LeaderRow {
  factionId: string | null;
  bestStreak: number;
  sanctions: number;
}

export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<{ saison?: string }>;
}) {
  const current = await requireUser();
  const streamer = await isStreamerMode();
  const { saison } = await searchParams;

  const seasons = await prisma.leaderboardSeason.findMany({ orderBy: { startsAt: "desc" } });
  const activeSeason =
    saison === "toutes" ? null : seasons.find((s) => s.id === saison) ?? seasons.find((s) => s.isActive) ?? null;

  const participantDateFilter = activeSeason
    ? {
        resolvedAt: {
          gte: activeSeason.startsAt,
          ...(activeSeason.endsAt ? { lte: activeSeason.endsAt } : {}),
        },
      }
    : {};

  const [groups, scores, resolvedAssignments, rewardedParticipants, myMemberships] =
    await Promise.all([
      prisma.group.findMany({
        where: { isActive: true },
        include: { faction: { select: { id: true, name: true } } },
      }),
      prisma.missionScore.findMany({
        where: activeSeason ? { seasonId: activeSeason.id } : {},
        orderBy: { createdAt: "asc" },
      }),
      prisma.missionAssignment.findMany({
        // PAS de filtre `active` : une assignation est désactivée AU MOMENT de
        // la résolution. Le filtrer revenait à ne compter aucune mission
        // terminée — d'où les « 0 accomplies » affichés jusqu'ici alors que
        // des missions l'étaient. Une assignation résolue est un fait
        // historique, pas un état courant.
        where: { mission: { status: { in: ["COMPLETED", "FAILED"] } } },
        include: {
          mission: {
            select: { status: true, rewardRyoMin: true, rewardRyoMax: true, resolvedAt: true },
          },
        },
        orderBy: { mission: { resolvedAt: "asc" } },
      }),
      prisma.missionParticipant.findMany({
        where: { mission: { status: "COMPLETED", ...participantDateFilter } },
        select: {
          userId: true,
          groupId: true,
          pointsAwarded: true,
          ryoAwarded: true,
          user: { select: { displayName: true } },
        },
      }),
      prisma.groupMember.findMany({
        where: { userId: current.session.userId, group: { isActive: true } },
        select: { groupId: true },
      }),
    ]);

  // ── Groupes ──
  const groupRows: GroupScore[] = groups.map((group) => {
    const groupScores = scores.filter((score) => score.groupId === group.id);
    const missions = resolvedAssignments
      .filter((assignment) => assignment.groupId === group.id)
      .map((assignment) => assignment.mission);
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
    return {
      id: group.id,
      name: streamer ? maskValue("GRP", group.id) : group.name,
      subtitle: streamer
        ? group.factionId
          ? maskValue("FAC", group.factionId)
          : null
        : group.faction?.name ?? "Sans faction",
      factionId: group.factionId,
      points: groupScores.reduce((sum, score) => sum + score.points, 0),
      missions: missions.filter((m) => m.status === "COMPLETED").length,
      failed: missions.filter((m) => m.status === "FAILED").length,
      ryos: rewardedParticipants
        .filter((participant) => participant.groupId === group.id)
        .reduce((sum, participant) => sum + participant.ryoAwarded, 0),
      bestStreak,
      sanctions: groupScores.filter(
        (score) => score.reason === "ADMIN_PENALTY" || score.reason === "RP_VIOLATION",
      ).length,
    };
  });
  groupRows.sort((a, b) => b.points - a.points);
  const maxPoints = Math.max(1, ...groupRows.map((r) => r.points));

  // ── Factions : somme de leurs groupes ──
  const factionMap = new Map<string, LeaderRow>();
  for (const group of groups) {
    // Les groupes indépendants ne forment pas une faction : ils restent
    // classés en tant que groupes, sans être versés dans un total fictif.
    if (!group.faction) continue;
    const row = groupRows.find((r) => r.id === group.id);
    if (!row) continue;
    const target = factionMap.get(group.faction.id) ?? {
      id: group.faction.id,
      name: streamer ? maskValue("FAC", group.faction.id) : group.faction.name,
      subtitle: null,
      points: 0,
      ryos: 0,
      missions: 0,
      failed: 0,
      groupCount: 0,
    };
    target.points += row.points;
    target.ryos += row.ryos;
    target.missions += row.missions;
    target.failed = (target.failed ?? 0) + (row.failed ?? 0);
    target.groupCount = (target.groupCount ?? 0) + 1;
    factionMap.set(group.faction.id, target);
  }
  const factionRows = [...factionMap.values()].sort((a, b) => b.points - a.points);

  // ── Agents ──
  const agentsById = new Map<string, LeaderRow>();
  for (const participant of rewardedParticipants) {
    const currentRow = agentsById.get(participant.userId) ?? {
      id: participant.userId,
      name: streamer ? maskValue("OPR", participant.userId) : participant.user.displayName,
      subtitle: null,
      points: 0,
      ryos: 0,
      missions: 0,
    };
    currentRow.points += participant.pointsAwarded;
    currentRow.ryos += participant.ryoAwarded;
    currentRow.missions += 1;
    agentsById.set(participant.userId, currentRow);
  }
  const agentRows = [...agentsById.values()].sort(
    (a, b) => b.points - a.points || b.ryos - a.ryos || a.name.localeCompare(b.name),
  );

  // ── « Votre part » : ce que le lecteur, les siens et sa faction ont touché ──
  const myGroupIds = new Set(myMemberships.map((m) => m.groupId));
  const mine = rewardedParticipants.filter((p) => p.userId === current.session.userId);
  const myTotals = {
    points: mine.reduce((sum, p) => sum + p.pointsAwarded, 0),
    ryos: mine.reduce((sum, p) => sum + p.ryoAwarded, 0),
    missions: mine.length,
  };
  const myRank = agentRows.findIndex((a) => a.id === current.session.userId);
  const myGroups = groupRows.filter((g) => myGroupIds.has(g.id));
  const myFactionIds = new Set(myGroups.map((g) => g.factionId).filter(Boolean) as string[]);
  const myFactions = factionRows.filter((f) => myFactionIds.has(f.id));

  const sum = (rows: LeaderRow[], key: "points" | "ryos" | "missions") =>
    rows.reduce((total, row) => total + row[key], 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
            Ce que la Toile a rapporté
          </h1>
          <p className="mt-1 text-xs text-ink-faint">
            Points accordés par la Toile, ryōs réellement touchés — par agent, par groupe,
            par faction.
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

      {/* Votre part — la question que chacun se pose en premier */}
      {/* Sur mobile, « Vous » occupe la largeur et les deux autres se
          partagent une ligne : trois blocs empilés repoussaient le podium
          hors de l'écran. */}
      <section aria-label="Votre part" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Purse
          className="col-span-2 sm:col-span-1"
          title="Vous"
          glyph="己"
          ryos={myTotals.ryos}
          points={myTotals.points}
          detail={
            myTotals.missions > 0
              ? `${myTotals.missions} mission${myTotals.missions > 1 ? "s" : ""}${
                  myRank >= 0 ? ` · ${myRank + 1}ᵉ sur ${agentRows.length}` : ""
                }`
              : "Aucune part reçue sur la période"
          }
          highlight
        />
        <Purse
          title={myGroups.length > 1 ? "Vos groupes" : "Votre groupe"}
          glyph="組"
          ryos={sum(myGroups, "ryos")}
          points={sum(myGroups, "points")}
          detail={
            myGroups.length > 0
              ? myGroups.map((g) => g.name).join(", ")
              : "Vous n'appartenez à aucun groupe"
          }
        />
        <Purse
          title={myFactions.length > 1 ? "Vos factions" : "Votre faction"}
          glyph="旗"
          ryos={sum(myFactions, "ryos")}
          points={sum(myFactions, "points")}
          detail={
            myFactions.length > 0
              ? myFactions.map((f) => f.name).join(", ")
              : "Sans rattachement de faction"
          }
        />
      </section>

      {/* Constellation — masquée sur mobile où la liste prend le relais */}
      <section
        aria-label="Toile des groupes"
        className="mt-6 hidden border border-border-gold bg-raised sm:block"
      >
        <Constellation rows={groupRows} maxPoints={maxPoints} />
      </section>

      {/* Podium */}
      {groupRows.length > 0 && (
        <section aria-label="Podium" className="mt-6 grid gap-3 sm:grid-cols-3">
          {groupRows.slice(0, 3).map((row, i) => (
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
              <p className="truncate text-[0.65rem] text-ink-faint">{row.subtitle}</p>
              <p className="font-mono-toile text-lg text-gold">{row.points} pts</p>
              <p className="font-mono-toile text-xs text-ink-muted">
                <span aria-hidden>両</span> {row.ryos.toLocaleString("fr-FR")}
              </p>
              <p className="mt-1 text-[0.65rem] text-ink-faint">
                {row.missions} accomplies · série max {row.bestStreak}
                {row.sanctions > 0 && (
                  <span className="text-blood-bright"> · {row.sanctions} sanction{row.sanctions > 1 ? "s" : ""}</span>
                )}
              </p>
            </div>
          ))}
        </section>
      )}

      <div className="mt-6">
        <Leaderboard groups={groupRows} factions={factionRows} agents={agentRows} />
      </div>
    </main>
  );
}

/** Bourse : ce qu'une échelle (soi, son groupe, sa faction) a touché. */
function Purse({
  title,
  glyph,
  ryos,
  points,
  detail,
  highlight = false,
  className = "",
}: {
  title: string;
  glyph: string;
  ryos: number;
  points: number;
  detail: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`border p-3 sm:p-4 ${className} ${
        highlight ? "border-gold bg-gold-faint/20" : "border-border-default bg-raised"
      }`}
    >
      <p className="flex items-center gap-2 font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">
        <span aria-hidden className="font-display text-sm text-gold-dim">
          {glyph}
        </span>
        {title}
      </p>
      <p className="mt-2 font-mono-toile text-xl text-gold sm:text-2xl">
        <span aria-hidden className="mr-1 text-sm text-gold-dim sm:text-base">
          両
        </span>
        {ryos.toLocaleString("fr-FR")}
      </p>
      <p className="font-mono-toile text-xs text-ink-muted">{points.toLocaleString("fr-FR")} pts</p>
      <p className="mt-1 truncate text-[0.65rem] text-ink-faint" title={detail}>
        {detail}
      </p>
    </div>
  );
}

/** Toile SVG : chaque groupe est un nœud relié au centre par un fil d'or
    dont l'épaisseur et l'éclat reflètent ses points. */
function Constellation({ rows, maxPoints }: { rows: GroupScore[]; maxPoints: number }) {
  const cx = 400;
  const cy = 235;
  const radius = 158;
  const nodes = rows.map((row, i) => {
    // Décalage angulaire et rayon variés (déterministes) : une toile
    // irrégulière, pas une rose des vents.
    const angle = (i * Math.PI * 2) / Math.max(3, rows.length) - Math.PI / 2 + 0.42 + ((i * 53) % 7) / 10;
    const r = radius * (0.72 + ((i * 37) % 8) / 22);
    return {
      ...row,
      x: cx + Math.cos(angle) * r,
      // Aplatissement plus doux qu'avant : à huit nœuds, les libellés des
      // groupes proches se chevauchaient.
      y: cy + Math.sin(angle) * r * 0.9,
      weight: row.points / maxPoints,
    };
  });

  return (
    <svg viewBox="0 0 800 500" className="h-auto w-full" role="img" aria-label="Réseau des groupes">
      {/* Anneaux de la toile */}
      <g fill="none" stroke="var(--toile-gold-faint)" strokeWidth="0.6">
        {[60, 105, 150].map((r) => (
          <ellipse key={r} cx={cx} cy={cy} rx={r} ry={r * 0.78} />
        ))}
      </g>
      {/* Fils entre groupes voisins */}
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
      {/* Nœuds de groupe */}
      {nodes.map((node) => {
        const nodeRadius = 5 + node.weight * 9;
        const above = node.y < cy;
        // Le texte fuit le centre : ancré à gauche pour les nœuds de droite et
        // inversement, deux libellés voisins ne se recouvrent plus.
        const side = node.x > cx + 40 ? "start" : node.x < cx - 40 ? "end" : "middle";
        const textX = side === "start" ? node.x + nodeRadius + 6 : side === "end" ? node.x - nodeRadius - 6 : node.x;
        const nameY = side === "middle" ? (above ? node.y - nodeRadius - 22 : node.y + nodeRadius + 18) : node.y - 3;
        const statY = nameY + 14;
        return (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={nodeRadius}
              fill="var(--toile-bg-elevated)"
              stroke="var(--toile-gold)"
              strokeWidth={1 + node.weight * 1.5}
            />
            {/* Contour de la couleur du fond : deux nœuds voisins peuvent
                encore se frôler, le texte reste lisible par-dessus le fil. */}
            <text
              x={textX}
              y={nameY}
              textAnchor={side}
              fontSize="13"
              fill="var(--toile-ink)"
              fontFamily="var(--toile-font-body)"
              stroke="var(--toile-bg-raised)"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {node.name.replace("[FICTIF] ", "")}
            </text>
            {/* Points ET ryōs : la toile sert le propos de la page,
                elle ne se contente pas de décorer. */}
            <text
              x={textX}
              y={statY}
              textAnchor={side}
              fontSize="11"
              fill="var(--toile-gold)"
              fontFamily="var(--toile-font-mono)"
              stroke="var(--toile-bg-raised)"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {node.points} pts
              {node.ryos > 0 && ` · 両 ${Math.round(node.ryos / 1000)} k`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
