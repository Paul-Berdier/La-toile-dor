import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Jeton aléatoire cryptographiquement sûr (256 bits, base64url). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Identifiant court non sensible (filigrane, références visibles). */
export function generateShortId(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/** Hash SHA-256 hex d'un jeton de session (sans pepper : jeton à 256 bits d'entropie). */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Hash SHA-256 hex d'un jeton d'invitation, poivré par INVITE_TOKEN_PEPPER. */
export function hashInviteToken(token: string, pepper = process.env.INVITE_TOKEN_PEPPER): string {
  if (!pepper) {
    throw new Error("INVITE_TOKEN_PEPPER manquant dans les variables d'environnement");
  }
  return createHash("sha256").update(`${token}${pepper}`).digest("hex");
}

/** Comparaison en temps constant de deux hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** IP tronquée pour l'audit : IPv4 → /24, IPv6 → /48. Jamais l'adresse complète. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 3).join(":") + "::/48";
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

/** User-agent réduit à la famille navigateur/OS — pas d'empreinte complète. */
export function reduceUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser =
    ua.match(/(Firefox|Edg|Chrome|Safari|OPR)\/[\d.]+/)?.[1] ?? "Autre";
  const os = ua.match(/\((Windows|Macintosh|Linux|Android|iPhone|iPad)[^)]*\)/)?.[1] ?? "";
  return [browser, os].filter(Boolean).join(" / ");
}
