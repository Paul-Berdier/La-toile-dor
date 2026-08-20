import { describe, expect, it } from "vitest";
import {
  CLAIMABLE_MISSION_STATUSES,
  canActiveLeaderClaim,
  isClaimableMissionStatus,
} from "./mission-claim-policy";

describe("politique de revendication d'une mission", () => {
  it.each(CLAIMABLE_MISSION_STATUSES)(
    "autorise un chef actif pour le statut %s sans dépendre d'un rôle global",
    (status) => {
      expect(canActiveLeaderClaim(status, true)).toBe(true);
    },
  );

  it("refuse toujours un utilisateur qui ne dirige aucun groupe actif", () => {
    expect(canActiveLeaderClaim("AVAILABLE", false)).toBe(false);
  });

  it.each(["DRAFT", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "ARCHIVED"])(
    "refuse le statut non revendicable %s",
    (status) => {
      expect(isClaimableMissionStatus(status)).toBe(false);
      expect(canActiveLeaderClaim(status, true)).toBe(false);
    },
  );
});
