/**
 * Galerie d'images d'un dossier de renseignement — contrat partagé entre le
 * serveur (validation, actions) et l'interface (libellés, limites).
 *
 * RÈGLE : une image d'un dossier que le lecteur ne voit pas n'existe pas pour
 * lui. Ni URL, ni vignette, ni nombre d'images — seulement un état « présent
 * mais confidentiel » quand la Toile en détient au moins une.
 */

export const PROFILE_IMAGE_TYPES = ["PORTRAIT", "APPEARANCE", "EVIDENCE", "OTHER"] as const;
export type ProfileImageType = (typeof PROFILE_IMAGE_TYPES)[number];

export const PROFILE_IMAGE_TYPE_LABELS: Record<ProfileImageType, string> = {
  PORTRAIT: "Portrait",
  APPEARANCE: "Apparence",
  EVIDENCE: "Preuve",
  OTHER: "Autre",
};

/** Taille maximale d'une image de dossier, en octets (alignée sur les rapports). */
export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Nombre maximal d'images VIVANTES par dossier. */
export const PROFILE_IMAGES_MAX = 12;
/** Extensions acceptées côté client ; le serveur revérifie par signature. */
export const PROFILE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

/** Ce que le serveur envoie au client pour une image VISIBLE. */
export interface ProfileImageView {
  id: string;
  type: ProfileImageType;
  typeLabel: string;
  caption: string | null;
  isPrimary: boolean;
  sortOrder: number;
  sizeBytes: number;
  createdAt: string;
  /** Mission d'où provient l'image, si elle a été jointe à un rapport */
  sourceMissionCode: string | null;
}

/**
 * Galerie telle qu'elle sort du sérialiseur. La forme dit tout : quand le
 * lecteur n'a pas accès, il n'y a PAS de tableau d'images — impossible d'en
 * compter ou d'en deviner une seule.
 */
export type ProfileGalleryView =
  | { state: "VISIBLE"; images: ProfileImageView[] }
  | { state: "REDACTED" } // la Toile détient des images, ce lecteur non
  | { state: "EMPTY" }; // aucune image connue

export function isAllowedImageExtension(fileName: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(fileName);
}
