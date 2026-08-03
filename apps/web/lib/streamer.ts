import "server-only";
import { cookies } from "next/headers";

export const STREAMER_COOKIE = "toile_streamer";

/** Mode Streamer côté serveur : les valeurs sensibles sont remplacées AVANT l'envoi au client. */
export async function isStreamerMode(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(STREAMER_COOKIE)?.value === "1";
}

/** Code stable non réversible pour remplacer une valeur sensible à l'écran. */
export function maskValue(prefix: string, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const code = Math.abs(hash % 0xffff).toString(16).toUpperCase().padStart(4, "0");
  return `${prefix}-${code}`;
}
