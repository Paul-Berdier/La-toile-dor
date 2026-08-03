import { redirect } from "next/navigation";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await requireUser();
  const canAccess =
    current.permissions.has(PERMISSIONS.USER_MANAGE) ||
    current.permissions.has(PERMISSIONS.INVITE_MANAGE) ||
    current.permissions.has(PERMISSIONS.SETTINGS_MANAGE) ||
    current.permissions.has(PERMISSIONS.AUDIT_READ);
  if (!canAccess) redirect("/missions");

  const links = [
    { href: "/admin", label: "Vue d'ensemble" },
    { href: "/admin/utilisateurs", label: "Utilisateurs" },
    { href: "/invitations", label: "Invitations" },
    { href: "/admin/factions", label: "Factions" },
    { href: "/admin/configuration", label: "Configuration" },
    { href: "/admin/audit", label: "Journal d'audit" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <h1 className="font-display text-xl tracking-[0.15em] text-ink uppercase">
        Chambre du Tisseur
      </h1>
      <AdminNav links={links} />
      {children}
    </div>
  );
}
