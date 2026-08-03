import { prisma } from "@toile/database";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireUser();
  const [users, pending, activeMissions, pendingClaims, invitations, pendingNotifs] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "PENDING" } }),
      prisma.mission.count({ where: { status: { in: ["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"] } } }),
      prisma.missionClaim.count({ where: { status: "PENDING" } }),
      prisma.invitation.count({ where: { status: "ACTIVE" } }),
      prisma.notificationDelivery.count({ where: { status: "PENDING" } }),
    ]);

  const stats = [
    { label: "Membres de la Toile", value: users },
    { label: "En attente d'admission", value: pending, alert: pending > 0 },
    { label: "Contrats ouverts", value: activeMissions },
    { label: "Revendications à traiter", value: pendingClaims, alert: pendingClaims > 0 },
    { label: "Invitations actives", value: invitations },
    { label: "Notifications en file", value: pendingNotifs },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="border border-border-default bg-raised p-4">
          <dt className="text-[0.65rem] uppercase tracking-wider text-ink-faint">{stat.label}</dt>
          <dd
            className={`mt-1 font-display text-2xl ${stat.alert ? "text-warning" : "text-gold"}`}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
