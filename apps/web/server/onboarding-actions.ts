"use server";

import { redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { audit } from "@toile/auth";
import {
  onboardingIdentitySchema,
  groupUpsertSchema,
  normalizeDisplayName,
} from "@toile/shared";
import { getCurrentUser, requestMeta } from "@/lib/session";
import {
  getOnboardingState,
  finalizeOnboardingIfComplete,
} from "@/server/onboarding-state";

interface Result {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

// ── Étape 1 : identité ──

export async function completeIdentityAction(raw: unknown): Promise<Result> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Session expirée — reconnectez-vous." };

  const parsed = onboardingIdentitySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const displayName = data.displayName.trim().replace(/\s+/g, " ");
  const norm = normalizeDisplayName(displayName);

  // Unicité du pseudonyme, insensible à la casse
  const taken = await prisma.user.findFirst({
    where: { displayNameNorm: norm, id: { not: current.session.userId } },
    select: { id: true },
  });
  if (taken) {
    return {
      ok: false,
      fieldErrors: { displayName: ["Ce pseudonyme est déjà pris sur la Toile."] },
      error: "Ce pseudonyme est déjà pris sur la Toile.",
    };
  }

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: current.session.userId },
    select: {
      displayName: true,
      firstName: true,
      lastName: true,
      playerLevelId: true,
      privacyAcknowledgedAt: true,
      profileCompleted: true,
    },
  });

  if (before.profileCompleted) {
    return {
      ok: false,
      error: "Votre onboarding est déjà terminé. Utilisez la page Compte pour modifier votre profil.",
    };
  }

  // Une invitation fixe déjà le grade. Un client altéré ne peut pas le
  // remplacer ; seuls les anciens comptes sans grade disposent d'un choix
  // unique pendant cet onboarding.
  if (before.playerLevelId && data.playerLevelId !== before.playerLevelId) {
    return {
      ok: false,
      fieldErrors: { playerLevelId: ["Ce grade a été fixé par votre invitation."] },
      error: "Ce grade initial est verrouillé pendant l'onboarding ; vous pourrez le modifier ensuite dans Mes informations.",
    };
  }
  const effectiveLevelId = before.playerLevelId ?? data.playerLevelId;
  const level = await prisma.playerLevel.findUnique({
    where: { id: effectiveLevelId },
    select: { id: true },
  });
  if (!level) {
    return {
      ok: false,
      fieldErrors: { playerLevelId: ["Ce grade n'existe pas."] },
      error: "Ce grade n'existe pas.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const liveUser = await tx.user.findUnique({
        where: { id: current.session.userId },
        select: {
          playerLevelId: true,
          privacyAcknowledgedAt: true,
          profileCompleted: true,
        },
      });
      if (!liveUser || liveUser.profileCompleted) throw new Error("ONBOARDING_COMPLETED");

      if (!before.playerLevelId) {
        const assigned = await tx.user.updateMany({
          where: { id: current.session.userId, playerLevelId: null },
          data: { playerLevelId: level.id },
        });
        if (assigned.count !== 1) throw new Error("LEVEL_CHANGED");
      }
      await tx.user.update({
        where: { id: current.session.userId },
        data: {
        firstName: data.firstName.trim(),
        lastName: data.lastName?.trim() ? data.lastName.trim() : null,
        displayName,
        displayNameNorm: norm,
        // La date d'acceptation initiale est une preuve : une nouvelle
        // soumission ne doit jamais la remplacer.
        privacyAcknowledgedAt: liveUser.privacyAcknowledgedAt ?? new Date(),
        },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Error && error.message === "ONBOARDING_COMPLETED") {
      return {
        ok: false,
        error: "Votre onboarding vient déjà d'être terminé. Rechargez la page.",
      };
    }
    if (error instanceof Error && error.message === "LEVEL_CHANGED") {
      return {
        ok: false,
        error: "Votre grade vient d'être attribué par la modération. Rechargez la page.",
      };
    }
    if ((error as { code?: string }).code === "P2034") {
      return {
        ok: false,
        error: "Une autre mise à jour vient d'être enregistrée. Rechargez la page.",
      };
    }
    // Course sur l'unicité (deux onboarding simultanés) → message propre
    return {
      ok: false,
      fieldErrors: { displayName: ["Ce pseudonyme vient d'être pris — choisissez-en un autre."] },
      error: "Ce pseudonyme vient d'être pris.",
    };
  }

  const meta = await requestMeta();
  await audit({
    actorId: current.session.userId,
    action: "profile.identity_completed",
    resourceType: "user",
    resourceId: current.session.userId,
    // Jamais le prénom/nom dans l'audit — uniquement le pseudonyme public
    oldValues: { displayName: before.displayName },
    newValues: { displayName },
    ...meta,
  });

  await finalizeOnboardingIfComplete(current.session.userId);
  return { ok: true };
}

// ── Étape 2 (chefs invités en mode création) : créer SON groupe ──

export async function createOnboardingGroupAction(raw: unknown): Promise<Result> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: "Session expirée — reconnectez-vous." };

  // Autorisation STRICTEMENT côté serveur : l'invitation consommée par ce
  // compte doit porter le mode CREATE_NEW_GROUP, et aucune création ne doit
  // déjà avoir eu lieu (un seul groupe par invitation).
  const state = await getOnboardingState(current.session.userId);
  if (!state.groupStepNeeded) {
    return { ok: false, error: "Votre invitation ne permet pas de créer un groupe." };
  }
  if (!state.identityDone) {
    return { ok: false, error: "Complétez d'abord votre identité." };
  }

  const parsed = groupUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Certains champs sont invalides.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const data = parsed.data;
  const name = data.name.trim();

  const meta = await requestMeta();
  try {
    await prisma.$transaction(async (tx) => {
      // Autorisation relue dans LA transaction. Deux soumissions concurrentes
      // observent le même prédicat (aucun groupe dirigé) et l'une d'elles est
      // annulée par l'isolation Serializable lors de l'écriture du profil.
      const [liveInvitation, liveUser, ledGroupCount] = await Promise.all([
        tx.invitation.findUnique({
          where: { usedById: current.session.userId },
          select: { groupOnboardingMode: true, factionId: true },
        }),
        tx.user.findUnique({
          where: { id: current.session.userId },
          select: { firstName: true, privacyAcknowledgedAt: true },
        }),
        tx.groupMember.count({
          where: { userId: current.session.userId, isLeader: true },
        }),
      ]);
      if (liveInvitation?.groupOnboardingMode !== "CREATE_NEW_GROUP" || ledGroupCount !== 0) {
        throw new Error("ONBOARDING_CHANGED");
      }
      if (!liveUser?.firstName || !liveUser.privacyAcknowledgedAt) {
        throw new Error("IDENTITY_INCOMPLETE");
      }

      // La faction est un rattachement facultatif du groupe, jamais une
      // appartenance ni une autorité créée implicitement.
      const factionId = liveInvitation.factionId ?? null;
      if (factionId) {
        const faction = await tx.faction.findFirst({ where: { id: factionId, isActive: true } });
        if (!faction) throw new Error("FACTION_INACTIVE");
      }

      const existing = await tx.group.findFirst({
        where: { factionId, name: { equals: name, mode: "insensitive" } },
      });
      if (existing) throw new Error("NAME_TAKEN");

      const group = await tx.group.create({
        data: {
          factionId,
          name,
          createdById: current.session.userId,
          primaryCountry: data.primaryCountry?.trim() || null,
          primaryVillage: data.primaryVillage?.trim() || null,
          specialties: data.specialties,
        },
      });
      await tx.groupMember.create({
        data: { groupId: group.id, userId: current.session.userId, isLeader: true },
      });
      await tx.user.update({
        where: { id: current.session.userId },
        data: { profileCompleted: true },
      });

      await audit({
        actorId: current.session.userId,
        action: "group.created",
        resourceType: "group",
        resourceId: group.id,
        newValues: { name, via: "onboarding" },
        ...meta,
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Error && error.message === "ONBOARDING_CHANGED") {
      return { ok: false, error: "Ce groupe a déjà été créé ou votre invitation a changé." };
    }
    if (error instanceof Error && error.message === "IDENTITY_INCOMPLETE") {
      return { ok: false, error: "Complétez d'abord votre identité." };
    }
    if (error instanceof Error && error.message === "NAME_TAKEN") {
      return { ok: false, error: "Un groupe porte déjà ce nom dans ce rattachement." };
    }
    if (error instanceof Error && error.message === "FACTION_INACTIVE") {
      return { ok: false, error: "La faction prévue par l'invitation n'est plus disponible." };
    }
    if ((error as { code?: string }).code === "P2034") {
      return {
        ok: false,
        error: "Une autre création vient d'être enregistrée. Rechargez la page.",
      };
    }
    throw error;
  }

  redirect("/missions");
}
