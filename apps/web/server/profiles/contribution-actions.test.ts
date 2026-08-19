import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requestMeta: vi.fn(),
  getProfileViewer: vi.fn(),
  decideAccess: vi.fn(),
  decideAccessForGroup: vi.fn(),
  findContribution: vi.fn(),
  findProfile: vi.fn(),
  findMission: vi.fn(),
  findGrants: vi.fn(),
  findMembers: vi.fn(),
  audit: vi.fn(),
  enqueueNotifications: vi.fn(),
  userIdsWithPermission: vi.fn(),
  revalidatePath: vi.fn(),
  applyContributionValue: vi.fn(),
  assertContributionOptions: vi.fn(),
  claimPendingContribution: vi.fn(),
  lockContributionProfile: vi.fn(),
  runContributionTransaction: vi.fn(),
  createContribution: vi.fn(),
  contributionConflicts: vi.fn(),
  describeContributionValue: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: {
    profileIntelContribution: { findUnique: mocks.findContribution },
    profileAccessGrant: { findMany: mocks.findGrants },
    characterProfile: { findUnique: mocks.findProfile },
    mission: { findUnique: mocks.findMission },
    groupMember: { findMany: mocks.findMembers },
  },
}));
vi.mock("@toile/auth", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/notifications", () => ({
  enqueueNotifications: mocks.enqueueNotifications,
  userIdsWithPermission: mocks.userIdsWithPermission,
}));
vi.mock("./access", () => ({
  accessTargetSelect: {},
  getProfileViewer: mocks.getProfileViewer,
  decideAccess: mocks.decideAccess,
  decideAccessForGroup: mocks.decideAccessForGroup,
  toAccessTarget: (profile: unknown) => profile,
}));
vi.mock("./contributions", () => ({
  applyContributionValue: mocks.applyContributionValue,
  assertContributionOptions: mocks.assertContributionOptions,
  contributionConflicts: mocks.contributionConflicts,
  describeContributionValue: mocks.describeContributionValue,
  isContributableField: (fieldKey: string) => fieldKey === "details",
}));
vi.mock("./contribution-transactions", () => ({
  claimPendingContribution: mocks.claimPendingContribution,
  isRetryableContributionTransactionError: () => false,
  lockContributionProfile: mocks.lockContributionProfile,
  runContributionTransaction: mocks.runContributionTransaction,
}));

import { reviewIntelContributionAction, submitIntelContributionAction } from "./contribution-actions";

const contributionId = "clx1234567890abcdefghijkl";
const profileId = "clxprofile1234567890abcd";
const missionId = "clxmission1234567890abcd";
const groupA = "clxgroupa1234567890abcde";
const groupB = "clxgroupb1234567890abcde";
const transaction = {
  marker: "tx",
  profileIntelContribution: { create: mocks.createContribution },
};

function contributionFixture(proposedValue: unknown) {
  return {
    id: contributionId,
    profileId: "profile-1",
    fieldKey: "details",
    proposedValue,
    proposedLabel: String(proposedValue),
    knowledgeState: "KNOWN",
    confidence: null,
    sourceMissionId: null,
    contributorId: "reviewer-1",
    status: "PENDING_REVIEW",
    profile: {
      id: "profile-1",
      code: "PRF-000001",
      version: 7,
      archivedAt: null,
      createdByGroupId: null,
      accessGrants: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId: "reviewer-1", user: { displayName: "Reviewer" } },
    permissions: new Set(),
  });
  mocks.requestMeta.mockResolvedValue({});
  mocks.getProfileViewer.mockResolvedValue({});
  mocks.decideAccess.mockReturnValue({ canEdit: true });
  mocks.decideAccessForGroup.mockReturnValue({ canEdit: true, canContribute: true });
  mocks.findGrants.mockResolvedValue([]);
  mocks.findProfile.mockResolvedValue({ createdByGroupId: null });
  mocks.findMembers.mockResolvedValue([]);
  mocks.claimPendingContribution.mockResolvedValue(true);
  mocks.lockContributionProfile.mockResolvedValue({
    id: "profile-1",
    version: 7,
    archivedAt: null,
    mergedIntoId: null,
  });
  mocks.runContributionTransaction.mockImplementation(
    async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
  );
  mocks.createContribution.mockResolvedValue({ id: contributionId });
  mocks.contributionConflicts.mockResolvedValue(false);
  mocks.describeContributionValue.mockResolvedValue("Renseignement proposé");
  mocks.userIdsWithPermission.mockResolvedValue([]);
});

describe("provenance mission d'une contribution", () => {
  const input = {
    profileId,
    fieldKey: "details",
    knowledgeState: "KNOWN",
    value: "Renseignement proposé",
    groupId: groupA,
    sourceMissionId: missionId,
  };

  beforeEach(() => {
    mocks.findProfile.mockResolvedValue({
      id: profileId,
      code: "PRF-000001",
      characterFirstName: "Cible",
      archivedAt: null,
      createdByGroupId: null,
      accessGrants: [],
    });
    mocks.getProfileViewer.mockResolvedValue({ groupIds: [groupA, groupB] });
    mocks.decideAccess.mockReturnValue({ canContribute: true, canAdminister: false });
    mocks.decideAccessForGroup.mockReturnValue({ canContribute: true, canEdit: false });
  });

  it("refuse une mission attribuée au groupe lorsqu'elle ne vise pas le dossier", async () => {
    mocks.findMission.mockResolvedValue({
      assignedGroupId: groupA,
      assignments: [{ groupId: groupA }],
      targets: [],
    });

    await expect(submitIntelContributionAction(input)).resolves.toEqual({
      ok: false,
      error: "Mission source inconnue ou sans rapport avec vous.",
    });

    expect(mocks.findMission).toHaveBeenCalledWith({
      where: { id: missionId },
      select: expect.objectContaining({
        targets: {
          where: { profileId },
          take: 1,
          select: { id: true },
        },
      }),
    });
    expect(mocks.createContribution).not.toHaveBeenCalled();
  });

  it("n'utilise pas assignedGroupId quand une attribution active existe", async () => {
    mocks.findMission.mockResolvedValue({
      assignedGroupId: groupA,
      assignments: [{ groupId: groupB }],
      targets: [{ id: "target-1" }],
    });

    await expect(submitIntelContributionAction(input)).resolves.toEqual({
      ok: false,
      error: "Mission source inconnue ou sans rapport avec vous.",
    });
    expect(mocks.createContribution).not.toHaveBeenCalled();
  });

  it("accepte le groupe legacy seulement sans attribution active, pour un dossier cible", async () => {
    mocks.findMission.mockResolvedValue({
      assignedGroupId: groupA,
      assignments: [],
      targets: [{ id: "target-1" }],
    });

    await expect(submitIntelContributionAction(input)).resolves.toEqual({
      ok: true,
      status: "PENDING_REVIEW",
      contributionId,
    });
    expect(mocks.createContribution).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId,
        groupId: groupA,
        sourceMissionId: missionId,
        sourceType: "MISSION",
      }),
      select: { id: true },
    });
  });
});

describe("revue d'une contribution stockée", () => {
  it("refuse une ancienne valeur JSON qui ne satisfait plus le schéma du champ", async () => {
    mocks.findContribution.mockResolvedValue(contributionFixture("   "));

    await expect(
      reviewIntelContributionAction({ contributionId, decision: "ACCEPT" }),
    ).resolves.toEqual({
      ok: false,
      error: "La valeur enregistrée n'est plus valide pour ce champ.",
    });

    expect(mocks.assertContributionOptions).not.toHaveBeenCalled();
    expect(mocks.claimPendingContribution).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ contributionId, profileId: "profile-1" }),
    );
    expect(mocks.applyContributionValue).not.toHaveBeenCalled();
  });

  it("renettoie la valeur au moment de l'accepter puis claim le bon dossier", async () => {
    mocks.findContribution.mockResolvedValue(contributionFixture("  Nouveau renseignement  "));

    await expect(
      reviewIntelContributionAction({ contributionId, decision: "ACCEPT" }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.assertContributionOptions).toHaveBeenCalledWith(
      transaction,
      "details",
      "Nouveau renseignement",
    );
    expect(mocks.claimPendingContribution).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        contributionId,
        profileId: "profile-1",
        status: "ACCEPTED",
        reviewerId: "reviewer-1",
      }),
    );
    expect(mocks.applyContributionValue).toHaveBeenCalledWith(
      transaction,
      "profile-1",
      "details",
      "Nouveau renseignement",
      "REPLACE",
      expect.objectContaining({ actorId: "reviewer-1" }),
    );
  });

  it("n'applique pas une décision si la version du dossier a changé avant le verrou", async () => {
    mocks.findContribution.mockResolvedValue(contributionFixture("Valeur valide"));
    mocks.lockContributionProfile.mockResolvedValue({
      id: "profile-1",
      version: 8,
      archivedAt: null,
      mergedIntoId: null,
    });

    await expect(
      reviewIntelContributionAction({ contributionId, decision: "ACCEPT" }),
    ).resolves.toEqual({
      ok: false,
      error: "Le dossier a changé depuis l'ouverture de la revue ; rechargez-le avant de trancher.",
    });

    expect(mocks.claimPendingContribution).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ contributionId, profileId: "profile-1" }),
    );
    expect(mocks.applyContributionValue).not.toHaveBeenCalled();
  });
});
