import { redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { PERMISSIONS, categoryLabel } from "@toile/shared";
import { requireUser } from "@/lib/session";
import {
  InvitationForm,
  RevokeInvitationButton,
  type FactionOption,
  type GroupOption,
} from "@/components/admin/invitation-form";

export const dynamic = "force-dynamic";

const STATUS_FR: Record<string, { label: string; style: string }> = {
  ACTIVE: { label: "Active", style: "text-success" },
  USED: { label: "Utilisée", style: "text-ink-faint" },
  REVOKED: { label: "Révoquée", style: "text-blood-bright" },
  EXPIRED: { label: "Expirée", style: "text-copper" },
};

const INVITE_TIERS: Record<string, string[]> = {
  super_admin: ["super_admin", "moderator", "group_leader", "group_member"],
  moderator: ["group_leader", "group_member"],
  group_leader: ["group_member"],
};

export default async function InvitationsPage() {
  const current = await requireUser();
  const canManage = current.permissions.has(PERMISSIONS.INVITE_MANAGE);
  if (!canManage && !current.permissions.has(PERMISSIONS.INVITE_CREATE)) {
    redirect("/missions");
  }

  const userRoles = await prisma.userRole.findMany({
    where: { userId: current.session.userId },
    include: { role: { select: { slug: true } } },
  });
  const slugs = new Set(userRoles.map((r) => r.role.slug));
  const allowedRoles = [
    ...new Set([...slugs].flatMap((slug) => INVITE_TIERS[slug] ?? [])),
  ];
  const isModOrAbove = slugs.has("super_admin") || slugs.has("moderator");

  // Chefs « purs » : seuls leurs groupes sont proposés
  let leaderGroups: GroupOption[] | null = null;
  // Les factions ne servent plus qu'à rassembler les groupes existants :
  // l'invitation ne parle que de groupe.
  let factions: FactionOption[] = [];
  let groups: GroupOption[] = [];
  if (isModOrAbove) {
    factions = (
      await prisma.faction.findMany({
        where: { isActive: true },
        include: {
          groups: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              primaryCountry: true,
              primaryVillage: true,
              specialties: true,
              members: {
                where: { isLeader: true },
                select: { user: { select: { displayName: true } } },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      })
    ).map((faction) => ({
      id: faction.id,
      name: faction.name,
      groups: faction.groups.map((group) => ({
        id: group.id,
        name: group.name,
        factionId: faction.id,
        factionName: faction.name,
        primaryCountry: group.primaryCountry,
        primaryVillage: group.primaryVillage,
        specialties: group.specialties.map((s) => categoryLabel(s)),
        // Pseudonymes publics uniquement — jamais l'identité réelle ici
        leaderNames: group.members.map((m) => m.user.displayName),
      })),
    }));
    const unaffiliated = await prisma.group.findMany({
      where: { isActive: true, factionId: null },
      include: {
        members: {
          where: { isLeader: true },
          select: { user: { select: { displayName: true } } },
        },
      },
      orderBy: { name: "asc" },
    });
    groups = [
      ...factions.flatMap((faction) => faction.groups ?? []),
      ...unaffiliated.map((group) => ({
        id: group.id,
        name: group.name,
        factionId: null,
        factionName: null,
        primaryCountry: group.primaryCountry,
        primaryVillage: group.primaryVillage,
        specialties: group.specialties.map((s) => categoryLabel(s)),
        leaderNames: group.members.map((m) => m.user.displayName),
      })),
    ];
  } else {
    const led = await prisma.groupMember.findMany({
      where: { userId: current.session.userId, isLeader: true, group: { isActive: true } },
      include: { group: { include: { faction: { select: { name: true } } } } },
    });
    leaderGroups = led.map((membership) => ({
      id: membership.groupId,
      name: membership.group.name,
      factionId: membership.group.factionId,
      factionName: membership.group.faction?.name ?? null,
      primaryCountry: membership.group.primaryCountry,
      primaryVillage: membership.group.primaryVillage,
      specialties: membership.group.specialties.map((s) => categoryLabel(s)),
      leaderNames: [],
    }));
  }

  const invitations = await prisma.invitation.findMany({
    // Sans invite.manage, chacun ne voit que les fils qu'il a tendus
    where: canManage ? {} : { createdById: current.session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      createdBy: { select: { displayName: true } },
      usedBy: { select: { displayName: true } },
      role: { select: { name: true } },
      faction: { select: { name: true } },
      group: { select: { name: true } },
      playerLevel: { select: { label: true } },
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Fils d&rsquo;invitation
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        {canManage
          ? "Le Tisseur voit tous les fils tendus sur la Toile."
          : isModOrAbove
            ? "Vous pouvez tendre un fil vers un chef de groupe ou un agent."
            : "Vous pouvez tendre un fil vers un agent, pour l'un de vos groupes."}
      </p>

      <div className="space-y-6">
        <InvitationForm
          allowedRoles={allowedRoles}
          groups={groups}
          leaderGroups={leaderGroups}
        />

        <div className="overflow-x-auto border border-border-default bg-raised">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Invitations émises</caption>
            <thead>
              <tr className="border-b border-border-gold font-mono-toile text-[0.65rem] uppercase tracking-wider text-ink-faint">
                <th scope="col" className="px-4 py-3">Créée</th>
                <th scope="col" className="px-4 py-3">Rôle / affectation</th>
                <th scope="col" className="px-4 py-3">Expire</th>
                <th scope="col" className="px-4 py-3">Statut</th>
                <th scope="col" className="px-4 py-3">Utilisée par</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {invitations.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-ink-faint italic">
                    Aucun fil tendu pour l&rsquo;instant.
                  </td>
                </tr>
              )}
              {invitations.map((invitation) => {
                const effective =
                  invitation.status === "ACTIVE" && invitation.expiresAt < new Date()
                    ? "EXPIRED"
                    : invitation.status;
                const status = STATUS_FR[effective]!;
                return (
                  <tr key={invitation.id} className="border-b border-border-default hover:bg-hover-bg">
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {invitation.createdAt.toLocaleString("fr-FR")}
                      {canManage && (
                        <p className="text-[0.65rem] text-ink-faint">
                          par {invitation.createdBy.displayName}
                        </p>
                      )}
                      {invitation.note && (
                        <p className="text-[0.65rem] text-ink-faint italic">{invitation.note}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {invitation.role?.name ?? "—"}
                      {/* Le grade est déclaré par l'invité : il n'apparaît que
                          sur les anciens fils, où l'inviteur le fixait. */}
                      {invitation.playerLevel && (
                        <p className="text-[0.65rem] text-ink-faint">
                          Grade imposé : {invitation.playerLevel.label}
                        </p>
                      )}
                      {invitation.group && (
                        <p className="text-[0.65rem] text-ink-faint">
                          Groupe : {invitation.group.name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {invitation.expiresAt.toLocaleString("fr-FR")}
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${status.style}`}>{status.label}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-muted">
                      {invitation.usedBy?.displayName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {effective === "ACTIVE" && (
                        <RevokeInvitationButton invitationId={invitation.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
