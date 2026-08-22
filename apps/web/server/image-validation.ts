import "server-only";
import sharp from "sharp";

/**
 * Validation d'images par signature binaire — le type MIME déclaré par le
 * client ne suffit jamais. Formats acceptés partout : PNG, JPG/JPEG, WEBP.
 */
const IMAGE_SIGNATURES: { mime: string; check: (b: Buffer) => boolean }[] = [
  { mime: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/webp",
    check: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/** MIME réel détecté dans les octets, ou null si le format est refusé. */
export function sniffImageMime(bytes: Buffer): string | null {
  return IMAGE_SIGNATURES.find((s) => s.check(bytes))?.mime ?? null;
}

const PORTRAIT_MAX_DIMENSION = 1024;
const PORTRAIT_MAX_INPUT_PIXELS = 16 * 1024 * 1024;

/**
 * Décode puis réencode un portrait en WebP sûr.
 *
 * Cette étape est distincte du simple sniff MIME utilisé ailleurs : elle
 * refuse les préfixes forgés et images tronquées, borne les pixels décodés,
 * applique l'orientation EXIF, limite les dimensions et supprime toutes les
 * métadonnées (EXIF/GPS/XMP, miniature et profil embarqué) avant stockage.
 */
export async function sanitizePortraitImage(
  bytes: Buffer,
): Promise<{ bytes: Buffer; mime: "image/webp" }> {
  if (!sniffImageMime(bytes)) throw new Error("INVALID_IMAGE");

  try {
    const output = await sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: PORTRAIT_MAX_INPUT_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: PORTRAIT_MAX_DIMENSION,
        height: PORTRAIT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      // Sharp ne conserve aucune métadonnée sans appel explicite à
      // keepMetadata/withMetadata. Un format unique simplifie aussi la route.
      .webp({ quality: 86, effort: 4 })
      .toBuffer();

    if (output.length === 0) throw new Error("INVALID_IMAGE");
    return { bytes: output, mime: "image/webp" };
  } catch {
    throw new Error("INVALID_IMAGE");
  }
}

/**
 * Vrai si l'entrée FormData est un fichier. Duck-typing volontaire : le
 * global `File` n'existe qu'à partir de Node 20 et `instanceof` échoue
 * entre réalités (undici embarqué par Next vs globaux Node).
 */
export function isFileLike(value: FormDataEntryValue | null): value is File {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as File).arrayBuffer === "function"
  );
}
