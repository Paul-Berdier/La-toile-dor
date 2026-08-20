import Link from "next/link";
import { MISSION_PROFILE_ROLE_LABELS, type MissionProfileRole } from "@toile/shared";

/**
 * Cartes des personnes d'une mission — cibles, commanditaires, contacts.
 *
 * Ce qui s'affiche vient du SNAPSHOT pris à la publication : le grade que la
 * cible avait quand le contrat a été écrit, pas celui qu'elle a aujourd'hui.
 * Un dossier consulté six mois plus tard racontera autre chose, et c'est très
 * bien : la mission dit ce qu'elle savait, le dossier dit ce qu'on sait.
 *
 * Le lien vers le dossier reste gouverné par le système de dossiers : la
 * mission ne l'ouvre pas d'elle-même. Un lecteur sans accès y verra un
 * dossier scellé, comme partout ailleurs.
 */

export interface MissionPersonCard {
  linkId: string;
  profileId: string | null;
  /** Nom libre d'une cible historique jamais reliée à un dossier */
  label: string | null;
  role: MissionProfileRole;
  isPrimary: boolean;
  code: string | null;
  name: string | null;
  gradeLabel: string | null;
  classLabel: string | null;
  originLabel: string | null;
  lifeStatus: string | null;
  /** Le dossier a changé depuis la publication (grade, faction) */
  snapshotStale?: boolean;
  outcomeLabel?: string | null;
}

export function MissionPeople({
  title,
  people,
  emptyLabel,
}: {
  title: string;
  people: MissionPersonCard[];
  emptyLabel?: string;
}) {
  if (people.length === 0 && !emptyLabel) return null;
  return (
    <section className="border border-border-default bg-raised p-4">
      <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
        {title}
        {people.length > 1 && <span className="ml-2 text-xs text-ink-faint">({people.length})</span>}
      </h2>
      {people.length === 0 ? (
        <p className="text-xs text-ink-faint italic">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {people.map((person) => (
            <li
              key={person.linkId}
              className="flex flex-col justify-between gap-2 border border-border-default bg-elevated p-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  {person.isPrimary && people.length > 1 && (
                    <span
                      className="text-gold"
                      title={`${MISSION_PROFILE_ROLE_LABELS[person.role]} principale`}
                      aria-label={`${MISSION_PROFILE_ROLE_LABELS[person.role]} principale`}
                    >
                      ★
                    </span>
                  )}
                  <span className="text-sm text-ink">{person.name ?? person.label ?? "Sans nom"}</span>
                  {person.code && (
                    <span className="font-mono-toile text-[0.65rem] text-ink-faint">{person.code}</span>
                  )}
                  {person.lifeStatus === "DEAD" && (
                    <span className="border border-blood/60 px-1 text-[0.6rem] uppercase tracking-wider text-blood-bright">
                      ✕ Mort
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[0.7rem] text-ink-faint">
                  {[person.gradeLabel, person.classLabel, person.originLabel]
                    .filter(Boolean)
                    .join(" · ") || "Grade et origine inconnus"}
                </p>
                {person.snapshotStale && (
                  <p className="mt-1 text-[0.65rem] text-copper">
                    ⟡ Le dossier a évolué depuis la publication — la mission garde l&rsquo;état d&rsquo;alors.
                  </p>
                )}
                {person.outcomeLabel && (
                  <p className="mt-1 text-[0.7rem] text-ink-muted">Sort : {person.outcomeLabel}</p>
                )}
                {!person.profileId && (
                  <p className="mt-1 text-[0.65rem] text-warning">
                    ⚠ Cible saisie avant les dossiers — à relier.
                  </p>
                )}
              </div>
              {person.profileId && (
                <Link
                  href={`/profils/${person.profileId}`}
                  className="self-start font-mono-toile text-[0.7rem] text-gold underline-offset-2 hover:underline"
                >
                  諜 Ouvrir le dossier
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
