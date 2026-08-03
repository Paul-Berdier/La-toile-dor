/**
 * Client OAuth2 Discord minimal — pas de dépendance externe.
 * Scopes : identify (+ guilds.members.read pour la vérification de rôles).
 * Aucun token OAuth n'est persisté : après l'échange, seules les données de
 * profil publiques (id, username, avatar) sont conservées.
 */

const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("DISCORD_CLIENT_ID"),
    redirect_uri: `${requireEnv("APP_URL")}/api/auth/callback`,
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<{ accessToken: string }> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("DISCORD_CLIENT_ID"),
      client_secret: requireEnv("DISCORD_CLIENT_SECRET"),
      grant_type: "authorization_code",
      code,
      redirect_uri: `${requireEnv("APP_URL")}/api/auth/callback`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Échange OAuth Discord refusé (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string };
  return { accessToken: data.access_token };
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Lecture du profil Discord impossible (${res.status})`);
  return (await res.json()) as DiscordUser;
}

/**
 * Rôles de l'utilisateur dans le serveur Discord du RP, via son access token.
 * Retourne null si l'utilisateur n'est pas membre du serveur.
 */
export async function fetchGuildMemberRoles(accessToken: string): Promise<string[] | null> {
  const guildId = requireEnv("DISCORD_GUILD_ID");
  const res = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Vérification d'appartenance au serveur impossible (${res.status})`);
  const data = (await res.json()) as { roles: string[] };
  return data.roles;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}
