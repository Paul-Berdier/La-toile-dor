import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PROFILE_FIELD_LABELS,
  CONFIDENCE_LABELS,
  type IntelConfidenceCode,
} from "@toile/shared";
import { requireUser } from "@/lib/session";
import { getDossierDetail, type RelationView } from "@/server/profiles/queries";
import { DossierRow, FieldValue } from "@/components/profils/field-value";
import { RequestAccessPanel, RevokeGrantButton } from "@/components/profils/request-access";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mission?: string }>;
}) {
  const current = await requireUser();
  const { id } = await params;
  const { mission } = await searchParams;
  const detail = await getDossierDetail(current, id);
  if (!detail) notFound();

  const { dossier, relations, viewer, internal, requestableGroups } = detail;
  const f = dossier.fields;

  // La colonne latérale n'existe que pour l'achat (chefs) ou la gestion des
  // accès (modération) — sinon le dossier occupe toute la largeur.
  const hasAside =
    internal != null ||
    (!viewer.canViewAll && (requestableGroups.length > 0 || detail.myPendingRequest || dossier.canViewValues));

  const relationGroups: { key: RelationView["group"]; position: string }[] = [
    { key: "parents", position: "haut" },
    { key: "creators", position: "haut" },
    { key: "siblings", position: "côtés" },
    { key: "children", position: "bas" },
    { key: "creations", position: "bas" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link
        href="/profils"
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Dossiers de renseignement
      </Link>

      {/* En-tête du dossier */}
      <header className="mt-4 border border-border-gold bg-raised p-5">
        <div className="flex flex-wrap items-start gap-4">
          {dossier.image.displayState === "VISIBLE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/profils/${dossier.id}/image`}
              alt={`Portrait du dossier ${dossier.code}`}
              className="h-32 w-24 shrink-0 border border-border-gold object-cover"
            />
          ) : (
            <div
              aria-label={
                dossier.image.displayState === "REDACTED"
                  ? "Portrait connu mais confidentiel"
                  : "Portrait non renseigné"
              }
              className={`flex h-32 w-24 shrink-0 flex-col items-center justify-center gap-1 border font-display text-2xl ${
                dossier.image.displayState === "REDACTED"
                  ? "border-gold-dim bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(184,150,62,0.12)_5px,rgba(184,150,62,0.12)_10px)] text-gold"
                  : "border-border-default bg-elevated text-ink-faint"
              }`}
            >
              {dossier.image.displayState === "REDACTED" ? "???" : "諜"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="whitespace-nowrap font-mono-toile text-xs tracking-wider text-ink-faint">
              Dossier {dossier.code}
            </p>
            <h1 className="mt-1 font-display text-2xl text-ink">
              {dossier.firstName}
              {f.lastName.displayState === "VISIBLE" && (
                <span className="ml-2">{f.lastName.displayValue}</span>
              )}
            </h1>
            {/* Paires insécables : chaque couple label/valeur reste solidaire
                lorsque la ligne se replie sur mobile. */}
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {([
                ["État", f.lifeStatus],
                ["Faction", f.faction],
                ["Grade", f.rank],
              ] as const).map(([labelText, field]) => (
                <div key={labelText} className="flex shrink-0 items-center gap-1.5">
                  <dt className="whitespace-nowrap text-ink-faint">{labelText} :</dt>
                  <dd className="min-w-0"><FieldValue field={field} /></dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 whitespace-nowrap font-mono-toile text-[0.6rem] text-ink-faint">
              Mise à jour : {new Date(dossier.updatedAt).toLocaleString("fr-FR")}
            </p>
          </div>
          {viewer.canManage && (
            <Link
              href={`/profils/${dossier.id}/modifier${mission ? `?mission=${mission}` : ""}`}
              className={buttonClasses("gold", "sm")}
            >
              {mission ? "Ajouter les renseignements au dossier" : "Modifier le dossier"}
            </Link>
          )}
        </div>
      </header>

      {/* La colonne latérale n'occupe de place que si elle a du contenu */}
      <div
        className={`mt-5 grid gap-5 ${
          hasAside ? "lg:grid-cols-[1fr_18rem]" : "lg:grid-cols-1"
        }`}
      >
        <div className="space-y-5">
          {/* Identité */}
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Identité</h2>
            <dl>
              <div className="flex items-baseline justify-between gap-3 border-b border-border-default/60 py-1.5">
                <dt className="text-[0.7rem] uppercase tracking-wider text-ink-faint">Prénom</dt>
                <dd className="text-sm text-ink">{dossier.firstName}</dd>
              </div>
              <DossierRow label={PROFILE_FIELD_LABELS.lastName} field={f.lastName} />
              <DossierRow label={PROFILE_FIELD_LABELS.sex} field={f.sex} />
              <DossierRow label={PROFILE_FIELD_LABELS.age} field={f.age} />
              <DossierRow label={PROFILE_FIELD_LABELS.lifeStatus} field={f.lifeStatus} />
              <DossierRow label={PROFILE_FIELD_LABELS.faction} field={f.faction} />
              <DossierRow label={PROFILE_FIELD_LABELS.clans} field={f.clans} />
            </dl>
          </section>

          {/* Signalement */}
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Signalement</h2>
            <dl>
              <DossierRow label={PROFILE_FIELD_LABELS.image} field={dossier.image} />
              <DossierRow label={PROFILE_FIELD_LABELS.height} field={f.height} />
              <DossierRow label={PROFILE_FIELD_LABELS.hairColor} field={f.hairColor}>
                {f.hairColor.displayState === "VISIBLE" &&
                f.hairColor.value &&
                typeof f.hairColor.value === "object" &&
                "colorHex" in (f.hairColor.value as object) ? (
                  <span className="inline-flex items-center gap-2 text-sm text-ink">
                    {(f.hairColor.value as { colorHex: string | null }).colorHex && (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 border border-border-strong"
                        style={{ background: (f.hairColor.value as { colorHex: string }).colorHex }}
                      />
                    )}
                    {f.hairColor.displayValue}
                  </span>
                ) : undefined}
              </DossierRow>
              <DossierRow label={PROFILE_FIELD_LABELS.skinTone} field={f.skinTone}>
                {f.skinTone.displayState === "VISIBLE" &&
                f.skinTone.value &&
                typeof f.skinTone.value === "object" ? (
                  <span className="inline-flex items-center gap-2 text-sm text-ink">
                    {(f.skinTone.value as { colorHex: string | null }).colorHex && (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 border border-border-strong"
                        style={{ background: (f.skinTone.value as { colorHex: string }).colorHex }}
                      />
                    )}
                    {f.skinTone.displayValue}
                  </span>
                ) : undefined}
              </DossierRow>
            </dl>
          </section>

          {/* Capacités */}
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Capacités</h2>
            <dl>
              <DossierRow label={PROFILE_FIELD_LABELS.chakraNatures} field={f.chakraNatures} />
              <DossierRow label={PROFILE_FIELD_LABELS.kekkeiGenkai} field={f.kekkeiGenkai} />
              <DossierRow label={PROFILE_FIELD_LABELS.rank} field={f.rank} />
              <DossierRow label={PROFILE_FIELD_LABELS.combatStyles} field={f.combatStyles} />
              <DossierRow label={PROFILE_FIELD_LABELS.kenjutsuStyles} field={f.kenjutsuStyles} />
              <DossierRow label={PROFILE_FIELD_LABELS.artifacts} field={f.artifacts} />
            </dl>
            {/* Subjutsu détaillés (uniquement si visibles) */}
            {f.techniques.displayState === "VISIBLE" && Array.isArray(f.techniques.value) && (
              <div className="mt-3 border-t border-border-default pt-3">
                <h3 className="mb-2 text-[0.7rem] uppercase tracking-wider text-ink-faint">
                  {PROFILE_FIELD_LABELS.techniques}
                </h3>
                <ul className="space-y-2">
                  {(f.techniques.value as {
                    id: string; name: string; shortDescription: string | null;
                    typeLabel: string | null; rank: string | null;
                  }[]).map((technique) => (
                    <li key={technique.id} className="border border-border-default bg-elevated p-2.5">
                      <p className="text-sm text-ink">
                        {technique.name}
                        {technique.rank && (
                          <span className="ml-2 font-mono-toile text-xs text-gold">rang {technique.rank}</span>
                        )}
                        {technique.typeLabel && (
                          <span className="ml-2 text-xs text-ink-faint">{technique.typeLabel}</span>
                        )}
                      </p>
                      {technique.shortDescription && (
                        <p className="mt-0.5 text-xs text-ink-muted">{technique.shortDescription}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.techniques.displayState !== "VISIBLE" && (
              <div className="mt-3 border-t border-border-default pt-3">
                <DossierRow label={PROFILE_FIELD_LABELS.techniques} field={f.techniques} />
              </div>
            )}
          </section>

          {/* Réseau relationnel : fils dorés + vue liste accessible */}
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
              Réseau relationnel
            </h2>
            {relations.length === 0 ? (
              <p className="text-xs text-ink-faint italic">Aucun lien répertorié.</p>
            ) : (
              <>
                {/* Toile : parents/créateurs en haut, fratrie au centre, descendance en bas */}
                <div aria-hidden className="mb-4 hidden sm:block">
                  {(["haut", "côtés", "bas"] as const).map((position) => {
                    const nodes = relations.filter((rel) =>
                      relationGroups.some((g) => g.key === rel.group && g.position === position),
                    );
                    if (position === "côtés") {
                      return (
                        <div key={position} className="my-1 flex items-center justify-center gap-3">
                          <div className="flex flex-1 flex-wrap justify-end gap-2">
                            {nodes.map((rel) => <RelationNode key={rel.relationId} rel={rel} />)}
                          </div>
                          <div className="flex h-12 w-32 shrink-0 items-center justify-center border border-gold bg-elevated font-display text-sm text-gold">
                            {dossier.firstName}
                          </div>
                          <div className="flex-1" />
                        </div>
                      );
                    }
                    return (
                      <div key={position} className="flex flex-col items-center gap-1">
                        <div className="flex flex-wrap justify-center gap-2">
                          {nodes.map((rel) => <RelationNode key={rel.relationId} rel={rel} />)}
                        </div>
                        {nodes.length > 0 && <span className="h-4 w-px bg-gold-dim" />}
                      </div>
                    );
                  })}
                </div>
                {/* Vue liste (toujours présente : le graphe n'est jamais le seul accès) */}
                <ul className="space-y-1 text-sm">
                  {relations.map((rel) => (
                    <li key={`list-${rel.relationId}`} className="flex items-baseline justify-between gap-3">
                      <span className="text-[0.7rem] uppercase tracking-wider text-ink-faint">
                        {rel.typeVisible ? rel.groupLabel : (
                          <span aria-label="Lien connu mais confidentiel" className="font-mono-toile text-gold">???</span>
                        )}
                      </span>
                      <Link href={`/profils/${rel.related.id}`} className="text-ink hover:text-gold">
                        {rel.related.firstName}
                        <span className="ml-2 font-mono-toile text-[0.65rem] text-ink-faint">
                          {rel.related.code}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Analyse */}
          <section className="border border-border-default bg-raised p-5">
            <h2 className="mb-2 font-display text-sm tracking-widest text-gold uppercase">Analyse</h2>
            {(["details", "strengths", "weaknesses"] as const).map((key) => (
              <div key={key} className="mb-3 last:mb-0">
                <h3 className="text-[0.7rem] uppercase tracking-wider text-ink-faint">
                  {PROFILE_FIELD_LABELS[key]}
                </h3>
                {f[key].displayState === "VISIBLE" ? (
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-ink-muted">
                    {f[key].displayValue}
                  </p>
                ) : (
                  <p className="mt-1"><FieldValue field={f[key]} /></p>
                )}
              </div>
            ))}
          </section>

          {/* Renseignements : modération uniquement */}
          {internal && (
            <section className="border border-copper/50 bg-raised p-5">
              <h2 className="mb-2 font-display text-sm tracking-widest text-copper uppercase">
                Renseignements (modération)
              </h2>
              {internal.internalNotes && (
                <p className="mb-3 border border-border-default bg-elevated p-3 text-xs whitespace-pre-line text-ink-muted">
                  {internal.internalNotes}
                </p>
              )}
              <h3 className="text-[0.7rem] uppercase tracking-wider text-ink-faint">Sources</h3>
              <ul className="mt-1 mb-3 space-y-0.5 text-xs text-ink-muted">
                {internal.intel.length === 0 && <li className="italic text-ink-faint">Aucune source.</li>}
                {internal.intel.map((row) => (
                  <li key={row.fieldKey}>
                    · {PROFILE_FIELD_LABELS[row.fieldKey as keyof typeof PROFILE_FIELD_LABELS] ?? row.fieldKey}
                    {" — "}{row.knowledgeState}
                    {row.confidence && ` · ${CONFIDENCE_LABELS[row.confidence as IntelConfidenceCode]}`}
                    {row.sourceMissionCode && ` · mission ${row.sourceMissionCode}`}
                    {row.observedAtRp && ` · observé : ${row.observedAtRp}`}
                  </li>
                ))}
              </ul>
              <h3 className="text-[0.7rem] uppercase tracking-wider text-ink-faint">Historique</h3>
              <ul className="mt-1 space-y-0.5 text-[0.7rem] text-ink-faint">
                {internal.revisions.slice(0, 15).map((rev, i) => (
                  <li key={i}>
                    {new Date(rev.createdAt).toLocaleString("fr-FR")} —{" "}
                    {PROFILE_FIELD_LABELS[rev.fieldKey as keyof typeof PROFILE_FIELD_LABELS] ?? rev.fieldKey}
                    {rev.justification ? ` (${rev.justification})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Colonne latérale (rendue uniquement si elle a du contenu) */}
        <aside className={`space-y-5 ${hasAside ? "" : "hidden"}`}>
          {!viewer.canViewAll && requestableGroups.length > 0 && (
            <section className="border border-border-gold bg-raised p-4">
              <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
                Acheter le dossier
              </h2>
              <RequestAccessPanel profileId={dossier.id} groups={requestableGroups} />
            </section>
          )}
          {!viewer.canViewAll && detail.myPendingRequest && (
            <p className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
              Une demande de votre groupe attend la décision d&rsquo;un tisseur.
            </p>
          )}
          {dossier.canViewValues && !viewer.canViewAll && (
            <p className="border border-gold-dim bg-gold-faint/20 px-3 py-2 text-xs text-gold">
              Votre groupe possède ce dossier : les informations connues vous sont ouvertes.
            </p>
          )}

          {/* Accès accordés : gestion modération */}
          {internal && (
            <section className="border border-border-default bg-raised p-4">
              <h2 className="mb-2 font-display text-xs tracking-widest text-gold uppercase">
                Accès accordés
              </h2>
              {internal.grants.length === 0 && (
                <p className="text-xs text-ink-faint italic">Aucun groupe ne possède ce dossier.</p>
              )}
              <ul className="space-y-2">
                {internal.grants.map((grant) => (
                  <li key={grant.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className={grant.revokedAt ? "text-ink-faint line-through" : "text-ink-muted"}>
                      {grant.groupName}
                      {grant.priceRyos != null && (
                        <span className="ml-1 font-mono-toile text-gold">
                          {grant.priceRyos.toLocaleString("fr-FR")} ryōs
                        </span>
                      )}
                    </span>
                    {!grant.revokedAt && <RevokeGrantButton grantId={grant.id} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}

function RelationNode({ rel }: { rel: RelationView }) {
  return (
    <Link
      href={`/profils/${rel.related.id}`}
      className="border border-border-default bg-elevated px-2 py-1 text-xs text-ink-muted hover:border-border-gold hover:text-gold"
    >
      {rel.related.firstName}
      <span className="ml-1 text-[0.6rem] text-ink-faint">
        {rel.typeVisible ? rel.groupLabel.toLowerCase() : "???"}
      </span>
    </Link>
  );
}
