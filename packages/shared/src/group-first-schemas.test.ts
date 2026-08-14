import { describe, expect, it } from "vitest";
import { invitationCreateSchema, scoreAdjustSchema } from "./schemas";

describe("modèle groupe d'abord", () => {
  it("accepte les nouveaux rôles de groupe et refuse les anciens rôles de faction", () => {
    const base = {
      expiresInHours: 72,
      playerLevelId: "cm12345678901234567890123",
    };
    expect(invitationCreateSchema.safeParse({ ...base, roleSlug: "group_leader" }).success).toBe(true);
    expect(invitationCreateSchema.safeParse({ ...base, roleSlug: "faction_leader" }).success).toBe(false);
  });

  it("permet un score de groupe sans faction", () => {
    expect(scoreAdjustSchema.safeParse({
      groupId: "cm12345678901234567890123",
      points: 10,
      reason: "MANUAL_ADJUSTMENT",
      justification: "Bonus de test",
    }).success).toBe(true);
  });

  it("refuse un score sans groupe", () => {
    expect(scoreAdjustSchema.safeParse({
      points: 10,
      reason: "MANUAL_ADJUSTMENT",
      justification: "Bonus de test",
    }).success).toBe(false);
  });
});
