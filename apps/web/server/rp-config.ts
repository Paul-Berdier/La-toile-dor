import "server-only";
import { cache } from "react";
import { prisma } from "@toile/database";
import { DEFAULT_RP_TIME_CONFIG, type RpTimeConfig } from "@toile/shared";

/**
 * Configuration du temps RP depuis AppSetting("rp_time"), fusionnée avec les
 * valeurs par défaut (1 jour réel = 1 mois RP, année RP de 7 mois pour que
 * 1 semaine réelle = 1 année RP). Mise en cache par requête.
 */
export const getRpTimeConfig = cache(async (): Promise<RpTimeConfig> => {
  const setting = await prisma.appSetting.findUnique({ where: { key: "rp_time" } });
  const stored = (setting?.value ?? {}) as Partial<RpTimeConfig>;
  return { ...DEFAULT_RP_TIME_CONFIG, ...stored };
});
