import { prisma } from "@toile/database";
import type { Prisma } from "@toile/database";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipHash?: string | null;
  userAgent?: string | null;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  reason?: string;
}

/**
 * Journal d'audit. Ne JAMAIS y écrire de donnée confidentielle de mission
 * (identité de cible, localisation…) ni de secret — uniquement des références.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        ipHash: entry.ipHash ?? null,
        userAgent: entry.userAgent ?? null,
        oldValues: entry.oldValues,
        newValues: entry.newValues,
        reason: entry.reason ?? null,
      },
    });
  } catch (error) {
    // L'audit ne doit jamais faire échouer l'action métier ; on trace en stderr.
    console.error("[audit] écriture impossible :", error);
  }
}
