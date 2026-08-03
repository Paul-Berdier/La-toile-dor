/**
 * La Toile d'Or — bot Discord (service Railway séparé).
 * Rôles : messages privés (file NotificationDelivery), commandes /toile,
 * synchronisation des rôles, expiration automatique des missions.
 */
import { Client, Events, GatewayIntentBits } from "discord.js";
import { prisma } from "@toile/database";
import { handleToileCommand } from "./commands.js";
import { startDispatcher } from "./dispatcher.js";
import { startExpirationSweep, startRoleSync } from "./sync.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN manquant — arrêt.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[toile-bot] connecté en tant que ${readyClient.user.tag}`);
  startDispatcher(client);
  startRoleSync(client);
  startExpirationSweep();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "toile") return;
  try {
    await handleToileCommand(interaction);
  } catch (error) {
    console.error("[toile-bot] erreur de commande :", error);
    await prisma.auditLog
      .create({
        data: { action: "bot.command_error", reason: String(error).slice(0, 500) },
      })
      .catch(() => {});
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction
        .reply({ content: "La Toile tremble — réessayez plus tard.", ephemeral: true })
        .catch(() => {});
    }
  }
});

process.on("SIGTERM", async () => {
  console.log("[toile-bot] arrêt demandé");
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
});

void client.login(token);
