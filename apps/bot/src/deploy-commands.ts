/**
 * Enregistre les commandes /toile sur le serveur Discord du RP (une fois par
 * déploiement). JAMAIS bloquant : les MP sont la mission première du bot —
 * un échec ici est signalé puis ignoré pour laisser le bot démarrer.
 * (Cause classique du 50001 Missing Access : application invitée sans le
 * scope applications.commands, ou DISCORD_GUILD_ID d'un autre serveur.)
 */
import { REST, Routes } from "discord.js";
import { toileCommand } from "./commands.js";

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error(
    "Commandes /toile non enregistrées : DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID et DISCORD_GUILD_ID sont requis. Le bot démarre sans elles.",
  );
  process.exit(0);
}

const rest = new REST().setToken(token);

try {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [toileCommand.toJSON()],
  });
  console.log("Commandes /toile enregistrées sur le serveur.");
} catch (error) {
  console.error(
    "Échec de l'enregistrement des commandes /toile — le bot démarre sans elles. " +
      "Vérifiez que l'application est invitée sur ce serveur avec le scope applications.commands :",
    error,
  );
  process.exit(0);
}
