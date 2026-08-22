import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode } from "@/lib/streamer";
import {
  GradeRequestForm,
  type GradeCandidateOption,
} from "@/components/grades/grade-request-form";
import { GradeDecisionCard } from "@/components/grades/grade-decision-card";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  APPROVED: "Approuvée",
  REJECTED: "Refusée",
  CANCELLED: "Annulée",
};

export default async function GradesPage() {
  const current = await requireUser();
  const streamer = await isStreamerMode();

  // Les motifs RP, les titres des demandeurs et les groupes de la file sont
  // sensibles à l'écran. Comme pour /compte, couper avant toute requête évite
  // aussi leur présence invisible dans le flux RSC.
  if (streamer) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
        <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
          Évolution des grades
        </h1>
        <section role="status" className="mt-6 border border-border-gold bg-raised p-5">
          <h2 className="font-display text-sm tracking-widest text-gold uppercase">
            File protégée
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Le mode Streamer est actif : les demandes de grade, leurs motifs et les
            outils de décision ne sont pas chargés sur cette page.
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Désactivez le mode Streamer avec le bouton « 隠 » ou le raccourci
            Ctrl+Maj+S, puis revenez ici.
          </p>
        </section>
      </main>
    );
  }

  const userId = current.session.userId;
  const canReview = current.permissions.has(PERMISSIONS.USER_LEVEL_MANAGE);

  const [levels, user, ledMemberships, relatedRequests, reviewQueue, selfPendingRequest] =
    await Promise.all([
      prisma.playerLevel.findMany({
        orderBy: { order: "asc" },
        select: { id: true, label: true, order: true },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          playerLevelId: true,
          playerLevel: { select: { label: true } },
        },
      }),
      prisma.groupMember.findMany({
        where: { userId, isLeader: true, group: { isActive: true } },
        select: {
          group: {
            select: {
              id: true,
              name: true,
              members: {
                where: {
                  userId: { not: userId },
                  user: { status: "ACTIVE", profileCompleted: true },
                },
                orderBy: { joinedAt: "asc" },
                select: {
                  user: {
                    select: {
                      id: true,
                      displayName: true,
                      playerLevelId: true,
                      playerLevel: { select: { label: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.userLevelChangeRequest.findMany({
        where: { OR: [{ targetUserId: userId }, { requestedById: userId }] },
        orderBy: { requestedAt: "desc" },
        take: 30,
        include: {
          targetUser: { select: { displayName: true } },
          currentLevel: { select: { label: true } },
          requestedLevel: { select: { label: true } },
          group: { select: { name: true } },
          reviewedBy: { select: { displayName: true } },
        },
      }),
      canReview
        ? prisma.userLevelChangeRequest.findMany({
            where: { status: "PENDING" },
            orderBy: { requestedAt: "asc" },
            include: {
              targetUser: { select: { displayName: true } },
              requestedBy: { select: { displayName: true } },
              currentLevel: { select: { label: true } },
              requestedLevel: { select: { label: true } },
              group: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      prisma.userLevelChangeRequest.findFirst({
        where: { targetUserId: userId, status: "PENDING" },
        select: { id: true },
      }),
    ]);

  const candidateRows: GradeCandidateOption[] = ledMemberships.flatMap(({ group }) =>
    group.members.map(({ user: member }) => ({
      key: `${group.id}:${member.id}`,
      targetUserId: member.id,
      groupId: group.id,
      displayName: member.displayName,
      groupName: group.name,
      currentLevelId: member.playerLevelId,
      currentLevelLabel: member.playerLevel?.label ?? null,
      hasPendingRequest: false,
    })),
  );
  const pendingTargetIds = candidateRows.length
    ? new Set(
        (
          await prisma.userLevelChangeRequest.findMany({
            where: {
              targetUserId: { in: [...new Set(candidateRows.map((row) => row.targetUserId))] },
              status: "PENDING",
            },
            select: { targetUserId: true },
          })
        ).map((request) => request.targetUserId),
      )
    : new Set<string>();
  for (const candidate of candidateRows) {
    candidate.hasPendingRequest = pendingTargetIds.has(candidate.targetUserId);
  }

  const selfCandidate: GradeCandidateOption = {
    key: user.id,
    targetUserId: user.id,
    groupId: null,
    displayName: user.displayName,
    groupName: null,
    currentLevelId: user.playerLevelId,
    currentLevelLabel: user.playerLevel?.label ?? null,
    hasPendingRequest: Boolean(selfPendingRequest),
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Évolution des grades
      </h1>
      <p className="mt-1 mb-6 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Le grade intervient dans l&rsquo;éligibilité aux missions. Toute correction ou évolution
        est donc motivée, examinée par la modération et conservée dans le journal d&rsquo;audit.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <GradeRequestForm
          title="Demander pour mon personnage"
          description="Indiquez le grade attendu et la raison RP. Si vous êtes vous-même modérateur, un autre modérateur devra obligatoirement trancher."
          candidates={[selfCandidate]}
          levels={levels}
        />
        {ledMemberships.length > 0 && (
          <GradeRequestForm
            title="Proposer pour un membre"
            description="Un chef peut proposer une évolution pour un membre actif de l’un de ses groupes. La modération garde la décision finale."
            candidates={candidateRows}
            levels={levels}
          />
        )}
      </div>

      {canReview && (
        <section className="mt-7">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-sm tracking-widest text-gold uppercase">
                Demandes à examiner
              </h2>
              <p className="mt-1 text-xs text-ink-faint">
                Une décision exige toujours un motif. Votre propre grade doit être tranché par un autre modérateur.
              </p>
            </div>
            <span className="font-mono-toile text-xs text-ink-faint">{reviewQueue.length} en attente</span>
          </div>
          {reviewQueue.length === 0 ? (
            <p className="border border-border-default bg-raised p-5 text-sm text-ink-faint italic">
              Aucune demande en attente.
            </p>
          ) : (
            <ol className="grid gap-3 lg:grid-cols-2">
              {reviewQueue.map((request) => (
                <GradeDecisionCard
                  key={request.id}
                  requiresAnotherReviewer={
                    request.targetUserId === userId || request.requestedById === userId
                  }
                  request={{
                    id: request.id,
                    targetName: request.targetUser.displayName,
                    requesterName: request.requestedBy?.displayName ?? null,
                    currentLevelLabel: request.currentLevel?.label ?? null,
                    requestedLevelLabel: request.requestedLevel.label,
                    groupName: request.group?.name ?? null,
                    reason: request.reason,
                    requestedAtLabel: request.requestedAt.toLocaleString("fr-FR"),
                  }}
                />
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="mt-7">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Mes demandes récentes
        </h2>
        {relatedRequests.length === 0 ? (
          <p className="border border-border-default bg-raised p-5 text-sm text-ink-faint italic">
            Aucune demande enregistrée.
          </p>
        ) : (
          <ol className="space-y-2">
            {relatedRequests.map((request) => (
              <li key={request.id} className="border border-border-default bg-raised px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink">
                    {request.targetUser.displayName} · {request.currentLevel?.label ?? "Sans grade"} → {request.requestedLevel.label}
                  </span>
                  <span className={`font-mono-toile text-xs ${request.status === "PENDING" ? "text-warning" : request.status === "APPROVED" ? "text-success" : "text-ink-faint"}`}>
                    {STATUS_LABELS[request.status] ?? request.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {request.requestedAt.toLocaleString("fr-FR")}
                  {request.group ? ` · ${request.group.name}` : " · demande personnelle"}
                  {request.reviewedBy ? ` · tranchée par ${request.reviewedBy.displayName}` : ""}
                </p>
                <p className="mt-1 text-xs text-ink-muted italic">« {request.reason} »</p>
                {request.reviewNote && (
                  <p className="mt-1 text-xs text-ink-muted">Décision : {request.reviewNote}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
