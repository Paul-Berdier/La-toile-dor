/** Enregistre les commandes /toile sur le serveur Discord du RP (une fois par déploiement). */
import { REST, Routes } from "discord.js";
import { toileCommand } from "./commands.js";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error("DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID et DISCORD_GUILD_ID sont requis.");
  process.exit(1);
}

const rest = new REST().setToken(token);

try {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [toileCommand.toJSON()],
  });
  console.log("Commandes /toile enregistrées sur le serveur.");
} catch (error) {
  console.error("Échec de l'enregistrement :", error);
  process.exit(1);
}
