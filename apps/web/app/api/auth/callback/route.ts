import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@toile/database";
import {
  audit,
  checkInvitation,
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
  res.cookies.delete("toile_rp_title");
  res.cookies.delete("toile_village");
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

  // Sans bot sur le serveur, le contrôle des rôles critiques se fait ICI,
  // à chaque connexion : un joueur qui les a tous perdus est suspendu.
  const requiredRoles = (process.env.DISCORD_REQUIRED_ROLE_IDS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const hasRequiredRole =
    requiredRoles.length === 0 || requiredRoles.some((r) => guildRoles!.includes(r));

  const existing = await prisma.discordAccount.findUnique({
    where: { discordId: discordUser.id },
    include: { user: true },
  });

  let userId: string;
  let profileCompleted = false;

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
    // Rôle critique perdu → suspension immédiate + sessions coupées
    if (!hasRequiredRole && existing.user.status === "ACTIVE") {
      await prisma.user.update({
        where: { id: existing.userId },
        data: {
          status: "SUSPENDED",
          revokedReason: "Rôle Discord critique perdu (contrôle à la connexion)",
        },
      });
      await prisma.session.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit({
        actorId: existing.userId,
        action: "access.suspended",
        resourceType: "user",
        resourceId: existing.userId,
        reason: "Rôles Discord critiques perdus",
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }

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
    profileCompleted = existing.user.profileCompleted;
  } else {
    // Nouveau venu sans le rôle critique : refus net
    if (!hasRequiredRole) {
      await audit({
        action: "auth.login_failed",
        reason: "missing_required_role",
        newValues: { discordId: discordUser.id },
        ...meta,
      });
      return redirectTo(req, "/connexion?erreur=acces");
    }

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

    // Fiche RP saisie sur la page d'invitation : le titre devient le nom affiché
    const rpTitle = req.cookies.get("toile_rp_title")?.value?.slice(0, 60).trim() || null;
    const village = req.cookies.get("toile_village")?.value?.slice(0, 60).trim() || null;

    const invitedRole = invitation.roleId
      ? await prisma.role.findUnique({ where: { id: invitation.roleId } })
      : null;
    const isLeaderRole = invitedRole?.slug === "group_leader";

    let user: { id: string };
    try {
      // Création du compte, consommation du fil et affectations sont une seule
      // transaction : aucune course ne peut laisser un compte orphelin.
      user = await prisma.$transaction(async (tx) => {
        if (invitation.groupId) {
          const group = await tx.group.findFirst({
            where: { id: invitation.groupId, isActive: true },
            select: { id: true },
          });
          if (!group) throw new Error("INVITATION_GROUP_INACTIVE");
        }
        const created = await tx.user.create({
          data: {
            displayName: rpTitle ?? discordUser.global_name ?? discordUser.username,
            rpTitle,
            village,
            playerLevelId: invitation.playerLevelId,
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
        const consumed = await tx.invitation.updateMany({
          where: { id: invitation.id, status: "ACTIVE", usedById: null },
          data: { status: "USED", usedById: created.id, usedAt: new Date() },
        });
        if (consumed.count !== 1) throw new Error("INVITATION_RACE");
        if (invitation.roleId) {
          await tx.userRole.create({ data: { userId: created.id, roleId: invitation.roleId } });
        }
        if (invitation.groupId) {
          await tx.groupMember.create({
            data: { groupId: invitation.groupId, userId: created.id, isLeader: isLeaderRole },
          });
        }
        return created;
      });
    } catch {
      await audit({ action: "invite.check_failed", reason: "provisioning_race", ...meta });
      return redirectTo(req, "/connexion?erreur=acces");
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

  // Les profils incomplets (nouveaux comptes et anciens comptes d'avant la
  // refonte d'identité) passent par l'onboarding avant tout accès sensible.
  const res = redirectTo(req, profileCompleted ? "/missions" : "/bienvenue");
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
