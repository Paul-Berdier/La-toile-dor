import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import { InvitationForm, RevokeInvitationButton } from "@/components/admin/invitation-form";

export const dynamic = "force-dynamic";

const STATUS_FR: Record<string, { label: string; style: string }> = {
  ACTIVE: { label: "Active", style: "text-success" },
  USED: { label: "Utilisée", style: "text-ink-faint" },
  REVOKED: { label: "Révoquée", style: "text-blood-bright" },
  EXPIRED: { label: "Expirée", style: "text-copper" },
};

export default async function AdminInvitationsPage() {
  await requireUserWith(PERMISSIONS.INVITE_MANAGE);

  const [invitations, factions] = await Promise.all([
    prisma.invitation.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        createdBy: { select: { displayName: true } },
        usedBy: { select: { displayName: true } },
        role: { select: { name: true } },
        faction: { select: { name: true } },
      },
    }),
    prisma.faction.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-6">
      <InvitationForm factions={factions} />

      <div className="overflow-x-auto border border-border-default bg-raised">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <caption className="sr-only">Invitations émises</caption>
          <thead>
            <tr className="border-b border-border-gold font-mono-toile text-[0.65rem] uppercase tracking-wider text-ink-faint">
              <th scope="col" className="px-4 py-3">Créée</th>
              <th scope="col" className="px-4 py-3">Rôle / faction</th>
              <th scope="col" className="px-4 py-3">Expire</th>
              <th scope="col" className="px-4 py-3">Statut</th>
              <th scope="col" className="px-4 py-3">Utilisée par</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
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
                    <p className="text-[0.65rem] text-ink-faint">
                      par {invitation.createdBy.displayName}
                    </p>
                    {invitation.note && (
                      <p className="text-[0.65rem] text-ink-faint italic">{invitation.note}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {invitation.role?.name ?? "—"}
                    {invitation.faction && (
                      <p className="text-[0.65rem] text-ink-faint">{invitation.faction.name}</p>
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
  );
}
