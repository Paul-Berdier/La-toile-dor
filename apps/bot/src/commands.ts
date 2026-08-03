import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma } from "@toile/database";

/**
 * Commandes /toile — TOUTES les réponses sont éphémères et ne contiennent
 * que des informations publiques. Les détails confidentiels restent sur le site,
 * derrière l'authentification.
 */
export const toileCommand = new SlashCommandBuilder()
  .setName("toile")
  .setDescription("La Toile d'Or — réseau de contrats (RP)")
  .addSubcommand((sub) =>
    sub.setName("missions").setDescription("Contrats actuellement disponibles"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("mission")
      .setDescription("Aperçu public d'un contrat")
      .addStringOption((opt) =>
        opt.setName("code").setDescription("Code du contrat (ex : TO-A-0007)").setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName("classement").setDescription("Constellation des factions"))
  .addSubcommand((sub) =>
    sub
      .setName("notifications")
      .setDescription("Activer ou couper vos messages privés")
      .addStringOption((opt) =>
        opt
          .setName("mode")
          .setDescription("on, off, ou silence 8 h")
          .setRequired(true)
          .addChoices(
            { name: "Activées", value: "on" },
            { name: "Coupées", value: "off" },
            { name: "Silence pendant 8 h", value: "mute8h" },
          ),
      ),
  )
  .addSubcommand((sub) => sub.setName("statut").setDescription("Votre statut sur la Toile"));

const EVENTS = [
  "MISSION_AVAILABLE",
  "CLAIM_ACCEPTED",
  "CLAIM_REJECTED",
  "CLAIM_INFO_REQUESTED",
  "MISSION_UPDATED",
  "MISSION_STATUS_CHANGED",
  "MISSION_DEADLINE_SOON",
  "MISSION_EXPIRED",
  "MISSION_CANCELLED",
] as const;

export async function handleToileCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  const flags = MessageFlags.Ephemeral;
  const appUrl = process.env.APP_URL ?? "";

  const account = await prisma.discordAccount.findUnique({
    where: { discordId: interaction.user.id },
    include: { user: true },
  });

  if (sub === "statut") {
    if (!account) {
      await interaction.reply({
        content: "🕸️ La Toile ne vous connaît pas. L'accès se fait uniquement sur invitation.",
        flags,
      });
      return;
    }
    const statusText: Record<string, string> = {
      ACTIVE: "✅ Fil actif — vous êtes admis sur la Toile.",
      PENDING: "⏳ En attente du regard d'un tisseur.",
      SUSPENDED: "🪢 Fil suspendu — contactez un modérateur.",
      REVOKED: "✂️ Fil coupé.",
    };
    await interaction.reply({
      content: `${statusText[account.user.status] ?? account.user.status}\n→ ${appUrl}`,
      flags,
    });
    return;
  }

  // Les autres commandes exigent un compte actif
  if (!account || account.user.status !== "ACTIVE") {
    await interaction.reply({
      content: "🕸️ Accès réservé aux membres actifs de la Toile.",
      flags,
    });
    return;
  }

  if (sub === "missions") {
    const missions = await prisma.mission.findMany({
      where: { status: { in: ["AVAILABLE", "CLAIM_PENDING"] } },
      orderBy: { publishedAt: "desc" },
      take: 10,
      select: { code: true, rank: true, publicTitle: true, rewardRyoMin: true, rewardRyoMax: true },
    });
    const lines = missions.map(
      (m) =>
        `**[${m.rank}] ${m.code}** — ${m.publicTitle} · ${m.rewardRyoMin.toLocaleString("fr-FR")}–${m.rewardRyoMax.toLocaleString("fr-FR")} ryōs`,
    );
    await interaction.reply({
      content:
        missions.length > 0
          ? `🕸️ **Fils à saisir :**\n${lines.join("\n")}\n→ ${appUrl}/missions`
          : "La Toile est calme. Aucun contrat disponible.",
      flags,
    });
    return;
  }

  if (sub === "mission") {
    const code = interaction.options.getString("code", true).toUpperCase().trim();
    const mission = await prisma.mission.findUnique({
      where: { code },
      select: {
        code: true,
        rank: true,
        status: true,
        publicTitle: true,
        publicSummary: true,
        rewardRyoMin: true,
        rewardRyoMax: true,
        groupSizeMin: true,
        groupSizeMax: true,
        expiresAt: true,
        visibility: true,
      },
    });
    if (!mission || ["DRAFT", "ARCHIVED"].includes(mission.status)) {
      await interaction.reply({ content: "Aucun contrat ne porte ce code.", flags });
      return;
    }
    const summary =
      mission.visibility?.showSummary !== false && mission.publicSummary
        ? `\n${mission.publicSummary}`
        : "";
    await interaction.reply({
      content:
        `**[${mission.rank}] ${mission.code}** — ${mission.publicTitle}${summary}\n` +
        `Récompense : ${mission.rewardRyoMin.toLocaleString("fr-FR")}–${mission.rewardRyoMax.toLocaleString("fr-FR")} ryōs · ` +
        `Effectif : ${mission.groupSizeMin}-${mission.groupSizeMax}\n` +
        `Le dossier complet (s'il vous est ouvert) : ${appUrl}/missions`,
      flags,
    });
    return;
  }

  if (sub === "classement") {
    const scores = await prisma.missionScore.groupBy({
      by: ["groupId"],
      where: { groupId: { not: null } },
      _sum: { points: true },
    });
    const groupIds = scores.flatMap((score) => score.groupId ? [score.groupId] : []);
    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true, faction: { select: { name: true } } },
    });
    const rows = scores
      .map((score) => ({
        name: (() => {
          const group = groups.find((candidate) => candidate.id === score.groupId);
          return group ? `${group.name}${group.faction ? ` · ${group.faction.name}` : ""}` : "?";
        })(),
        points: score._sum.points ?? 0,
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 8);
    await interaction.reply({
      content:
        "🕸️ **Classement des groupes :**\n" +
        rows.map((row, i) => `${i + 1}. ${row.name} — **${row.points} pts**`).join("\n") +
        `\n→ ${appUrl}/classement`,
      flags,
    });
    return;
  }

  if (sub === "notifications") {
    const mode = interaction.options.getString("mode", true);
    if (mode === "mute8h") {
      const mutedUntil = new Date(Date.now() + 8 * 3600 * 1000);
      for (const event of EVENTS) {
        await prisma.notificationPreference.upsert({
          where: { userId_event: { userId: account.userId, event } },
          update: { mutedUntil },
          create: { userId: account.userId, event, mutedUntil },
        });
      }
      await interaction.reply({ content: "🔕 La Toile se taira pendant 8 heures.", flags });
    } else {
      const enabled = mode === "on";
      for (const event of EVENTS) {
        await prisma.notificationPreference.upsert({
          where: { userId_event: { userId: account.userId, event } },
          update: { enabled, mutedUntil: null },
          create: { userId: account.userId, event, enabled },
        });
      }
      await interaction.reply({
        content: enabled
          ? "🔔 Les fils vibreront de nouveau jusqu'à vous."
          : "🔕 Plus aucun message privé ne vous parviendra.",
        flags,
      });
    }
  }
}
