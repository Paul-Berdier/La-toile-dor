import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@toile/database";
import {
  PERMISSIONS,
  PROFILE_FIELD_KEYS,
  type MissionDeadlineInput,
  type MissionEditorInput,
  type MissionProfileRole,
  type ProfileFieldKey,
} from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { MissionEditor } from "@/components/missions/mission-editor";
import type { PickedProfile } from "@/components/missions/profile-picker";
import { getRpTimeConfig } from "@/server/rp-config";

export const dynamic = "force-dynamic";

export default async function ModifierMissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const current = await requireUserWith(PERMISSIONS.MISSION_UPDATE);
  const { id } = await params;

  const [mission, levels, rankConfigs, rpConfig] = await Promise.all([
    prisma.mission.findUnique({
      where: { id },
      include: {
        visibility: true,
        minRecommendedLevel: { select: { slug: true } },
        // Les liens vers les dossiers : cibles, commanditaires, contacts.
        // Ils sont la source des cibles depuis la refonte — les colonnes
        // historiques ne servent plus qu'aux missions non régularisées.
        targets: {
          where: { profileId: { not: null } },
          orderBy: { createdAt: "asc" },
          select: {
            profileId: true,
            role: true,
            isPrimary: true,
            profile: {
              select: {
                code: true,
                characterFirstName: true,
                characterLastName: true,
                lifeStatus: true,
                rank: { select: { label: true } },
                ninjaClass: { select: { label: true } },
                faction: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" }, select: { slug: true, label: true } }),
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

  if (!mission || mission.status === "ARCHIVED") notFound();

  const canOverrideTitle = current.permissions.has(PERMISSIONS.SETTINGS_MANAGE);

  // Le délai est une DATE en base ; l'éditeur en montre l'intention la plus
  // simple à relire — la date elle-même.
  const deadline: MissionDeadlineInput = mission.expiresAt
    ? { mode: "DATE", at: mission.expiresAt.toISOString() }
    : { mode: "NONE" };

  const soughtFieldKeys = Array.isArray(mission.soughtFieldKeys)
    ? (mission.soughtFieldKeys as unknown[]).filter((key): key is ProfileFieldKey =>
        typeof key === "string" && (PROFILE_FIELD_KEYS as readonly string[]).includes(key),
      )
    : [];

  const initialValues: MissionEditorInput = {
    category: mission.category,
    rank: mission.rank,
    rankModifier: mission.rankModifier,
    rewardRyoMin: mission.rewardRyoMin,
    rewardRyoMax: mission.rewardRyoMax,
    basePoints: mission.basePoints,
    deadline,
    links: mission.targets.map((link) => ({
      profileId: link.profileId!,
      role: link.role as MissionProfileRole,
      isPrimary: link.isPrimary,
    })),
    primaryObjective: mission.primaryObjective ?? undefined,
    secondaryObjectives: Array.isArray(mission.secondaryObjectives)
      ? (mission.secondaryObjectives as { label: string; secret?: boolean; points?: number }[])
      : [],
    publicSummary: mission.publicSummary ?? undefined,
    confidentialDescription: mission.confidentialDescription ?? undefined,
    location: mission.location ?? undefined,
    constraints: mission.constraints ?? undefined,
    prohibitions: mission.prohibitions ?? undefined,
    evidence: mission.evidence ?? undefined,
    soughtFieldKeys,
    internalTitle: mission.internalTitle ?? undefined,
    moderatorNotes: mission.moderatorNotes ?? undefined,
    minRecommendedLevelSlug: mission.minRecommendedLevel?.slug ?? undefined,
    groupSizeMin: mission.groupSizeMin,
    groupSizeMax: mission.groupSizeMax,
    // MANUAL_REVIEW n'est plus produit ; d'anciennes missions le portent encore
    eligibilityMode:
      mission.eligibilityMode === "MANUAL_REVIEW" ? "WARNING" : mission.eligibilityMode,
    requiresEnhancedReview:
      mission.requiresEnhancedReview || mission.eligibilityMode === "MANUAL_REVIEW",
    originVisibility: mission.originVisibility,
    visibility: mission.visibility
      ? {
          showCategory: mission.visibility.showCategory,
          showTargetLevel: mission.visibility.showTargetLevel,
          showSummary: mission.visibility.showSummary,
        }
      : { showCategory: true, showTargetLevel: true, showSummary: true },
    notifyLeaders: true,
    // Un titre imposé se rouvre tel quel — mais SEULEMENT pour qui a le droit
    // de l'imposer. Sinon la sauvegarde serait refusée, et un modérateur ne
    // pourrait plus corriger une mission historique : son titre repasse alors
    // en automatique, ce que le bandeau ci-dessous annonce.
    ...(mission.titleAuto || !canOverrideTitle
      ? {}
      : { titleOverride: mission.publicTitle, titleOverrideReason: mission.titleOverrideReason ?? undefined }),
  };

  const initialPicked: PickedProfile[] = mission.targets
    .filter((link) => link.profile)
    .map((link) => ({
      profileId: link.profileId!,
      role: link.role as MissionProfileRole,
      isPrimary: link.isPrimary,
      code: link.profile!.code,
      name: [link.profile!.characterFirstName, link.profile!.characterLastName]
        .filter(Boolean)
        .join(" "),
      gradeLabel: link.profile!.rank?.label ?? null,
      classLabel: link.profile!.ninjaClass?.label ?? null,
      originLabel: link.profile!.faction?.name ?? null,
      lifeStatus: link.profile!.lifeStatus,
    }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <Link
        href={`/missions/${mission.id}`}
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Retour au contrat
      </Link>
      <h1 className="mt-4 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Modifier le contrat
      </h1>
      <p className="mt-1 mb-5 text-xs text-ink-faint">
        {mission.code} — les changements sont journalisés et les groupes concernés peuvent être
        prévenus.
      </p>
      {/* Un titre écrit à la main repassera en automatique si celui qui édite
          n'a pas le droit de l'imposer : mieux vaut le dire avant. */}
      {!mission.titleAuto && !canOverrideTitle && (
        <p className="mb-3 border border-copper/50 bg-raised px-3 py-2 text-xs text-copper">
          Le titre « {mission.publicTitle} » avait été écrit à la main. En enregistrant, il sera
          remplacé par le titre calculé — seul un super-modérateur peut en imposer un.
        </p>
      )}
      {/* Cibles historiques en texte libre : elles attendent d'être reliées à
          un dossier. On les montre plutôt que de les faire disparaître. */}
      {(mission.targetIdentity || mission.clientName) && (
        <p className="mb-4 border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
          Mission saisie avant les dossiers :{" "}
          {mission.targetIdentity && <>cible « {mission.targetIdentity} »</>}
          {mission.targetIdentity && mission.clientName && " · "}
          {mission.clientName && <>commanditaire « {mission.clientName} »</>}. Rattachez le dossier
          correspondant ci-dessous — le texte reste conservé jusque-là.
        </p>
      )}
      <MissionEditor
        mode="edit"
        missionId={mission.id}
        status={mission.status}
        levels={levels}
        rankConfigs={rankConfigs.map(({ minLevel, ...config }) => ({
          ...config,
          minLevelSlug: minLevel?.slug ?? null,
        }))}
        rpMonthMs={rpConfig.realMsPerRpMonth}
        initialValues={initialValues}
        initialPicked={initialPicked}
        canOverrideTitle={canOverrideTitle}
      />
    </main>
  );
}
