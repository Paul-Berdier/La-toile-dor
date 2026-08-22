import Link from "next/link";
import { prisma } from "@toile/database";
import { ELIGIBILITY_MODE_LABELS, PERMISSIONS, STATUS_LABELS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { RankSeal } from "@/components/missions/rank-seal";
import { ClaimDecide } from "@/components/missions/claim-decide";

export const dynamic = "force-dynamic";

export default async function RevendicationsPage() {
  await requireUserWith(PERMISSIONS.CLAIM_REVIEW);

  const claims = await prisma.missionClaim.findMany({
    where: { status: { in: ["PENDING", "INFO_REQUESTED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      mission: { include: { minRecommendedLevel: true } },
      leader: { include: { playerLevel: true } },
      participants: { include: { user: { include: { playerLevel: true } } } },
      group: {
        include: {
          faction: true,
          members: { include: { user: { include: { playerLevel: true } } } },
          assignments: { where: { active: true }, select: { missionId: true } },
          scores: { select: { points: true, reason: true } },
        },
      },
    },
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Revendications en attente
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Chaque fil réclamé attend votre sceau : attribuer, refuser, ou exiger des précisions.
      </p>

      {claims.length === 0 && (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Aucun fil ne vibre. La Toile est silencieuse.
        </p>
      )}

      <ul className="space-y-5">
        {claims.map((claim) => {
          const members = claim.participants;
          const requiredLevel = claim.mission.minRecommendedLevel;
          const belowMinimumHeadcount = members.length < claim.mission.groupSizeMin;
          const aboveMaximumHeadcount = members.length > claim.mission.groupSizeMax;
          const headcountIsValid = !belowMinimumHeadcount && !aboveMaximumHeadcount;
          const missingLevelMembers = requiredLevel
            ? members.filter((participant) => !participant.user.playerLevel)
            : [];
          const belowLevelMembers = requiredLevel
            ? members.filter(
                (participant) =>
                  participant.user.playerLevel !== null &&
                  participant.user.playerLevel.order < requiredLevel.order,
              )
            : [];
          const levelIsValid = missingLevelMembers.length === 0 && belowLevelMembers.length === 0;
          const claimHasBlockingGap = aboveMaximumHeadcount || !levelIsValid;
          const requiresEnhancedReview =
            claim.mission.requiresEnhancedReview ||
            claim.mission.eligibilityMode === "MANUAL_REVIEW";
          const completedPoints = claim.group.scores
            .filter((s) => s.reason === "MISSION_COMPLETED")
            .length;
          const failed = claim.group.scores.filter((s) => s.reason === "MISSION_FAILED").length;
          const inProgress = claim.group.assignments.length;
          const warnings = Array.isArray(claim.warnings) ? (claim.warnings as string[]) : [];

          return (
            <li key={claim.id} className="border border-border-default bg-raised">
              <div className="flex flex-wrap items-center gap-3 border-b border-border-gold p-4">
                <RankSeal rank={claim.mission.rank} size={40} />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/missions/${claim.missionId}`}
                    className="font-mono-toile text-xs text-ink-faint hover:text-gold"
                  >
                    {claim.mission.code}
                  </Link>
                  <p className="truncate text-sm font-medium text-ink">
                    {claim.mission.publicTitle}
                  </p>
                </div>
                <span className="font-mono-toile text-[0.65rem] uppercase text-ink-faint">
                  {claim.status === "INFO_REQUESTED"
                    ? "Précisions demandées"
                    : STATUS_LABELS[claim.mission.status]}
                </span>
                <span className="border border-border-default px-2 py-0.5 font-mono-toile text-[0.6rem] uppercase text-gold">
                  {ELIGIBILITY_MODE_LABELS[claim.mission.eligibilityMode]}
                </span>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <h2 className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
                    Groupe et agents engagés
                  </h2>
                  <p className="mt-1 text-sm text-ink">
                    {claim.group.name}
                    {claim.group.faction ? ` · ${claim.group.faction.name}` : ""}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Chef : {claim.leader.displayName}
                    {claim.leader.playerLevel ? ` (${claim.leader.playerLevel.label})` : ""}
                  </p>
                  <p className="mt-1 font-mono-toile text-[0.65rem] text-ink-faint">
                    {claim.publicRoster
                      ? "Roster public : groupe et pseudonymes"
                      : "Roster invisible pour les autres joueurs"}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                    {members.map((participant) => {
                      const playerLevel = participant.user.playerLevel;
                      const belowMinimum =
                        requiredLevel !== null &&
                        playerLevel !== null &&
                        playerLevel.order < requiredLevel.order;
                      const meetsMinimum =
                        requiredLevel !== null &&
                        playerLevel !== null &&
                        playerLevel.order >= requiredLevel.order;
                      return (
                        <li key={participant.userId}>
                          · {participant.user.displayName}{" "}
                          {!playerLevel ? (
                            <span className="text-warning">
                              — niveau manquant{requiredLevel ? " · non conforme" : ""}
                            </span>
                          ) : (
                            <span
                              className={
                                belowMinimum
                                  ? "text-warning"
                                  : meetsMinimum
                                    ? "text-success"
                                    : "text-ink-faint"
                              }
                            >
                              — {playerLevel.label}
                              {belowMinimum
                                ? ` · sous le seuil ${requiredLevel.label}`
                                : meetsMinimum
                                  ? " · conforme"
                                  : ""}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <h2 className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
                    Adéquation aux critères actuels
                  </h2>
                  <dl className="mt-1 space-y-1 text-xs text-ink-muted">
                    <div className="flex justify-between">
                      <dt>Contribution proposée</dt>
                      <dd
                        className={
                          headcountIsValid
                            ? "text-success"
                            : aboveMaximumHeadcount
                              ? "text-warning"
                              : "text-ink-muted"
                        }
                      >
                        {members.length} / {claim.mission.groupSizeMin} à {claim.mission.groupSizeMax}
                        {headcountIsValid
                          ? " · conforme"
                          : aboveMaximumHeadcount
                            ? " · maximum dépassé"
                            : " · à compléter"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Seuil individuel</dt>
                      <dd className={levelIsValid ? "text-success" : "text-warning"}>
                        {requiredLevel
                          ? `${requiredLevel.label} · ${levelIsValid ? "conforme" : `${missingLevelMembers.length + belowLevelMembers.length} écart${missingLevelMembers.length + belowLevelMembers.length > 1 ? "s" : ""}`}`
                          : "Aucun minimum"}
                      </dd>
                    </div>
                    <div className="flex justify-between border-t border-border-default pt-1 font-medium">
                      <dt>Bilan actuel</dt>
                      <dd className={claimHasBlockingGap ? "text-warning" : belowMinimumHeadcount ? "text-gold" : "text-success"}>
                        {claimHasBlockingGap
                          ? "Écart à contrôler"
                          : belowMinimumHeadcount
                            ? "Collaboration nécessaire"
                            : "Critères remplis"}
                      </dd>
                    </div>
                  </dl>

                  {requiresEnhancedReview && (
                    <p className="mt-2 border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      Contrôle renforcé obligatoire : confirmez la vérification et laissez une note avant l&rsquo;attribution.
                    </p>
                  )}

                  <h3 className="mt-3 text-[0.65rem] uppercase tracking-wider text-ink-faint">
                    Historique du groupe
                  </h3>
                  <dl className="mt-1 space-y-1 text-xs text-ink-muted">
                    <div className="flex justify-between">
                      <dt>Missions accomplies</dt>
                      <dd className="text-success">{completedPoints}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Missions échouées</dt>
                      <dd className={failed > 0 ? "text-blood-bright" : ""}>{failed}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Missions en cours</dt>
                      <dd className={inProgress > 0 ? "text-warning" : ""}>{inProgress}</dd>
                    </div>
                  </dl>

                  {warnings.length > 0 && (
                    <div className="mt-2 border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      <p className="mb-1 font-medium">Signalements enregistrés au dépôt</p>
                      <ul className="space-y-0.5">
                        {warnings.map((warning, i) => (
                          <li key={i}>⚠ {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {claim.message && (
                <p className="mx-4 mb-3 border-l-2 border-gold-dim pl-3 text-xs text-ink-muted italic">
                  « {claim.message} »
                </p>
              )}

              <div className="border-t border-border-default p-4">
                <ClaimDecide
                  claimId={claim.id}
                  requiresEnhancedReview={requiresEnhancedReview}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
