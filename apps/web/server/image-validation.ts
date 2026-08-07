import "server-only";

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
