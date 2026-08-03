import { prisma } from "@toile/database";
import { PERMISSIONS, DEFAULT_RP_TIME_CONFIG } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import {
  RpTimeForm,
  RankRow,
  LevelRow,
  SeasonForm,
  ScoreAdjustForm,
} from "@/components/admin/config-forms";

export const dynamic = "force-dynamic";

export default async function AdminConfigurationPage() {
  await requireUserWith(PERMISSIONS.SETTINGS_MANAGE);

  const [rpSetting, ranks, levels, seasons, factions] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "rp_time" } }),
    prisma.rankConfig.findMany({ orderBy: { dangerLevel: "asc" } }),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" } }),
    prisma.leaderboardSeason.findMany({ orderBy: { startsAt: "desc" } }),
    prisma.faction.findMany({
      where: { isActive: true },
      include: { groups: { where: { isActive: true }, select: { id: true, name: true } } },
    }),
  ]);

  const rpConfig = (rpSetting?.value as typeof DEFAULT_RP_TIME_CONFIG | null) ?? DEFAULT_RP_TIME_CONFIG;

  return (
    <div className="space-y-8">
      <section className="border border-border-default bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Temps RP
        </h2>
        <RpTimeForm current={rpConfig} />
      </section>

      <section className="border border-border-default bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Rangs de mission
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border-gold font-mono-toile text-[0.65rem] uppercase tracking-wider text-ink-faint">
                <th scope="col" className="px-3 py-2">Rang</th>
                <th scope="col" className="px-3 py-2">Ryōs min</th>
                <th scope="col" className="px-3 py-2">Ryōs max</th>
                <th scope="col" className="px-3 py-2">Points</th>
                <th scope="col" className="px-3 py-2">Effectif conseillé</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((rank) => (
                <RankRow key={rank.rank} rank={rank} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border border-border-default bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Niveaux des joueurs
        </h2>
        <ul className="max-w-md space-y-2">
          {levels.map((level) => (
            <LevelRow key={level.slug} level={level} />
          ))}
        </ul>
      </section>

      <section className="border border-border-default bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Saisons
        </h2>
        <ul className="mb-3 space-y-1 text-sm text-ink-muted">
          {seasons.map((season) => (
            <li key={season.id}>
              {season.isActive ? "◆ " : "· "}
              {season.name}
              <span className="ml-2 font-mono-toile text-[0.65rem] text-ink-faint">
                {season.startsAt.toLocaleDateString("fr-FR")}
                {season.endsAt ? ` → ${season.endsAt.toLocaleDateString("fr-FR")}` : " → en cours"}
              </span>
            </li>
          ))}
        </ul>
        <SeasonForm />
      </section>

      <section className="border border-border-default bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Registre des points — ajustement manuel
        </h2>
        <ScoreAdjustForm
          factions={factions.map((faction) => ({
            id: faction.id,
            name: faction.name,
            groups: faction.groups,
          }))}
        />
      </section>
    </div>
  );
}
