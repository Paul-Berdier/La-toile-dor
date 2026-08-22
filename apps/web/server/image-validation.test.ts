import { beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { sanitizePortraitImage } from "./image-validation";

describe("sécurisation des portraits", () => {
  let jpegWithMetadata: Buffer;
  const marker = "GPS-ET-APPAREIL-A-RETIRER";

  beforeAll(async () => {
    jpegWithMetadata = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 180, g: 120, b: 40 },
      },
    })
      .withExif({ IFD0: { ImageDescription: marker, Copyright: marker } })
      .jpeg()
      .toBuffer();
  });

  it("décode et réencode en WebP sans métadonnées EXIF", async () => {
    expect(jpegWithMetadata.includes(Buffer.from(marker))).toBe(true);

    const sanitized = await sanitizePortraitImage(jpegWithMetadata);
    const metadata = await sharp(sanitized.bytes).metadata();

    expect(sanitized.mime).toBe("image/webp");
    expect(sanitized.bytes.includes(Buffer.from(marker))).toBe(false);
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBeLessThanOrEqual(1024);
    expect(metadata.height).toBeLessThanOrEqual(1024);
  });

  it("refuse un simple préfixe PNG forgé ou tronqué", async () => {
    const forged = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
    ]);

    await expect(sanitizePortraitImage(forged)).rejects.toThrow("INVALID_IMAGE");
  });

  it("refuse une bombe de dimensions avant décodage complet", async () => {
    const oversizedPixels = await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .jpeg({ quality: 5 })
      .toBuffer();

    await expect(sanitizePortraitImage(oversizedPixels)).rejects.toThrow("INVALID_IMAGE");
  });
});
