import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@toile/database";
import {
  categoryLabel,
  formatRyoRange,
  STATUS_LABELS,
  PERMISSIONS,
} from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { getMissionDetail } from "@/server/missions";
import { RankSeal } from "@/components/missions/rank-seal";
import { ClaimPanel } from "@/components/missions/claim-panel";
import { ClaimDecide } from "@/components/missions/claim-decide";
import { ReportForm } from "@/components/missions/report-form";
import { PanelWatermark } from "@/components/shell/watermark";

export const dynamic = "force-dynamic";

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const current = await requireUser();
  const { id } = await params;
  const detail = await getMissionDetail(current, id);
  if (!detail) notFound();

  const { mission, view, level, ctx } = detail;
  const streamer = await isStreamerMode();
  const confidentialAccess = level === "assigned" || level === "moderator";

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

  const canClaim =
    current.permissions.has(PERMISSIONS.MISSION_CLAIM) &&
    ["AVAILABLE", "CLAIM_PENDING"].includes(mission.status) &&
    ctx.ledGroups.length > 0;

  const minLevelLabel = mission.minRecommendedLevel?.label ?? null;

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
          {minLevelLabel && <MetaItem label="Niveau minimal conseillé" value={minLevelLabel} />}
          <MetaItem label="Délai" value={view.timeRemaining.realLabel} />
          {view.timeRemaining.rpLabel && (
            <MetaItem label="Temps RP" value={view.timeRemaining.rpLabel} />
          )}
          {view.claimCount > 0 && (
            <MetaItem label="Candidatures" value={String(view.claimCount)} />
          )}
        </dl>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
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
                  {view.targetIdentity && (
                    <Field label="Cible">{mask("CIBLE", view.targetIdentity)}</Field>
                  )}
                  {view.location && <Field label="Lieu">{mask("LIEU", view.location)}</Field>}
                  {view.clientName && (
                    <Field label="Commanditaire">{mask("CMD", view.clientName)}</Field>
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
                Éligibilité : {view.eligibilityMode}
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
                        {claim.group.faction.name} — {claim.group.name}
                        <span className="ml-2 text-xs text-ink-faint">
                          chef : {claim.leader.displayName}
                        </span>
                      </p>
                      <span className="font-mono-toile text-[0.65rem] uppercase text-ink-faint">
                        {claim.status}
                      </span>
                    </div>
                    {claim.message && (
                      <p className="mt-2 border-l-2 border-gold-dim pl-3 text-xs text-ink-muted italic">
                        {claim.message}
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
                        <ClaimDecide claimId={claim.id} />
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
              {mission.reports.length === 0 && (
                <p className="mb-3 text-xs text-ink-faint italic">Aucun rapport transmis.</p>
              )}
              <ul className="mb-4 space-y-3">
                {mission.reports.map((report) => (
                  <li key={report.id} className="border border-border-default bg-elevated p-3">
                    <p className="mb-1 font-mono-toile text-[0.65rem] text-ink-faint">
                      {new Date(report.submittedAt).toLocaleString("fr-FR")}
                      {report.isFinal && <span className="ml-2 text-gold">— RAPPORT FINAL</span>}
                    </p>
                    <p className="text-sm whitespace-pre-line text-ink-muted">
                      {streamer ? maskValue("RPT", report.id) : report.content}
                    </p>
                  </li>
                ))}
              </ul>
              {["ASSIGNED", "IN_PROGRESS"].includes(mission.status) && (
                <ReportForm missionId={mission.id} />
              )}
            </section>
          )}
        </div>

        {/* Colonne latérale */}
        <aside className="space-y-5">
          {canClaim && level === "public" && (
            <section className="border border-border-gold bg-raised p-4">
              <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                Saisir ce fil
              </h2>
              <ClaimPanel
                missionId={mission.id}
                groups={ctx.ledGroups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  memberCount: g.memberCount,
                }))}
                levelWarning={
                  minLevelLabel
                    ? `Niveau minimal conseillé : ${minLevelLabel}. Les cellules sous ce niveau seront signalées au tisseur.`
                    : null
                }
              />
            </section>
          )}

          {/* Participants — masqué tant qu'aucune attribution ni participant */}
          {confidentialAccess && (mission.assignedGroup || mission.participants.length > 0) && (
            <section className="border border-border-default bg-raised p-4">
              <h2 className="mb-2 font-display text-xs tracking-widest text-gold uppercase">
                Participants
              </h2>
              {mission.assignedGroup ? (
                <p className="text-sm text-ink-muted">
                  {streamer
                    ? maskValue("GRP", mission.assignedGroupId ?? "")
                    : `${mission.assignedFaction?.name} — ${mission.assignedGroup.name}`}
                </p>
              ) : (
                <p className="text-xs text-ink-faint italic">Aucune attribution.</p>
              )}
              {mission.participants.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                  {mission.participants.map((participant) => (
                    <li key={participant.userId}>
                      {streamer
                        ? maskValue("OPR", participant.userId)
                        : participant.user.displayName}
                    </li>
                  ))}
                </ul>
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
