import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";
import { IdentityEditForm } from "@/components/compte/identity-edit-form";

export const dynamic = "force-dynamic";

/**
 * « Mes informations » : chacun modifie lui-même son Titre, son grade et son
 * nom. Le rôle et les groupes restent en lecture seule — ils relèvent de la
 * hiérarchie d'invitation, pas de l'intéressé.
 */
export default async function ComptePage() {
  const current = await requireUser();

  const [user, levels] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: current.session.userId },
      select: {
        firstName: true,
        lastName: true,
        displayName: true,
        playerLevelId: true,
        playerLevel: { select: { label: true } },
        roles: { select: { role: { select: { name: true } } } },
        groupMemberships: {
          where: { group: { isActive: true } },
          select: { isLeader: true, group: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.playerLevel.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
  ]);

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
            playerLevelId: user.playerLevelId ?? "",
          }}
          levels={levels}
        />
      </section>

      <aside className="mt-5 border border-gold-dim bg-gold-faint/20 p-4">
        <h2 className="font-display text-xs tracking-[0.2em] text-gold uppercase">
          Qui voit quoi
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Votre <strong>Titre</strong> et votre <strong>grade</strong> sont visibles par
          tous les membres autorisés.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Votre <strong>prénom</strong> et votre <strong>nom</strong> restent
          confidentiels : seuls les modérateurs, les super-modérateurs et les membres
          de vos propres groupes y ont accès.
        </p>
      </aside>

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
