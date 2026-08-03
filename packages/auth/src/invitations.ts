import { prisma } from "@toile/database";
import type { Invitation } from "@toile/database";
import { generateToken, hashInviteToken } from "./crypto";

export interface CreateInvitationInput {
  createdById: string;
  roleId?: string;
  factionId?: string;
  expiresInHours: number;
  requireApproval: boolean;
  restrictedDiscordId?: string;
  note?: string;
}

/**
 * Crée une invitation. Le jeton clair n'est retourné QU'UNE FOIS ici —
 * seul son hash poivré est stocké.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ token: string; invitation: Invitation }> {
  const token = generateToken();
  const invitation = await prisma.invitation.create({
    data: {
      tokenHash: hashInviteToken(token),
      createdById: input.createdById,
      roleId: input.roleId ?? null,
      factionId: input.factionId ?? null,
      expiresAt: new Date(Date.now() + input.expiresInHours * 3600 * 1000),
      requireApproval: input.requireApproval,
      restrictedDiscordId: input.restrictedDiscordId ?? null,
      note: input.note ?? null,
    },
  });
  return { token, invitation };
}

export type InvitationCheck =
  | { valid: true; invitation: Invitation }
  | { valid: false; reason: "invalid" | "expired" | "used" | "revoked" };

/**
 * Vérifie un jeton d'invitation sans le consommer.
 * Les raisons d'échec restent internes : l'interface affiche toujours
 * un message générique pour ne rien révéler.
 */
export async function checkInvitation(token: string): Promise<InvitationCheck> {
  if (!token || token.length < 20) return { valid: false, reason: "invalid" };
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });
  if (!invitation) return { valid: false, reason: "invalid" };
  if (invitation.status === "REVOKED") return { valid: false, reason: "revoked" };
  if (invitation.status === "USED" || invitation.usedById)
    return { valid: false, reason: "used" };
  if (invitation.status === "EXPIRED" || invitation.expiresAt < new Date())
    return { valid: false, reason: "expired" };
  return { valid: true, invitation };
}

/**
 * Consomme une invitation pour un utilisateur donné, de façon atomique :
 * la contrainte d'unicité sur usedById + la clause WHERE status=ACTIVE
 * empêchent toute double utilisation, même en cas de requêtes concurrentes.
 */
export async function consumeInvitation(
  invitationId: string,
  userId: string,
): Promise<boolean> {
  const result = await prisma.invitation.updateMany({
    where: { id: invitationId, status: "ACTIVE", usedById: null },
    data: { status: "USED", usedById: userId, usedAt: new Date() },
  });
  return result.count === 1;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}
