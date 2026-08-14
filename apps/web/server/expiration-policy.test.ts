import { describe, expect, it } from "vitest";
import { isMissionEligibleForExpiration } from "./expiration-policy";

const now = new Date("2026-08-14T12:00:00.000Z");

describe("isMissionEligibleForExpiration", () => {
  it.each(["AVAILABLE", "CLAIM_PENDING", "ASSIGNED", "IN_PROGRESS"])(
    "expire une mission active au délai atteint (%s)",
    (status) => {
      expect(
        isMissionEligibleForExpiration(
          { status, expiresAt: new Date(now), timerSuspendedAt: null },
          now,
        ),
      ).toBe(true);
    },
  );

  it("n'expire pas une mission dont l'échéance est encore future", () => {
    expect(
      isMissionEligibleForExpiration(
        {
          status: "IN_PROGRESS",
          expiresAt: new Date(now.getTime() + 1),
          timerSuspendedAt: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("n'expire pas une mission sans délai ou dont le minuteur est suspendu", () => {
    expect(
      isMissionEligibleForExpiration(
        { status: "ASSIGNED", expiresAt: null, timerSuspendedAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isMissionEligibleForExpiration(
        {
          status: "ASSIGNED",
          expiresAt: new Date(now.getTime() - 1),
          timerSuspendedAt: new Date(now.getTime() - 10_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it.each(["DRAFT", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED", "ARCHIVED"])(
    "ne réécrit jamais un état terminal ou non publié (%s)",
    (status) => {
      expect(
        isMissionEligibleForExpiration(
          {
            status,
            expiresAt: new Date(now.getTime() - 1),
            timerSuspendedAt: null,
          },
          now,
        ),
      ).toBe(false);
    },
  );
});
