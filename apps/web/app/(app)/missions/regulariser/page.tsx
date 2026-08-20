import Link from "next/link";
import { prisma } from "@toile/database";
import { PERMISSIONS, categoryLabel, formatMissionRank } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * MISSIONS À RÉGULARISER — modération.
 *
 * Avant la refonte, une cible était du texte libre : « Akira Hoki », sans
 * dossier, sans grade, sans village. Ces missions restent parfaitement
 * fonctionnelles — mais elles échappent au titre automatique, au niveau de
 * cible dérivé et au rapport de fin qui sait à qui il a affaire.
 *
 * Cette page les rassemble pour qu'on les relie tranquillement, une par une,
 * quand on a le temps. Rien n'est fait automatiquement : deviner quel dossier
 * se cache derrière un nom serait le meilleur moyen de rattacher la mauvaise
 * personne à un contrat d'assassinat.
 */
export default async function RegulariserPage() {
  await requireUserWith(PERMISSIONS.MISSION_UPDATE);

  const missions = await prisma.mission.findMany({
    where: {
      status: { notIn: ["ARCHIVED"] },
      OR: [
        // Une cible ou un commanditaire nommés en texte libre
        { targetIdentity: { not: null } },
        { clientName: { not: null } },
        // Un titre encore écrit à la main
        { titleAuto: false },
        // Aucun lien vers un dossier, alors que le contrat vise quelqu'un
        { targets: { none: { profileId: { not: null }, role: "TARGET" } } },
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      code: true,
      status: true,
      rank: true,
      rankModifier: true,
      category: true,
      publicTitle: true,
      titleAuto: true,
      targetIdentity: true,
      clientName: true,
      targetLevel: { select: { label: true } },
      targets: {
        select: { id: true, role: true, profileId: true, label: true },
      },
    },
  });

  const rows = missions.map((mission) => {
    const linkedTargets = mission.targets.filter((t) => t.role === "TARGET" && t.profileId);
    const linkedClients = mission.targets.filter((t) => t.role === "CLIENT" && t.profileId);
    const gaps: string[] = [];
    if (mission.targetIdentity && linkedTargets.length === 0) gaps.push("cible en texte libre");
    if (mission.clientName && linkedClients.length === 0) gaps.push("commanditaire en texte libre");
    if (!mission.titleAuto) gaps.push("titre écrit à la main");
    if (linkedTargets.length === 0 && !mission.targetIdentity) gaps.push("aucune cible rattachée");
    return { mission, linkedTargets, linkedClients, gaps };
  }).filter((row) => row.gaps.length > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <Link
        href="/missions"
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Retour au tableau
      </Link>
      <h1 className="mt-3 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Missions à régulariser
      </h1>
      <p className="mt-1 mb-6 max-w-3xl text-xs text-ink-faint">
        Contrats saisis avant que les cibles ne deviennent des dossiers. Ils fonctionnent tels
        quels ; les relier permet au titre public de se composer seul, au niveau de cible de se
        déduire, et au rapport de fin de mission de savoir de qui l&rsquo;on parle. Rien n&rsquo;est
        rattaché automatiquement : le bon dossier ne se devine pas.
      </p>

      {rows.length === 0 ? (
        <p className="border border-border-default bg-raised p-8 text-center text-sm text-ink-faint italic">
          Rien à régulariser — toutes les missions vivantes sont reliées à leurs dossiers.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ mission, linkedTargets, linkedClients, gaps }) => (
            <li
              key={mission.id}
              className="flex flex-wrap items-start justify-between gap-3 border border-border-default bg-raised p-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-toile text-xs text-ink-faint">{mission.code}</span>
                  <span className="border border-border-default px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {mission.status}
                  </span>
                  <span className="font-mono-toile text-[0.65rem] text-gold">
                    {formatMissionRank(mission.rank, mission.rankModifier)}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-ink">{mission.publicTitle}</p>
                <p className="text-[0.7rem] text-ink-faint">
                  {categoryLabel(mission.category)}
                  {mission.targetLevel && ` · niveau cible ${mission.targetLevel.label}`}
                  {linkedTargets.length > 0 && ` · ${linkedTargets.length} cible(s) reliée(s)`}
                  {linkedClients.length > 0 && ` · ${linkedClients.length} commanditaire(s) relié(s)`}
                </p>
                {mission.targetIdentity && (
                  <p className="mt-1 text-[0.7rem] text-warning">
                    Cible saisie : « {mission.targetIdentity} »
                  </p>
                )}
                {mission.clientName && (
                  <p className="text-[0.7rem] text-warning">
                    Commanditaire saisi : « {mission.clientName} »
                  </p>
                )}
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {gaps.map((gap) => (
                    <span
                      key={gap}
                      className="border border-warning/50 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-warning"
                    >
                      {gap}
                    </span>
                  ))}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/missions/${mission.id}`} className={buttonClasses("ghost", "sm")}>
                  Voir
                </Link>
                <Link href={`/missions/${mission.id}/modifier`} className={buttonClasses("outline", "sm")}>
                  Relier les dossiers
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
