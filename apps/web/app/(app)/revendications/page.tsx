import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, STATUS_LABELS } from "@toile/shared";
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
      mission: true,
      leader: { include: { playerLevel: true } },
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
          const members = claim.group.members;
          const levels = members
            .map((m) => m.user.playerLevel?.order ?? 0)
            .filter((o) => o > 0);
          const avgOrder = levels.length
            ? levels.reduce((a, b) => a + b, 0) / levels.length
            : 0;
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
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <h2 className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
                    Cellule candidate
                  </h2>
                  <p className="mt-1 text-sm text-ink">
                    {claim.group.faction.name} — {claim.group.name}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Chef : {claim.leader.displayName}
                    {claim.leader.playerLevel ? ` (${claim.leader.playerLevel.label})` : ""}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                    {members.map((member) => (
                      <li key={member.userId}>
                        {member.isLeader ? "◆ " : "· "}
                        {member.user.displayName}
                        {member.user.playerLevel ? (
                          <span className="text-ink-faint"> — {member.user.playerLevel.label}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-[0.65rem] uppercase tracking-wider text-ink-faint">
                    Historique du groupe
                  </h2>
                  <dl className="mt-1 space-y-1 text-xs text-ink-muted">
                    <div className="flex justify-between">
                      <dt>Effectif proposé</dt>
                      <dd className="font-mono-toile text-gold">
                        {claim.proposedHeadcount ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Niveau moyen</dt>
                      <dd>{avgOrder ? avgOrder.toFixed(1).replace(".", ",") : "—"} / 10</dd>
                    </div>
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
                    <ul className="mt-2 space-y-0.5 border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      {warnings.map((warning, i) => (
                        <li key={i}>⚠ {warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {claim.message && (
                <p className="mx-4 mb-3 border-l-2 border-gold-dim pl-3 text-xs text-ink-muted italic">
                  « {claim.message} »
                </p>
              )}

              <div className="border-t border-border-default p-4">
                <ClaimDecide claimId={claim.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
