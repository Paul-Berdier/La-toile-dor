import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";
import { isStreamerMode } from "@/lib/streamer";
import { IdentityEditForm } from "@/components/compte/identity-edit-form";

export const dynamic = "force-dynamic";

/**
 * « Mes informations » : chacun modifie lui-même son Titre et son nom. Le
 * grade, le rôle et les groupes restent en lecture seule.
 */
export default async function ComptePage() {
  const current = await requireUser();
  const streamer = await isStreamerMode();

  // Barrière placée AVANT la requête de fiche : en mode Streamer, les noms,
  // la bio et les métadonnées du portrait ne sont ni relus ici ni transmis
  // au composant client d'édition.
  if (streamer) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6 lg:px-6">
        <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
          Mes informations
        </h1>
        <section role="status" className="mt-6 border border-border-gold bg-raised p-5">
          <h2 className="font-display text-sm tracking-widest text-gold uppercase">
            Édition protégée
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Le mode Streamer est actif : vos informations personnelles et les outils
            d&rsquo;édition ne sont pas chargés sur cette page.
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            Désactivez le mode Streamer avec le bouton « 隠 » ou le raccourci
            Ctrl+Maj+S, puis revenez ici pour modifier votre fiche.
          </p>
        </section>
      </main>
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      publicBio: true,
      specialties: true,
      portraitMime: true,
      playerLevelId: true,
      identityVisibility: true,
      playerLevel: { select: { label: true } },
      roles: { select: { role: { select: { name: true } } } },
      groupMemberships: {
        where: { group: { isActive: true } },
        select: { isLeader: true, group: { select: { id: true, name: true } } },
      },
    },
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Mes informations
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Ce que la Toile retient de vous — et ce qu&rsquo;elle en montre.
      </p>

      <section className="border border-border-gold bg-raised p-5">
        <IdentityEditForm
          initial={{
            firstName: user.firstName ?? "",
            lastName: user.lastName ?? "",
            displayName: user.displayName,
            publicBio: user.publicBio ?? "",
            specialties: user.specialties,
            hasPortrait: user.portraitMime !== null,
            playerLevelLabel: user.playerLevel?.label ?? "Non déclaré",
            identityVisibility: user.identityVisibility,
          }}
          userId={user.id}
        />
      </section>

      {/* Position dans la hiérarchie : lecture seule */}
      <section className="mt-5 border border-border-default bg-raised p-5">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Votre position
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3 border-b border-border-default/60 pb-2">
            <dt className="text-xs uppercase tracking-wider text-ink-faint">Rôle</dt>
            <dd className="text-ink-muted">
              {user.roles.map((r) => r.role.name).join(", ") || "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-border-default/60 pb-2">
            <dt className="text-xs uppercase tracking-wider text-ink-faint">Grade actuel</dt>
            <dd className="text-ink-muted">{user.playerLevel?.label ?? "Non déclaré"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs uppercase tracking-wider text-ink-faint">Groupes</dt>
            <dd className="text-right text-ink-muted">
              {user.groupMemberships.length === 0
                ? "Aucun"
                : user.groupMemberships
                    .map((m) => `${m.group.name}${m.isLeader ? " (chef)" : ""}`)
                    .join(", ")}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[0.65rem] text-ink-faint">
          Rôle et groupes relèvent de la hiérarchie d&rsquo;invitation : adressez-vous à
          un modérateur pour les faire évoluer.
        </p>
      </section>
    </main>
  );
}
