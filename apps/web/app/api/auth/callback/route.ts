import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import {
  audit,
  checkInvitation,
  consumeInvitation,
  createSession,
  exchangeCode,
  fetchDiscordUser,
  fetchGuildMemberRoles,
  rateLimit,
  reduceUserAgent,
  truncateIp,
  SESSION_COOKIE,
} from "@toile/auth";

export const dynamic = "force-dynamic";

function redirectTo(req: NextRequest, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, process.env.APP_URL ?? req.url));
  // Les cookies du flux OAuth sont à usage unique
  res.cookies.delete("toile_oauth_state");
  res.cookies.delete("toile_invite");
  return res;
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const meta = {
    ipHash: truncateIp(ip),
    userAgent: reduceUserAgent(req.headers.get("user-agent")),
  };

  const limit = rateLimit(`callback:${ip}`, 10, 60);
  if (!limit.allowed) return redirectTo(req, "/connexion?erreur=limite");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const stateCookie = req.cookies.get("toile_oauth_state")?.value;

  if (!code || !state || !stateCookie || state !== stateCookie) {
    await audit({ action: "auth.login_failed", reason: "state_mismatch", ...meta });
    return redirectTo(req, "/connexion?erreur=acces");
  }

  let discordUser;
  let guildRoles: string[] | null = null;
  try {
    const { accessToken } = await exchangeCode(code);
    discordUser = await fetchDiscordUser(accessToken);
    guildRoles = await fetchGuildMemberRoles(accessToken);
  } catch {
    await audit({ action: "auth.login_failed", reason: "oauth_exchange", ...meta });
    return redirectTo(req, "/connexion?erreur=acces");
  }

  // Appartenance au serveur Discord du RP obligatoire
  if (guildRoles === null) {
    await audit({
      action: "auth.login_failed",
      reason: "not_guild_member",
      newValues: { discordId: discordUser.id },
      ...meta,
    });
    return redirectTo(req, "/connexion?erreur=acces");
  }

  const existing = await prisma.discordAccount.findUnique({
    where: { discordId: discordUser.id },
    include: { user: true },
  });

  let userId: string;

  if (existing) {
    // Compte connu : rafraîchir le profil et les rôles observés
    await prisma.discordAccount.update({
      where: { id: existing.id },
      data: {
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatarHash: discordUser.avatar,
        guildRoles,
        syncedAt: new Date(),
      },
    });
    const status = existing.user.status;
    if (status === "REVOKED" || status === "SUSPENDED") {
      await audit({
        actorId: existing.userId,
        action: "auth.login_refused",
        reason: `statut:${status}`,
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }
    if (status === "PENDING") return redirectTo(req, "/attente");
    userId = existing.userId;
  } else {
    // Nouveau compte : exige une invitation valide (aucune inscription publique)
    const inviteToken = req.cookies.get("toile_invite")?.value;
    if (!inviteToken) {
      await audit({
        action: "auth.login_failed",
        reason: "no_invitation",
        newValues: { discordId: discordUser.id },
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }
    const check = await checkInvitation(inviteToken);
    if (!check.valid) {
      await audit({
        action: "invite.check_failed",
        reason: check.reason,
        newValues: { discordId: discordUser.id },
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }
    const invitation = check.invitation;
    if (invitation.restrictedDiscordId && invitation.restrictedDiscordId !== discordUser.id) {
      await audit({
        action: "invite.check_failed",
        reason: "discord_id_mismatch",
        resourceType: "invitation",
        resourceId: invitation.id,
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }

    const user = await prisma.user.create({
      data: {
        displayName: discordUser.global_name ?? discordUser.username,
        status: invitation.requireApproval ? "PENDING" : "ACTIVE",
        approvedAt: invitation.requireApproval ? null : new Date(),
        discordAccount: {
          create: {
            discordId: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name,
            avatarHash: discordUser.avatar,
            guildRoles,
            syncedAt: new Date(),
          },
        },
      },
    });

    const consumed = await consumeInvitation(invitation.id, user.id);
    if (!consumed) {
      // Course perdue : l'invitation vient d'être utilisée par ailleurs
      await prisma.user.delete({ where: { id: user.id } });
      await audit({ action: "invite.check_failed", reason: "race_used", ...meta });
      return redirectTo(req, "/connexion?erreur=acces");
    }

    if (invitation.roleId) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: invitation.roleId } });
    }
    if (invitation.factionId) {
      await prisma.factionMember.create({
        data: {
          factionId: invitation.factionId,
          userId: user.id,
          isLeader: invitation.roleId
            ? (await prisma.role.findUnique({ where: { id: invitation.roleId } }))?.slug ===
              "faction_leader"
            : false,
        },
      });
    }

    await audit({
      actorId: user.id,
      action: "invite.used",
      resourceType: "invitation",
      resourceId: invitation.id,
      ...meta,
    });

    if (invitation.requireApproval) return redirectTo(req, "/attente");
    userId = user.id;
  }

  // Session en cookie HttpOnly
  const { token, session } = await createSession(userId, {
    ipTrunc: meta.ipHash,
    userAgent: meta.userAgent,
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: userId, action: "auth.login", ...meta });

  const res = redirectTo(req, "/missions");
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
