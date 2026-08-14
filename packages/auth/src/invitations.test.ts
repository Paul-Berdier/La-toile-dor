import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@toile/shared";
import {
  consumeInvitation,
  getInvitationAuthorityFailure,
  type InvitationAuthorityContext,
} from "./invitations";

const databaseMocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock("@toile/database", () => ({
  prisma: { invitation: { updateMany: databaseMocks.updateMany } },
}));

beforeEach(() => {
  databaseMocks.updateMany.mockReset();
});

function context(
  overrides: Partial<InvitationAuthorityContext> = {},
): InvitationAuthorityContext {
  return {
    creatorStatus: "ACTIVE",
    creatorRoleSlugs: ["moderator"],
    creatorPermissions: [PERMISSIONS.INVITE_CREATE, PERMISSIONS.GROUP_CREATE],
    targetRoleSlug: "group_leader",
    groupOnboardingMode: "CREATE_NEW_GROUP",
    groupId: null,
    factionId: null,
    playerLevelId: "level-genin",
    playerLevelExists: true,
    lowestPlayerLevelId: "level-genin",
    group: null,
    factionIsActive: null,
    ...overrides,
  };
}

describe("autorité lors de la consommation d'une invitation", () => {
  it("autorise encore un modérateur actif à inviter un chef fondateur", () => {
    expect(getInvitationAuthorityFailure(context())).toBeNull();
  });

  it("refuse un créateur qui n'est plus actif", () => {
    expect(
      getInvitationAuthorityFailure(context({ creatorStatus: "SUSPENDED" })),
    ).toBe("creator_inactive");
  });

  it("refuse les anciens fils actifs dépourvus de grade", () => {
    expect(
      getInvitationAuthorityFailure(
        context({ playerLevelId: null, playerLevelExists: false }),
      ),
    ).toBe("missing_player_level");
  });

  it("refuse un chef qui ne dirige plus le groupe ciblé", () => {
    expect(
      getInvitationAuthorityFailure(
        context({
          creatorRoleSlugs: ["group_leader"],
          creatorPermissions: [PERMISSIONS.INVITE_CREATE],
          targetRoleSlug: "group_member",
          groupOnboardingMode: "NONE",
          groupId: "group-1",
          group: { isActive: true, factionId: null, creatorIsLeader: false },
        }),
      ),
    ).toBe("group_unauthorized");
  });

  it("refuse après rétrogradation un ancien fil qui attribuait un grade supérieur", () => {
    expect(
      getInvitationAuthorityFailure(
        context({
          creatorRoleSlugs: ["group_leader"],
          creatorPermissions: [PERMISSIONS.INVITE_CREATE],
          targetRoleSlug: "group_member",
          groupOnboardingMode: "NONE",
          groupId: "group-1",
          playerLevelId: "level-jonin",
          group: { isActive: true, factionId: null, creatorIsLeader: true },
        }),
      ),
    ).toBe("creator_unauthorized");
  });

  it("autorise un chef à inviter un agent au grade initial dans son groupe actif", () => {
    expect(
      getInvitationAuthorityFailure(
        context({
          creatorRoleSlugs: ["group_leader"],
          creatorPermissions: [PERMISSIONS.INVITE_CREATE],
          targetRoleSlug: "group_member",
          groupOnboardingMode: "NONE",
          groupId: "group-1",
          factionId: "faction-1",
          group: {
            isActive: true,
            factionId: "faction-1",
            creatorIsLeader: true,
          },
        }),
      ),
    ).toBeNull();
  });

  it("refuse une fondation si la permission group.create a été retirée", () => {
    expect(
      getInvitationAuthorityFailure(
        context({ creatorPermissions: [PERMISSIONS.INVITE_CREATE] }),
      ),
    ).toBe("creator_unauthorized");
  });

  it("refuse une invitation vers un groupe devenu inactif", () => {
    expect(
      getInvitationAuthorityFailure(
        context({
          targetRoleSlug: "group_leader",
          groupOnboardingMode: "EXISTING_GROUP",
          groupId: "group-1",
          group: { isActive: false, factionId: null, creatorIsLeader: false },
        }),
      ),
    ).toBe("group_inactive");
  });
});

describe("consommation atomique", () => {
  it("inclut l'expiration dans le prédicat qui marque le fil comme utilisé", async () => {
    databaseMocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(consumeInvitation("invite-1", "user-1")).resolves.toBe(true);

    expect(databaseMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "invite-1",
        status: "ACTIVE",
        usedById: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: "USED",
        usedById: "user-1",
        usedAt: expect.any(Date),
      },
    });
  });
});
