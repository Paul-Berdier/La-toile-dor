import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@toile/database";
import {
  categoryLabel,
  formatRyoRange,
  STATUS_LABELS,
  PERMISSIONS,
  ELIGIBILITY_MODE_LABELS,
  canViewAssignmentRoster,
  toPublicRosterAgent,
  MISSION_TARGET_OUTCOME_LABELS,
  type MissionProfileRole,
  type MissionTargetOutcome,
  type ProfileFieldKey,
} from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { getMissionDetail } from "@/server/missions";
import { canActiveLeaderClaim } from "@/server/mission-claim-policy";
import { RankSeal } from "@/components/missions/rank-seal";
import { ClaimPanel } from "@/components/missions/claim-panel";
import { ClaimDecide } from "@/components/missions/claim-decide";
import { ReportForm } from "@/components/missions/report-form";
import { MissionReportWizard } from "@/components/missions/report-wizard";
import { loadProfileRefs } from "@/server/profiles/edit-data";
import { missionReportPayloadSchema } from "@toile/shared";
import { ManageTeamButton } from "@/components/missions/manage-team";
import { MissionAdminActions } from "@/components/missions/mission-admin-actions";
import { MissionTargets } from "@/components/missions/mission-targets";
import { MissionPeople, type MissionPersonCard } from "@/components/missions/mission-people";
import { MissionSnapshotNotice } from "@/components/missions/mission-snapshot-notice";
import { missionSnapshotDiff } from "@/server/missions/editor-actions";
import { getTargetIntelRule } from "@/server/missions/target-requirements";
import {
  canViewProfileValues,
  decideAccessForGroup,
  getProfileViewer,
  toAccessTarget,
} from "@/server/profiles/access";
import { dossierInclude, serializeDossier } from "@/server/profiles/serializer";
import { getRpTimeConfig } from "@/server/rp-config";
import { PanelWatermark } from "@/components/shell/watermark";

export const dynamic = "force-dynamic";

export default async function MissionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rapportGroupe?: string | string[] }>;
}) {
  const current = await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getMissionDetail(current, id);
  if (!detail) notFound();

  const { mission, view, level, ctx } = detail;
  const streamer = await isStreamerMode();
  // Accès aux dossiers des cibles : la même règle centrale que la page dossier
  const profileViewer = await getProfileViewer(current);
  // Règle de renseignement en vigueur : sert à signaler les dossiers restés
  // vides avant la clôture, sans avoir à la deviner côté client.
  const targetIntelRule = await getTargetIntelRule();
  const confidentialAccess = level !== "public";
  const visibleAssignments = mission.assignments.filter((assignment) =>
    canViewAssignmentRoster({
      isModerator: ctx.isModerator,
      viewerGroupIds: ctx.groupIds,
      assignmentGroupId: assignment.groupId,
      publicRoster: assignment.publicRoster,
    }),
  );

  // Masquage serveur en mode Streamer : les valeurs sensibles ne partent
  // jamais en clair vers le navigateur pendant un stream.
  const mask = (prefix: string, value: string | null): string | null => {
    if (value === null) return null;
    return streamer ? maskValue(prefix, mission.id + prefix) : value;
  };

  const discordSession = await prisma.discordAccount.findUnique({
    where: { userId: current.session.userId },
    select: { discordId: true },
  });
  const identity = {
    displayName: streamer ? "OPÉRATEUR" : current.session.user.displayName,
    partialId: discordSession
      ? `${discordSession.discordId.slice(0, 3)}···${discordSession.discordId.slice(-2)}`
      : "———",
    factionName: null,
    sessionShortId: current.session.shortId,
  };

  const assignedGroupIds = new Set(
    mission.assignments
      .filter((assignment) => assignment.active)
      .map((assignment) => assignment.groupId),
  );
  if (assignedGroupIds.size === 0 && mission.assignedGroupId) assignedGroupIds.add(mission.assignedGroupId);
  const claimableLedGroups = ctx.ledGroups.filter((group) => !assignedGroupIds.has(group.id));
  const canClaim = canActiveLeaderClaim(mission.status, claimableLedGroups.length > 0);
  const canEdit = current.permissions.has(PERMISSIONS.MISSION_UPDATE);
  const canDelete = current.permissions.has(PERMISSIONS.MISSION_CANCEL);

  const minLevel = mission.minRecommendedLevelId
    ? await prisma.playerLevel.findUnique({
        where: { id: mission.minRecommendedLevelId },
        select: { label: true, order: true },
      })
    : null;
  const minLevelLabel = minLevel?.label ?? mission.minRecommendedLevel?.label ?? null;

  // ── Rapport de fin de mission (parcours en 3 étapes) ──
  // Qui rapporte : le chef d'un groupe attribué (au nom de CE groupe), ou la
  // modération. Le brouillon est celui du groupe : deux chefs le reprennent.
  const reportOpen = ["ASSIGNED", "IN_PROGRESS"].includes(mission.status);
  const ledGroupIds = new Set(ctx.ledGroups.map((group) => group.id));
  const eligibleReporterGroupIds = [...assignedGroupIds].filter(
    (groupId) => ctx.isModerator || ledGroupIds.has(groupId),
  );
  const myParticipantGroupId = mission.participants.find((p) => p.userId === current.session.userId)?.groupId ?? null;
  const requestedReporterGroupId = Array.isArray(query.rapportGroupe)
    ? query.rapportGroupe[0]
    : query.rapportGroupe;
  let reporterGroupId: string | null = null;
  if (requestedReporterGroupId && eligibleReporterGroupIds.includes(requestedReporterGroupId)) {
    reporterGroupId = requestedReporterGroupId;
  } else if (myParticipantGroupId && eligibleReporterGroupIds.includes(myParticipantGroupId)) {
    reporterGroupId = myParticipantGroupId;
  } else if (eligibleReporterGroupIds.length === 1) {
    reporterGroupId = eligibleReporterGroupIds[0]!;
  }
  const reporterChoices = eligibleReporterGroupIds.length > 1
    ? await prisma.group.findMany({
        where: { id: { in: eligibleReporterGroupIds }, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  // Le rapport nomme les cibles (identité réservée aux CHEFS des groupes
  // attribués et à la modération) : seul ce niveau de vue le dépose.
  const wizardEligible =
    reportOpen && (level === "leader" || level === "moderator") && reporterGroupId !== null;
  // Un groupe qui a déjà déposé son rapport final ne retrouve pas un wizard
  // vierge au rechargement : il retrouve son rapport, déjà listé plus haut.
  const finalReportRow = wizardEligible
    ? await prisma.missionReport.findFirst({
        where: { missionId: mission.id, reportingGroupId: reporterGroupId!, isFinal: true },
        select: { submittedAt: true, authorId: true },
      })
    : null;
  const finalReportAuthor = finalReportRow
    ? await prisma.user.findUnique({ where: { id: finalReportRow.authorId }, select: { displayName: true } })
    : null;
  const finalReportDone = finalReportRow
    ? { submittedAt: finalReportRow.submittedAt, authorName: finalReportAuthor?.displayName ?? null }
    : null;
  const showWizard = wizardEligible && !finalReportDone;
  const [reportRefs, reportDraft, reporterGroup] = wizardEligible
    ? await Promise.all([
        showWizard ? loadProfileRefs() : null,
        showWizard
          ? prisma.missionReportDraft.findUnique({
              where: { missionId_groupId: { missionId: mission.id, groupId: reporterGroupId! } },
              select: { payload: true, updatedAt: true },
            })
          : null,
        prisma.group.findUnique({ where: { id: reporterGroupId! }, select: { name: true } }),
      ])
    : [null, null, null];
  // ── Personnes de la mission ──
  // Les liens portent leur rôle : les CIBLES d'un côté, les COMMANDITAIRES de
  // l'autre. Ce qui s'affiche vient du SNAPSHOT pris à la publication, pas de
  // l'état actuel du dossier : une mission close ne se réécrit pas.
  const missionTargets = mission.targets.filter((link) => link.role === "TARGET");
  const missionClients = mission.targets.filter((link) => link.role === "CLIENT");
  const missionOthers = mission.targets.filter(
    (link) => link.role !== "TARGET" && link.role !== "CLIENT",
  );
  const toCard = (link: (typeof mission.targets)[number]): MissionPersonCard => ({
    linkId: link.id,
    profileId: link.profileId,
    label: link.label,
    role: link.role as MissionProfileRole,
    isPrimary: link.isPrimary,
    code: link.profile?.code ?? null,
    name: link.profile
      ? [link.profile.characterFirstName, link.profile.characterLastName].filter(Boolean).join(" ")
      : null,
    gradeLabel: link.snapshotRank?.label ?? null,
    classLabel: link.snapshotClass?.label ?? null,
    originLabel: link.snapshotFaction?.name ?? null,
    lifeStatus: link.profile?.lifeStatus ?? null,
    outcomeLabel:
      link.role === "TARGET" && link.outcome !== "UNKNOWN"
        ? MISSION_TARGET_OUTCOME_LABELS[link.outcome as MissionTargetOutcome]
        : null,
  });
  const targetCards = missionTargets.map(toCard);
  const clientCards = missionClients.map(toCard);
  const otherCards = missionOthers.map(toCard);
  // Le dossier a-t-il bougé depuis la publication ? La modération le voit et
  // décide — la mission ne se resynchronise jamais toute seule.
  const staleSnapshots =
    level === "moderator" && mission.status !== "DRAFT"
      ? await missionSnapshotDiff(mission.id)
      : [];

  // §41 : « Valeur actuelle » par dossier cible. Pour un dossier que le groupe
  // rapporteur VOIT, les libellés courants (jamais les structures) ; pour un
  // dossier scellé, RIEN ne part — le client affichera « Confidentielle ».
  const reporterCurrentValues = new Map<string, Record<string, string>>();
  if (showWizard && reporterGroupId) {
    const targetProfileIds = missionTargets
      .map((t) => t.profileId)
      .filter((id): id is string => Boolean(id));
    if (targetProfileIds.length > 0) {
      const profiles = await prisma.characterProfile.findMany({
        where: { id: { in: targetProfileIds }, archivedAt: null },
        include: { ...dossierInclude, accessGrants: { select: { groupId: true, sourceType: true, revokedAt: true } } },
      });
      const rpConfigForDossiers = await getRpTimeConfig();
      for (const profile of profiles) {
        // Au nom du GROUPE rapporteur : voir par un autre de ses groupes ne
        // donne pas le droit d'étiqueter ce groupe-ci.
        const canView =
          profileViewer.canViewAll ||
          decideAccessForGroup(profileViewer, toAccessTarget(profile), reporterGroupId).canView ||
          profileViewer.missionTargetProfileIds.has(profile.id);
        if (!canView) continue;
        const dossier = serializeDossier(profile, profileViewer, true, rpConfigForDossiers);
        const labels: Record<string, string> = {};
        for (const [key, field] of Object.entries(dossier.fields)) {
          labels[key] = field.displayValue;
        }
        reporterCurrentValues.set(profile.id, labels);
      }
    }
  }
  const reportDraftPayload = reportDraft
    ? (missionReportPayloadSchema.safeParse(reportDraft.payload).data ?? null)
    : null;
  const visibleReports = mission.reports.filter((report) => {
    if (level === "moderator") return true;
    if (!report.isFinal) return true;
    return level === "leader" && (
      report.reportingGroupId === null ||
      (report.reportingGroupId !== null && ledGroupIds.has(report.reportingGroupId))
    );
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <Link
        href="/missions"
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Retour au tableau
      </Link>

      {/* En-tête du contrat */}
      <header className="mt-4 border border-border-gold bg-raised p-5">
        <div className="flex flex-wrap items-start gap-4">
          <RankSeal rank={view.rank} size={64} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-3 font-mono-toile text-xs tracking-wider text-ink-faint">
              {view.code}
              <span className="border border-border-default px-2 py-0.5 text-[0.65rem] uppercase text-ink-muted">
                {STATUS_LABELS[view.status] ?? view.status}
              </span>
              {view.hasConfidential && (
                <span className="border border-blood px-2 py-0.5 text-[0.65rem] uppercase text-blood-bright">
                  Volet confidentiel
                </span>
              )}
            </p>
            <h1 className="mt-1 font-display text-2xl text-ink">{view.publicTitle}</h1>
            {view.category && (
              <p className="text-sm text-ink-muted">{categoryLabel(view.category)}</p>
            )}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border-default pt-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <MetaItem label="Récompense" value={formatRyoRange(view.rewardRyoMin, view.rewardRyoMax)} gold />
          <MetaItem label="Points" value={`${view.basePoints} pts`} />
          <MetaItem
            label="Effectif"
            value={`${view.groupSizeMin} à ${view.groupSizeMax} membres`}
          />
          {detail.mission.targetLevel && "targetLevelId" in view && view.targetLevelId && (
            <MetaItem label="Niveau de la cible" value={detail.mission.targetLevel.label} />
          )}
          {minLevelLabel && <MetaItem label="Niveau minimal des agents" value={minLevelLabel} />}
          <MetaItem label="Délai" value={view.timeRemaining.realLabel} />
          {mission.awardedRyo !== null && (
            <MetaItem label="Ryō distribués" value={`${mission.awardedRyo.toLocaleString("fr-FR")} ryō`} gold />
          )}
          {view.timeRemaining.rpLabel && (
            <MetaItem label="Temps RP" value={view.timeRemaining.rpLabel} />
          )}
          {view.claimCount > 0 && (
            <MetaItem label="Candidatures" value={String(view.claimCount)} />
          )}
        </dl>
        {(canEdit || canDelete) && mission.status !== "ARCHIVED" && (
          <div className="mt-4 border-t border-border-default pt-4">
            <MissionAdminActions
              missionId={mission.id}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </div>
        )}
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* min-w-0 : les colonnes de grille ne doivent pas hériter du min-content
            de leur contenu (codes, boutons nowrap) — sinon débordement mobile */}
        <div className="min-w-0 space-y-5">
          {/* Résumé public */}
          {view.publicSummary && (
            <section className="border border-border-default bg-raised p-5">
              <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">
                Avis public
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-line text-ink-muted">
                {view.publicSummary}
              </p>
            </section>
          )}

          {/* Dossier confidentiel — parchemin */}
          {confidentialAccess && "confidentialDescription" in view ? (
            <section
              aria-label="Dossier confidentiel"
              className="relative border border-gold-dim bg-parchment p-6 text-parchment-text shadow-card"
            >
              <PanelWatermark identity={identity} />
              <div className="relative z-20">
                <div className="mb-4 flex items-center justify-between border-b border-parchment-deep pb-3">
                  <h2 className="font-display text-sm tracking-[0.25em] uppercase">
                    Dossier scellé
                  </h2>
                  <SealStamp />
                </div>

                {view.confidentialDescription && (
                  <Field label="Briefing">{mask("BRF", view.confidentialDescription)}</Field>
                )}
                {view.primaryObjective && (
                  <Field label="Objectif principal">{mask("OBJ", view.primaryObjective)}</Field>
                )}
                {view.secondaryObjectives.length > 0 && (
                  <div className="mb-4">
                    <h3 className="font-mono-toile text-[0.65rem] uppercase tracking-widest opacity-60">
                      Objectifs secondaires
                    </h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {view.secondaryObjectives.map((objective, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-3">
                          <span>
                            {"secret" in objective && objective.secret ? "◈ " : "◇ "}
                            {mask(`SEC${i}`, objective.label)}
                          </span>
                          {objective.points != null && (
                            <span className="font-mono-toile text-xs opacity-70">
                              +{objective.points} pts
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {/* Cibles et commanditaires ont leurs propres cartes, plus
                      bas : on ne redit pas ici ce qu'elles montrent mieux.
                      Seul le TEXTE LIBRE des missions saisies avant les
                      dossiers subsiste — jusqu'à sa régularisation. */}
                  {"targetIdentity" in view && view.targetIdentity && (
                    <Field label="Cible(s) — saisie historique">
                      {mask("CIBLE", view.targetIdentity)}
                    </Field>
                  )}
                  {view.location && <Field label="Lieu">{mask("LIEU", view.location)}</Field>}
                  {"clientName" in view && view.clientName && (
                    <Field label="Commanditaire — saisie historique">
                      {mask("CMD", view.clientName)}
                    </Field>
                  )}
                  {view.evidence && <Field label="Preuves à rapporter">{mask("PRV", view.evidence)}</Field>}
                </div>
                {view.constraints && <Field label="Contraintes">{mask("CTR", view.constraints)}</Field>}
                {view.prohibitions && (
                  <Field label="Interdictions" danger>
                    {mask("INT", view.prohibitions)}
                  </Field>
                )}

                {mission.attachments.length > 0 && (
                  <div className="mt-4 border-t border-parchment-deep pt-3">
                    <h3 className="font-mono-toile text-[0.65rem] uppercase tracking-widest opacity-60">
                      Pièces jointes
                    </h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {mission.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          {streamer ? maskValue("PJ", attachment.id) : attachment.fileName}{" "}
                          <span className="text-xs opacity-60">
                            ({Math.round(attachment.sizeBytes / 1024)} Kio)
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="border border-border-default bg-raised p-6 text-center">
              <SealedNotice />
            </section>
          )}

          {/* PERSONNES — cartes des cibles et des commanditaires, avec l'état
              du dossier FIGÉ à la publication. Le chef d'un groupe attribué
              lit les dossiers des cibles le temps de la mission ; les
              commanditaires restent, eux, réservés à la modération. */}
          {(level === "leader" || level === "moderator") && targetCards.length > 0 && (
            <MissionPeople title="Cibles" people={targetCards} />
          )}
          {level === "moderator" && clientCards.length > 0 && (
            <MissionPeople title="Commanditaires" people={clientCards} />
          )}
          {level === "moderator" && otherCards.length > 0 && (
            <MissionPeople title="Autres personnes" people={otherCards} />
          )}
          {level === "moderator" && staleSnapshots.length > 0 && (
            <MissionSnapshotNotice missionId={mission.id} diffs={staleSnapshots} />
          )}

          {/* Cibles et leur sort — modération : c'est ce qui met les dossiers
              à jour à la clôture et ouvre l'accès aux groupes engagés. */}
          {level === "moderator" && (
            <MissionTargets
              missionId={mission.id}
              minFields={targetIntelRule.minFields}
              targets={missionTargets.map((target) => ({
                id: target.id,
                profileId: target.profileId,
                profileCode: target.profile?.code ?? null,
                profileName: target.profile
                  ? [target.profile.characterFirstName, target.profile.characterLastName].filter(Boolean).join(" ")
                  : null,
                label: target.label,
                outcome: target.outcome,
                note: target.note,
                knownFields: target.profile?.fieldIntel.length ?? 0,
              }))}
            />
          )}

          {/* Renseignement : verser les informations récoltées dans un dossier */}
          {level === "moderator" &&
            ["ASSIGNED", "IN_PROGRESS", "COMPLETED"].includes(mission.status) && (
              <section className="border border-gold-dim bg-raised p-5">
                <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">
                  Renseignement
                </h2>
                <p className="text-xs text-ink-muted">
                  Cette mission a permis de récolter des informations sur un personnage ?
                  Versez-les dans un dossier — rien n&rsquo;est appliqué sans votre
                  confirmation champ par champ.
                </p>
                <Link
                  href={`/profils?mission=${mission.id}`}
                  className="mt-3 inline-block border border-border-gold px-3 py-1.5 text-xs text-gold hover:bg-hover-bg"
                >
                  Ajouter les renseignements au dossier
                </Link>
              </section>
            )}

          {/* Notes de modération */}
          {level === "moderator" && "moderatorNotes" in view && (
            <section className="border border-border-default bg-raised p-5">
              <h2 className="mb-2 font-display text-sm tracking-widest text-copper uppercase">
                Notes internes (modération)
              </h2>
              {view.internalTitle && (
                <p className="text-sm text-ink">
                  <span className="text-ink-faint">Titre interne :</span> {view.internalTitle}
                </p>
              )}
              <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">
                {view.moderatorNotes ?? "Aucune note."}
              </p>
              <p className="mt-2 font-mono-toile text-[0.65rem] text-ink-faint">
                Éligibilité : {ELIGIBILITY_MODE_LABELS[mission.eligibilityMode]}
              </p>
            </section>
          )}

          {/* Revendications (modérateurs) */}
          {level === "moderator" && mission.claims.length > 0 && (
            <section className="border border-border-default bg-raised p-5">
              <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                Revendications
              </h2>
              <ul className="space-y-4">
                {mission.claims.map((claim) => (
                  <li key={claim.id} className="border border-border-default bg-elevated p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-ink">
                        {claim.group.name}
                        {claim.group.faction ? ` · ${claim.group.faction.name}` : ""}
                        <span className="ml-2 text-xs text-ink-faint">
                          chef :{" "}
                          {streamer ? (
                            maskValue("OPR", claim.leaderId)
                          ) : (
                            <Link href={`/membres/${claim.leaderId}`} className="hover:text-gold hover:underline">
                              {claim.leader.displayName}
                            </Link>
                          )}
                        </span>
                      </p>
                      <span className="font-mono-toile text-[0.65rem] uppercase text-ink-faint">
                        {claim.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono-toile text-[0.65rem] text-ink-faint">
                      Visibilité choisie : {claim.publicRoster ? "groupe et pseudonymes publics" : "équipe invisible"}
                    </p>
                    {claim.message && (
                      <p className="mt-2 border-l-2 border-gold-dim pl-3 text-xs text-ink-muted italic">
                        {claim.message}
                      </p>
                    )}
                    {claim.participants.length > 0 && (
                      <p className="mt-2 text-xs text-ink-muted">
                        Agents engagés :{" "}
                        {claim.participants.map((participant, index) => (
                          <span key={participant.userId}>
                            {index > 0 && ", "}
                            {streamer ? (
                              maskValue("OPR", participant.userId)
                            ) : (
                              <Link href={`/membres/${participant.userId}`} className="hover:text-gold hover:underline">
                                {participant.user.displayName}
                              </Link>
                            )}
                            {participant.user.playerLevel ? ` (${participant.user.playerLevel.label})` : ""}
                          </span>
                        ))}
                      </p>
                    )}
                    {Array.isArray(claim.warnings) && claim.warnings.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs text-warning">
                        {(claim.warnings as string[]).map((warning, i) => (
                          <li key={i}>⚠ {warning}</li>
                        ))}
                      </ul>
                    )}
                    {["PENDING", "INFO_REQUESTED"].includes(claim.status) && (
                      <div className="mt-3">
                        <ClaimDecide
                          claimId={claim.id}
                          requiresEnhancedReview={
                            mission.requiresEnhancedReview || mission.eligibilityMode === "MANUAL_REVIEW"
                          }
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Rapports */}
          {confidentialAccess && (
            <section className="border border-border-default bg-raised p-5">
              <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                Rapports de mission
              </h2>
              {visibleReports.length === 0 && (
                <p className="mb-3 text-xs text-ink-faint italic">Aucun rapport transmis.</p>
              )}
              <ul className="mb-4 space-y-3">
                {visibleReports.map((report) => (
                  <li key={report.id} className="border border-border-default bg-elevated p-3">
                    <p className="mb-1 font-mono-toile text-[0.65rem] text-ink-faint">
                      {new Date(report.submittedAt).toLocaleString("fr-FR")}
                      {report.isFinal && <span className="ml-2 text-gold">— RAPPORT FINAL</span>}
                    </p>
                    <p className="text-sm whitespace-pre-line text-ink-muted">
                      {streamer ? maskValue("RPT", report.id) : report.content}
                    </p>
                    {!streamer && report.images.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {report.images.map((image, index) => (
                          <li key={image.id}>
                            <a
                              href={`/api/rapports/images/${image.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block border border-border-default hover:border-gold"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/rapports/images/${image.id}`}
                                alt={`Preuve ${index + 1} du rapport`}
                                loading="lazy"
                                className="h-24 w-24 object-cover"
                              />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              {reportOpen && (
                <details className="mb-4">
                  <summary className="cursor-pointer text-[0.7rem] uppercase tracking-wider text-ink-faint hover:text-gold">
                    Rapport d&rsquo;étape (facultatif)
                  </summary>
                  <div className="mt-2">
                    <ReportForm missionId={mission.id} />
                  </div>
                </details>
              )}
              {reportOpen && (level === "leader" || level === "moderator") && reporterChoices.length > 1 && (
                <form method="get" className="mb-4 flex flex-wrap items-end gap-2 border-t border-border-default pt-4">
                  <label className="min-w-56 flex-1 text-xs text-ink-muted">
                    <span className="mb-1 block uppercase tracking-wider text-ink-faint">Rapporter au nom de</span>
                    <select
                      name="rapportGroupe"
                      defaultValue={reporterGroupId ?? ""}
                      required
                      className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink"
                    >
                      <option value="" disabled>Choisir un groupe…</option>
                      {reporterChoices.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="border border-gold px-3 py-2 text-xs uppercase tracking-wider text-gold hover:bg-gold-faint/20">
                    Ouvrir ce brouillon
                  </button>
                </form>
              )}
              {finalReportDone && (
                <div className="border-t border-border-gold pt-4">
                  <p role="status" className="border border-gold bg-gold-faint/20 p-3 text-xs text-ink">
                    <span className="font-display tracking-widest text-gold uppercase">Rapport final déposé</span>
                    <span className="mt-1 block text-ink-muted">
                      {reporterGroup?.name ?? "Votre groupe"} a déposé son rapport le{" "}
                      {finalReportDone.submittedAt.toLocaleString("fr-FR")}
                      {finalReportDone.authorName && ` (${finalReportDone.authorName})`}. La clôture et la prime
                      relèvent des tisseurs.
                    </span>
                  </p>
                </div>
              )}
              {showWizard && reportRefs && reporterGroupId && (
                <div className="border-t border-border-gold pt-4">
                  <h3 className="mb-1 font-display text-sm tracking-widest text-gold uppercase">
                    Rapport de fin de mission
                  </h3>
                  <p className="mb-3 text-[0.7rem] text-ink-faint">
                    Trois étapes : le résultat, ce que vous avez appris sur chaque dossier, la validation.
                    Votre brouillon est conservé.
                  </p>
                  <MissionReportWizard
                    missionId={mission.id}
                    missionCode={mission.code}
                    groupId={reporterGroupId}
                    groupName={reporterGroup?.name ?? "votre groupe"}
                    targets={missionTargets.map((t) => ({
                      id: t.id,
                      profileId: t.profileId,
                      name: t.profile
                        ? [t.profile.characterFirstName, t.profile.characterLastName].filter(Boolean).join(" ")
                        : t.label ?? "Cible",
                      code: t.profile?.code ?? null,
                      outcome: t.outcome,
                      note: t.note,
                      canViewDossier: t.profileId ? reporterCurrentValues.has(t.profileId) : false,
                      currentValues: t.profileId ? reporterCurrentValues.get(t.profileId) ?? null : null,
                    }))}
                    refs={reportRefs}
                    // Prise d'information : ce que le contrat demandait
                    // d'apprendre, proposé d'un clic dans chaque dossier.
                    soughtFieldKeys={
                      Array.isArray(mission.soughtFieldKeys)
                        ? (mission.soughtFieldKeys as ProfileFieldKey[])
                        : []
                    }
                    initialDraft={reportDraftPayload}
                    draftSavedAt={reportDraft?.updatedAt.toISOString() ?? null}
                    canFinalize={mission.status === "IN_PROGRESS"}
                  />
                </div>
              )}
            </section>
          )}
        </div>

        {/* Colonne latérale */}
        <aside className="min-w-0 space-y-5">
          {/* Modération : attribution / gestion de l'équipe multi-groupes */}
          {level === "moderator" &&
            ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"].includes(mission.status) && (
              <section className="border border-border-gold bg-raised p-4">
                <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                  Attribution
                </h2>
                <ManageTeamButton
                  missionId={mission.id}
                  missionCode={mission.code}
                  missionRank={mission.rank}
                  claims={mission.claims
                    .filter((claim) => ["PENDING", "INFO_REQUESTED"].includes(claim.status))
                    .map((claim) => ({
                      groupId: claim.groupId,
                      groupName: claim.group.name,
                      factionName: claim.group.faction?.name ?? null,
                      headcount: claim.participants.length,
                      participantIds: claim.participants.map((participant) => participant.userId),
                      publicRoster: claim.publicRoster,
                    }))}
                  assignments={mission.assignments.map((assignment) => ({
                    groupId: assignment.groupId,
                    groupName: assignment.group.name,
                    factionName: assignment.faction?.name ?? null,
                    headcount: assignment.assignedHeadcount,
                    isLead: assignment.isLeadGroup,
                    publicRoster: assignment.publicRoster,
                    participantIds: mission.participants
                      .filter((participant) => participant.groupId === assignment.groupId)
                      .map((participant) => participant.userId),
                  }))}
                  catalog={detail.groupsCatalog}
                  eligibility={{
                    groupSizeMin: mission.groupSizeMin,
                    groupSizeMax: mission.groupSizeMax,
                    minRecommendedLevel: mission.minRecommendedLevel,
                    eligibilityMode: mission.eligibilityMode,
                    requiresEnhancedReview:
                      mission.requiresEnhancedReview || mission.eligibilityMode === "MANUAL_REVIEW",
                  }}
                  canStart={mission.status !== "IN_PROGRESS"}
                />
              </section>
            )}

          {canClaim && (
            <section className="border border-border-gold bg-raised p-4">
              <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                Saisir ce fil
              </h2>
              <ClaimPanel
                missionId={mission.id}
                groups={claimableLedGroups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  memberCount: g.memberCount,
                  members: g.members.map(({ id, displayName, levelLabel, levelOrder }) => ({
                    id,
                    displayName,
                    levelLabel,
                    levelOrder: levelOrder || null,
                  })),
                }))}
                eligibilityMode={mission.eligibilityMode}
                groupSizeMin={view.groupSizeMin}
                groupSizeMax={view.groupSizeMax}
                minLevelOrder={minLevel?.order ?? null}
                minLevelLabel={minLevelLabel}
                requiresEnhancedReview={
                  mission.requiresEnhancedReview || mission.eligibilityMode === "MANUAL_REVIEW"
                }
              />
            </section>
          )}

          {/* Roster par groupe : privé par défaut, public sur choix explicite du chef. */}
          {visibleAssignments.length > 0 && (
            <section className="border border-border-default bg-raised p-4">
              <h2 className="mb-2 font-display text-xs tracking-widest text-gold uppercase">
                {confidentialAccess ? "Équipe assignée" : "Équipe déclarée publiquement"}
              </h2>
              <ul className="space-y-2">
                {visibleAssignments.map((assignment) => {
                  const fullRosterAccess =
                    ctx.isModerator || ctx.groupIds.has(assignment.groupId);
                  const roster = mission.participants.filter(
                    (participant) => participant.groupId === assignment.groupId,
                  );
                  return (
                    <li key={assignment.id} className="border border-border-default bg-elevated p-2.5">
                      <p className="text-sm text-ink">
                        {streamer
                          ? maskValue("GRP", assignment.groupId)
                          : `${assignment.group.name}${fullRosterAccess && assignment.faction ? ` · ${assignment.faction.name}` : ""}`}
                      </p>
                      {fullRosterAccess && (
                        <p className="text-xs text-ink-muted">
                          {assignment.assignedHeadcount} participant
                          {assignment.assignedHeadcount > 1 ? "s" : ""}
                          {assignment.isLeadGroup && (
                            <span className="ml-2 border border-gold-dim px-1.5 py-0.5 text-[0.65rem] text-gold uppercase">
                              Groupe principal
                            </span>
                          )}
                        </p>
                      )}
                      <ul className="mt-2 space-y-1 border-t border-border-default pt-2 text-xs text-ink-muted">
                        {roster.map((participant) => (
                          <li key={participant.userId}>
                            {streamer ? (
                              maskValue("OPR", participant.userId)
                            ) : (
                              <Link href={`/membres/${participant.userId}`} className="hover:text-gold hover:underline">
                                {fullRosterAccess
                                  ? participant.user.displayName
                                  : toPublicRosterAgent(participant.user).displayName}
                              </Link>
                            )}
                            {fullRosterAccess && !streamer && participant.user.playerLevel && (
                              <span className="text-ink-faint">
                                {" "}· {participant.user.playerLevel.label}
                              </span>
                            )}
                            {fullRosterAccess && mission.status === "COMPLETED" && (
                              <span className="ml-2 text-gold">
                                +{participant.pointsAwarded} pts · {participant.ryoAwarded.toLocaleString("fr-FR")} ryō
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {fullRosterAccess && (
                        <p className="mt-2 font-mono-toile text-[0.6rem] text-ink-faint">
                          Attribuée le {new Date(assignment.assignedAt).toLocaleString("fr-FR")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              {confidentialAccess && visibleAssignments.length > 1 && (
                <p className="mt-2 font-mono-toile text-xs text-gold">
                  Effectif total :{" "}
                  {visibleAssignments.reduce((sum, assignment) => {
                    const visibleCount = mission.participants.filter(
                      (participant) => participant.groupId === assignment.groupId,
                    ).length;
                    return sum + visibleCount;
                  }, 0)}
                </p>
              )}
            </section>
          )}

          {/* Chronologie */}
          {confidentialAccess && mission.statusHistory.length > 0 && (
            <section className="border border-border-default bg-raised p-4">
              <h2 className="mb-3 font-display text-xs tracking-widest text-gold uppercase">
                Chronologie
              </h2>
              <ol className="relative space-y-3 border-l border-gold-dim pl-4">
                {mission.statusHistory.map((event) => (
                  <li key={event.id} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rotate-45 border border-gold bg-obsidian"
                    />
                    <p className="text-xs text-ink">
                      {STATUS_LABELS[event.fromStatus]} → {STATUS_LABELS[event.toStatus]}
                    </p>
                    {event.reason && <p className="text-[0.7rem] text-ink-faint">{event.reason}</p>}
                    <p className="font-mono-toile text-[0.6rem] text-ink-faint">
                      {new Date(event.createdAt).toLocaleString("fr-FR")}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function MetaItem({ label, value, gold = false }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 ${gold ? "font-mono-toile text-gold" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
  danger = false,
}: {
  label: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="mb-4">
      <h3
        className={`font-mono-toile text-[0.65rem] uppercase tracking-widest ${
          danger ? "text-blood" : "opacity-60"
        }`}
      >
        {label}
      </h3>
      <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-line">{children}</p>
    </div>
  );
}

/** Sceau rouge « approuvé » apposé sur le dossier. */
function SealStamp() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden className="opacity-80">
      <circle cx="22" cy="22" r="20" fill="none" stroke="var(--toile-blood)" strokeWidth="1.5" />
      <circle cx="22" cy="22" r="16.5" fill="none" stroke="var(--toile-blood)" strokeWidth="0.6" />
      <text
        x="22"
        y="27"
        textAnchor="middle"
        fontSize="14"
        fill="var(--toile-blood)"
        fontFamily="serif"
      >
        承
      </text>
    </svg>
  );
}

function SealedNotice() {
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
        <polygon
          points="14,2 34,2 46,14 46,34 34,46 14,46 2,34 2,14"
          fill="none"
          stroke="var(--toile-gold-dim)"
          strokeWidth="1"
        />
        <text x="24" y="30" textAnchor="middle" fontSize="16" fill="var(--toile-blood)" fontFamily="serif">
          封
        </text>
      </svg>
      <p className="font-display text-sm tracking-[0.2em] text-ink-muted uppercase">
        Dossier scellé
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-faint">
        L&rsquo;identité de la cible, les lieux et le commanditaire ne sont révélés qu&rsquo;au
        groupe auquel la Toile confie ce fil. Réclamez la mission pour briser le sceau.
      </p>
    </div>
  );
}
