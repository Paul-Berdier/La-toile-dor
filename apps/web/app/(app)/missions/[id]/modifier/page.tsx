import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@toile/database";
import { missionCreateSchema, PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { CreateWizard } from "@/components/missions/create-wizard";

export const dynamic = "force-dynamic";

export default async function ModifierMissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUserWith(PERMISSIONS.MISSION_UPDATE);
  const { id } = await params;

  const [mission, levels, factions] = await Promise.all([
    prisma.mission.findUnique({
      where: { id },
      include: {
        visibility: true,
        targetLevel: { select: { slug: true } },
        minRecommendedLevel: { select: { slug: true } },
      },
    }),
    prisma.playerLevel.findMany({
      orderBy: { order: "asc" },
      select: { slug: true, label: true },
    }),
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
  ]);

  if (!mission || mission.status === "ARCHIVED") notFound();

  const initialValues = missionCreateSchema.parse({
    publicTitle: mission.publicTitle,
    internalTitle: mission.internalTitle ?? "",
    category: mission.category,
    rank: mission.rank,
    publicSummary: mission.publicSummary ?? "",
    confidentialDescription: mission.confidentialDescription ?? "",
    primaryObjective: mission.primaryObjective ?? "",
    secondaryObjectives: Array.isArray(mission.secondaryObjectives)
      ? mission.secondaryObjectives
      : [],
    targetIdentity: mission.targetIdentity ?? "",
    targetFactionId: mission.targetFactionId ?? "",
    location: mission.location ?? "",
    clientName: mission.clientName ?? "",
    constraints: mission.constraints ?? "",
    prohibitions: mission.prohibitions ?? "",
    evidence: mission.evidence ?? "",
    moderatorNotes: mission.moderatorNotes ?? "",
    rewardRyoMin: mission.rewardRyoMin,
    rewardRyoMax: mission.rewardRyoMax,
    basePoints: mission.basePoints,
    targetLevelSlug: mission.targetLevel?.slug,
    minRecommendedLevelSlug: mission.minRecommendedLevel?.slug,
    groupSizeMin: mission.groupSizeMin,
    groupSizeMax: mission.groupSizeMax,
    eligibilityMode: mission.eligibilityMode,
    expiresAt: mission.expiresAt?.toISOString() ?? null,
    rpDuration: null,
    visibility: mission.visibility ?? {
      showCategory: true,
      showTargetLevel: true,
      showSummary: true,
    },
    publish: mission.status !== "DRAFT",
    notifyLeaders: true,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <Link
        href={`/missions/${mission.id}`}
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Retour au contrat
      </Link>
      <h1 className="mt-4 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Modifier le contrat
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        {mission.code} — les changements sont journalisés et les groupes concernés peuvent être
        prévenus.
      </p>
      <CreateWizard
        levels={levels}
        factions={factions}
        mode="edit"
        missionId={mission.id}
        currentStatus={mission.status}
        initialValues={initialValues}
      />
    </main>
  );
}
