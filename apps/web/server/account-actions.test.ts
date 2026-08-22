import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requestMeta: vi.fn(),
  findFirst: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  findLevel: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  isFileLike: vi.fn(),
  sanitizePortraitImage: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@toile/database", () => ({
  prisma: {
    user: {
      findFirst: mocks.findFirst,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      update: mocks.update,
    },
    playerLevel: { findUnique: mocks.findLevel },
  },
}));
vi.mock("@toile/auth", () => ({ audit: mocks.audit, rateLimit: mocks.rateLimit }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  requestMeta: mocks.requestMeta,
}));
vi.mock("@/server/image-validation", () => ({
  isFileLike: mocks.isFileLike,
  sanitizePortraitImage: mocks.sanitizePortraitImage,
}));

import {
  removeOwnPortraitAction,
  updateOwnIdentityAction,
  uploadOwnPortraitAction,
} from "./account-actions";

const userId = "member-current";
const currentLevelId = "cm12345678901234567890123";
const nextLevelId = "cm22345678901234567890123";

function portraitForm(bytes: Buffer, declaredSize = bytes.length) {
  const file = {
    size: declaredSize,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
  return { formData: { get: () => file } as unknown as FormData, file };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    session: { userId, user: { displayName: "La Vipère" } },
    permissions: new Set(),
  });
  mocks.requestMeta.mockResolvedValue({ ipHash: null, userAgent: null });
  mocks.findFirst.mockResolvedValue(null);
  mocks.findUniqueOrThrow.mockResolvedValue({
    displayName: "La Vipère",
    identityVisibility: "MY_GROUPS",
    publicBio: null,
    specialties: [],
    playerLevelId: currentLevelId,
    playerLevel: { label: "Genin" },
    portraitData: null,
    portraitMime: null,
  });
  mocks.findLevel.mockResolvedValue({ id: currentLevelId, label: "Genin" });
  mocks.update.mockResolvedValue({ id: userId });
  mocks.rateLimit.mockReturnValue({ allowed: true, remaining: 11, retryAfterSeconds: 0 });
  mocks.isFileLike.mockReturnValue(true);
  mocks.sanitizePortraitImage.mockImplementation(async (bytes: Buffer) => ({
    bytes: Buffer.from([...bytes, 0x01]),
    mime: "image/webp",
  }));
});

describe("informations du compte courant", () => {
  it("enregistre la bio et les spécialités sans copier la bio dans l'audit", async () => {
    const secretMarker = "Bio publique non dupliquée dans l'audit";
    const result = await updateOwnIdentityAction({
      firstName: "Akira",
      lastName: "",
      displayName: "La Vipère",
      playerLevelId: currentLevelId,
      identityVisibility: "MY_GROUPS",
      publicBio: secretMarker,
      specialties: ["TRAQUE", "INFILTRATION"],
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: expect.objectContaining({
          publicBio: secretMarker,
          specialties: ["TRAQUE", "INFILTRATION"],
        }),
      }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(secretMarker);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        newValues: expect.objectContaining({
          hasPublicBio: true,
          publicBioLength: secretMarker.length,
          specialties: ["TRAQUE", "INFILTRATION"],
        }),
      }),
    );
  });

  it("permet de modifier directement son grade et journalise le changement", async () => {
    mocks.findLevel.mockResolvedValueOnce({ id: nextLevelId, label: "Chunin" });

    const result = await updateOwnIdentityAction({
      firstName: "Akira",
      lastName: "",
      displayName: "La Vipère",
      playerLevelId: nextLevelId,
      identityVisibility: "MY_GROUPS",
      publicBio: "",
      specialties: [],
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: expect.objectContaining({ playerLevelId: nextLevelId }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        action: "user.level_updated",
        oldValues: { playerLevelId: currentLevelId, label: "Genin" },
        newValues: { playerLevelId: nextLevelId, label: "Chunin" },
      }),
    );
  });

  it("refuse un identifiant de grade absent du référentiel", async () => {
    mocks.findLevel.mockResolvedValueOnce(null);

    const result = await updateOwnIdentityAction({
      firstName: "Akira",
      lastName: "",
      displayName: "La Vipère",
      playerLevelId: nextLevelId,
      identityVisibility: "MY_GROUPS",
    });

    expect(result).toEqual({
      ok: false,
      fieldErrors: { playerLevelId: ["Ce grade n'existe pas."] },
      error: "Ce grade n'existe pas.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("stocke uniquement sur le compte authentifié le portrait réencodé", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { formData, file } = portraitForm(bytes);

    const result = await uploadOwnPortraitAction(formData);

    expect(result).toEqual({ ok: true });
    expect(mocks.isFileLike).toHaveBeenCalledWith(file);
    expect(mocks.sanitizePortraitImage).toHaveBeenCalledWith(bytes);
    const sanitized = Buffer.from([...bytes, 0x01]);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        portraitData: Uint8Array.from(sanitized),
        portraitMime: "image/webp",
      },
    });
    const auditPayload = mocks.audit.mock.calls[0]?.[0];
    expect(auditPayload).toMatchObject({
      actorId: userId,
      action: "profile.portrait_changed",
      newValues: { present: true, mime: "image/webp", sizeBytes: sanitized.length },
    });
    expect(auditPayload?.newValues).not.toHaveProperty("portraitData");
  });

  it("refuse une fausse image et une charge supérieure à 500 Ko", async () => {
    mocks.sanitizePortraitImage.mockRejectedValueOnce(new Error("INVALID_IMAGE"));
    const forged = portraitForm(Buffer.from("pas une image"));
    await expect(uploadOwnPortraitAction(forged.formData)).resolves.toEqual({
      ok: false,
      error: "Format refusé : PNG, JPG/JPEG ou WEBP uniquement.",
    });

    const oversized = portraitForm(Buffer.from([1]), 500 * 1024 + 1);
    await expect(uploadOwnPortraitAction(oversized.formData)).resolves.toEqual({
      ok: false,
      error: "Portrait trop lourd : 500 Ko maximum.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("limite les décodages répétés d'un même compte", async () => {
    mocks.rateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 125,
    });
    const portrait = portraitForm(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(uploadOwnPortraitAction(portrait.formData)).resolves.toEqual({
      ok: false,
      error: "Trop de portraits envoyés. Réessayez dans 3 min.",
    });
    expect(mocks.sanitizePortraitImage).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("supprime les deux colonnes du portrait du seul compte authentifié", async () => {
    mocks.findUniqueOrThrow.mockResolvedValueOnce({
      portraitData: Buffer.from([1, 2, 3]),
      portraitMime: "image/webp",
    });

    const result = await removeOwnPortraitAction();

    expect(result).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { portraitData: null, portraitMime: null },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        action: "profile.portrait_removed",
      }),
    );
  });
});
