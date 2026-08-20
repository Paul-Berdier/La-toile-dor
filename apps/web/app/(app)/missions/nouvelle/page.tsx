import { prisma } from "@toile/database";
import { PERMISSIONS, EMPTY_DEADLINE, type MissionEditorInput } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { MissionEditor } from "@/components/missions/mission-editor";
import { getRpTimeConfig } from "@/server/rp-config";

export const dynamic = "force-dynamic";

export default async function NouvelleMissionPage() {
  const current = await requireUserWith(PERMISSIONS.MISSION_CREATE);
  const [levels, rankConfigs, rpConfig] = await Promise.all([
    prisma.playerLevel.findMany({
      orderBy: { order: "asc" },
      select: { slug: true, label: true },
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
    getRpTimeConfig(),
  ]);

  const configs = rankConfigs.map(({ minLevel, ...config }) => ({
    ...config,
    minLevelSlug: minLevel?.slug ?? null,
  }));
  const dDefaults = configs.find((c) => c.rank === "D");

  // Un contrat neuf part du rang le plus bas, barème compris : la plupart des
  // missions sont des D, et le formulaire doit être juste dès l'ouverture.
  const initialValues: MissionEditorInput = {
    category: "COLLECTE_INFORMATIONS",
    rank: "D",
    rankModifier: "NONE",
    rewardRyoMin: dDefaults?.rewardRyoMin ?? 5_000,
    rewardRyoMax: dDefaults?.rewardRyoMax ?? 50_000,
    basePoints: dDefaults?.defaultPoints ?? 10,
    deadline: EMPTY_DEADLINE,
    links: [],
    secondaryObjectives: [],
    soughtFieldKeys: [],
    groupSizeMin: 1,
    groupSizeMax: dDefaults?.recommendedGroupSize ?? 4,
    eligibilityMode: "WARNING",
    requiresEnhancedReview: false,
    originVisibility: "SHOW",
    visibility: { showCategory: true, showTargetLevel: true, showSummary: true },
    notifyLeaders: true,
    minRecommendedLevelSlug: dDefaults?.minLevelSlug ?? undefined,
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Tisser un contrat
      </h1>
      <p className="mt-1 mb-5 text-xs text-ink-faint">
        Le type, le rang, contre qui, pour combien — le reste est facultatif. Le titre public se
        compose tout seul.
      </p>
      <MissionEditor
        mode="create"
        levels={levels}
        rankConfigs={configs}
        rpMonthMs={rpConfig.realMsPerRpMonth}
        initialValues={initialValues}
        initialPicked={[]}
        canOverrideTitle={current.permissions.has(PERMISSIONS.SETTINGS_MANAGE)}
      />
    </main>
  );
}
