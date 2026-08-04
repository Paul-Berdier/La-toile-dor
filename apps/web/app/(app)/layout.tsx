import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode } from "@/lib/streamer";
import { Sidebar, type NavItem } from "@/components/shell/sidebar";
import { Watermark } from "@/components/shell/watermark";
import { PrivacyGuard } from "@/components/shell/privacy-guard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await requireUser();
  const streamer = await isStreamerMode();

  const [discord, groupMemberships, roles, unreadEchoes] = await Promise.all([
    prisma.discordAccount.findUnique({ where: { userId: current.session.userId } }),
    prisma.groupMember.findMany({
      where: { userId: current.session.userId },
      include: { group: { select: { name: true } } },
    }),
    prisma.userRole.findMany({
      where: { userId: current.session.userId },
      include: { role: true },
    }),
    prisma.notificationDelivery.count({
      where: { userId: current.session.userId, status: "PENDING" },
    }),
  ]);

  const items: NavItem[] = [{ href: "/missions", label: "Missions", glyph: "契" }];
  if (current.permissions.has(PERMISSIONS.CLAIM_REVIEW)) {
    items.push({ href: "/revendications", label: "Revendications", glyph: "願" });
  }
  items.push({ href: "/groupes", label: "Groupes", glyph: "組" });
  items.push({ href: "/profils", label: "Dossiers", glyph: "諜" });
  items.push({ href: "/classement", label: "Classement", glyph: "位" });
  items.push({ href: "/notifications", label: "Échos", glyph: "響", badge: unreadEchoes });
  if (
    current.permissions.has(PERMISSIONS.INVITE_CREATE) ||
    current.permissions.has(PERMISSIONS.INVITE_MANAGE)
  ) {
    items.push({ href: "/invitations", label: "Invitations", glyph: "糸" });
  }
  if (
    current.permissions.has(PERMISSIONS.USER_MANAGE) ||
    current.permissions.has(PERMISSIONS.INVITE_MANAGE) ||
    current.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
  ) {
    items.push({ href: "/admin", label: "Administration", glyph: "統" });
  }

  const discordId = discord?.discordId ?? "";
  const groupLabel = groupMemberships.map((membership) => membership.group.name).join(" / ") || null;
  const identity = {
    displayName: streamer ? "OPÉRATEUR" : current.session.user.displayName,
    partialId: discordId ? `${discordId.slice(0, 3)}···${discordId.slice(-2)}` : "———",
    factionName: streamer ? null : groupLabel,
    sessionShortId: current.session.shortId,
  };

  const roleLabel = roles.map((r) => r.role.name).join(" · ") || "Sans rôle";

  return (
    <PrivacyGuard streamerActive={streamer}>
      <div className="flex min-h-dvh">
        <Sidebar
          items={items}
          userName={streamer ? "Opérateur voilé" : current.session.user.displayName}
          roleLabel={roleLabel}
        />
        {/* Réserve : barre d'onglets mobile + boutons flottants de confidentialité */}
        <div className="flex-1 pb-28 md:pb-16">
          {streamer && (
            <p className="border-b border-gold-dim bg-gold-faint/40 px-4 py-1.5 text-center font-mono-toile text-[0.65rem] uppercase tracking-[0.25em] text-gold">
              Mode Streamer actif — identités et lieux voilés
            </p>
          )}
          {children}
        </div>
      </div>
      {/* Filigrane de coquille (une seconde couche est posée sur les panneaux confidentiels) */}
      <Watermark identity={identity} layer={0} />
    </PrivacyGuard>
  );
}
