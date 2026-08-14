import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { CreateWizard } from "@/components/missions/create-wizard";

export const dynamic = "force-dynamic";

export default async function NouvelleMissionPage() {
  await requireUserWith(PERMISSIONS.MISSION_CREATE);
  const [levels, factions, rankConfigs] = await Promise.all([
    prisma.playerLevel.findMany({
      orderBy: { order: "asc" },
      select: { slug: true, label: true },
    }),
    prisma.faction.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    prisma.rankConfig.findMany({
      orderBy: { dangerLevel: "asc" },
      select: {
        rank: true,
        rewardRyoMin: true,
        rewardRyoMax: true,
        defaultPoints: true,
        recommendedGroupSize: true,
        minLevel: { select: { slug: true } },
      },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Tisser un contrat
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Dix étapes, un fil. Vérifiez chaque aperçu avant de publier.
      </p>
      <CreateWizard
        levels={levels}
        factions={factions}
        rankConfigs={rankConfigs.map(({ minLevel, ...config }) => ({
          ...config,
          minLevelSlug: minLevel?.slug ?? null,
        }))}
      />
    </main>
  );
}
