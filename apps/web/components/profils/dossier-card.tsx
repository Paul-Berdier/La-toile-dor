import Link from "next/link";
import { ACCESS_ORIGIN_HINTS, ACCESS_ORIGIN_LABELS, type AccessOrigin } from "@toile/shared";
import type { ProfileListRow } from "@/server/profiles/queries";
import { FieldValue } from "@/components/profils/field-value";
import { BulkSelectCheckbox } from "@/components/profils/bulk-life-status";

/**
 * Croix rouge en travers d'un portrait : le ninja est MORT. Rendue seulement
 * quand l'état vital est VISIBLE pour le lecteur — un dossier scellé garde
 * son secret, même celui-là.
 */
export function DeadCross({ label = "Mort" }: { label?: string }) {
  return (
    <span
      role="img"
      aria-label={`Ninja mort — ${label}`}
      title={label}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <span aria-hidden className="absolute left-1/2 top-1/2 h-[140%] w-[3px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-blood-bright/90" />
      <span aria-hidden className="absolute left-1/2 top-1/2 h-[140%] w-[3px] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-blood-bright/90" />
    </span>
  );
}

/**
 * Carte d'un dossier dans la liste.
 *
 * Deux états qui ne doivent pas se ressembler : un dossier ACQUIS montre son
 * portrait, « Grade · Classe », la faction, et dit pourquoi on le voit ; un
 * dossier SCELLÉ montre une silhouette, les mêmes rubriques en « ??? » ou
 * « Inconnu » (des ÉTATS, jamais des valeurs), le sceau « Dossier non acquis »
 * et l'action qui l'ouvrirait. Titre, prénom et nom sont les seules vraies
 * valeurs sur une carte scellée — c'est la règle du produit, et le serveur
 * n'en envoie pas davantage.
 *
 * Rien n'est masqué en CSS : si une valeur n'est pas là, c'est qu'elle n'a
 * jamais quitté le serveur.
 */
export function DossierCard({
  row,
  href,
  isModerator,
}: {
  row: ProfileListRow;
  href: string;
  isModerator: boolean;
}) {
  const sealed = !row.canViewValues;
  const fullName = [row.firstName, row.lastName].filter(Boolean).join(" ");
  const p = row.preview;
  // Croix rouge : seulement quand l'état vital est réellement servi au lecteur
  const dead = p.lifeStatus.displayState === "VISIBLE" && p.lifeStatus.value === "DEAD";

  return (
    <li>
      <article
        className={`flex h-full flex-col border bg-raised transition-colors ${
          sealed
            ? "border-border-default hover:border-border-gold"
            : "border-border-gold/60 hover:border-gold"
        }`}
      >
        <Link href={href} className="flex flex-1 gap-3 p-3 hover:bg-hover-bg">
          <span className="relative h-24 w-[4.25rem] shrink-0">
            {row.hasVisiblePortrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/profils/${row.id}/image`}
                alt=""
                loading="lazy"
                className={`h-24 w-[4.25rem] border border-border-gold object-cover ${dead ? "opacity-70 grayscale" : ""}`}
              />
            ) : (
              <Silhouette sealed={sealed} />
            )}
            {dead && <DeadCross />}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block font-mono-toile text-[0.65rem] tracking-wider text-ink-faint">
              {row.code}
            </span>
            <span className="block truncate font-display text-sm tracking-wide text-gold">
              {row.title}
            </span>
            <span className="block truncate text-sm text-ink">
              {fullName}
              {dead && (
                <span className="ml-1.5 border border-blood/60 px-1 align-middle font-mono-toile text-[0.6rem] uppercase tracking-wider text-blood-bright">
                  ✕ Mort
                </span>
              )}
            </span>

            {sealed ? (
              /* Carte scellée : les rubriques clés, en états seulement. On voit
                 d'un coup d'œil ce que la Toile SAIT (???) et ce qu'elle
                 IGNORE (Inconnu) — sans jamais lire une valeur. */
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.7rem]">
                {([
                  ["Classe", p.ninjaClass],
                  ["Grade", p.rank],
                  ["Faction", p.faction],
                  ["Yeux", p.eyeColor],
                ] as const).map(([label, field]) => (
                  <div key={label} className="contents">
                    <dt className="text-ink-faint">{label}</dt>
                    <dd className="min-w-0 pr-0.5 text-right">
                      <FieldValue field={field} compact />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              /* Carte acquise : « Grade · Classe », puis la faction */
              <span className="mt-1.5 block text-xs text-ink-muted">
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <FieldValue field={p.rank} compact />
                  <span aria-hidden className="text-ink-faint">·</span>
                  <FieldValue field={p.ninjaClass} compact />
                </span>
                <span className="mt-0.5 block truncate">
                  <FieldValue field={p.faction} compact />
                </span>
              </span>
            )}

            <span className="mt-2 flex flex-wrap gap-1">
              {sealed ? (
                <span
                  className="inline-flex items-center gap-1 border border-border-default px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-ink-faint"
                  aria-label="Dossier non acquis"
                >
                  <span aria-hidden className="font-display text-gold-dim">封</span>
                  Dossier non acquis
                </span>
              ) : (
                <OriginBadge origin={row.accessOrigin} isModerator={isModerator} />
              )}
              {row.accessBadge === "pending" && (
                <span className="border border-warning/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-warning">
                  Demande en attente
                </span>
              )}
              {row.accessBadge === "refused" && (
                <span className="border border-blood/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-blood-bright">
                  Refusée
                </span>
              )}
              {isModerator && (row.pendingRequests ?? 0) > 0 && (
                <span className="border border-warning/50 px-1.5 py-0.5 text-[0.6rem] uppercase text-warning">
                  {row.pendingRequests} demande{(row.pendingRequests ?? 0) > 1 ? "s" : ""}
                </span>
              )}
              {isModerator && (
                <span className="px-1.5 py-0.5 text-[0.6rem] text-ink-faint">
                  {row.intelCount} renseignement{(row.intelCount ?? 0) > 1 ? "s" : ""}
                </span>
              )}
            </span>
          </span>
        </Link>

        {/* Action principale, distincte selon l'état : on n'« ouvre » pas ce
            qu'on ne possède pas, on le « voit » — et on peut le demander. */}
        <div className="flex items-center justify-between gap-2 border-t border-border-default/60 px-3 py-2">
          <span className="flex items-center gap-3">
            <Link
              href={href}
              className="text-xs text-gold underline-offset-2 hover:underline"
            >
              {sealed ? "Voir" : "Ouvrir le dossier"}
            </Link>
            {/* Sélection multiple : ne rend rien hors modération (provider absent) */}
            <BulkSelectCheckbox profileId={row.id} name={fullName || row.code} />
          </span>
          {sealed && !isModerator && row.accessBadge !== "pending" && (
            <Link
              href={`${href}#acces`}
              className="text-xs text-ink-muted underline-offset-2 hover:text-gold hover:underline"
            >
              Demander l&rsquo;accès
            </Link>
          )}
        </div>
      </article>
    </li>
  );
}

/** « ✓ Créé par votre groupe », « ✓ Dossier acquis »… — pourquoi on voit. */
export function OriginBadge({ origin, isModerator }: { origin: AccessOrigin | null; isModerator: boolean }) {
  if (origin) {
    const owned = origin === "CREATED_BY_GROUP";
    const provisional = origin === "MISSION_TARGET";
    return (
      <span
        title={ACCESS_ORIGIN_HINTS[origin]}
        className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider ${
          owned
            ? "border-gold bg-gold-faint/40 text-gold"
            : provisional
              ? "border-copper/60 bg-gold-faint/10 text-copper"
              : "border-gold-dim bg-gold-faint/20 text-gold"
        }`}
      >
        <span aria-hidden>{provisional ? "⟡" : "✓"}</span>
        {ACCESS_ORIGIN_LABELS[origin]}
      </span>
    );
  }
  if (isModerator) {
    return (
      <span className="border border-copper/50 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-copper">
        Modération
      </span>
    );
  }
  return null;
}

/**
 * Silhouette originale de la Toile — jamais l'image réelle d'un dossier
 * scellé, et une trame différente selon qu'il n'y a pas de portrait ou qu'il
 * y en a un qu'on ne peut pas voir : « Inconnu » et « ??? » ne se
 * ressemblent pas, même pour une image.
 */
function Silhouette({ sealed }: { sealed: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-24 w-[4.25rem] shrink-0 items-center justify-center border font-display ${
        sealed
          ? "border-gold-dim bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(184,150,62,0.12)_4px,rgba(184,150,62,0.12)_8px)] text-gold"
          : "border-border-default bg-elevated text-ink-faint"
      }`}
    >
      {sealed ? "封" : "諜"}
    </span>
  );
}
