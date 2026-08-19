"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DISPLAY_ARIA_LABELS,
  PROFILE_IMAGE_ACCEPT,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_TYPE_LABELS,
  PROFILE_IMAGE_TYPES,
  PROFILE_IMAGES_MAX,
  isAllowedImageExtension,
  type ProfileGalleryView,
  type ProfileImageType,
  type ProfileImageView,
} from "@toile/shared";
import {
  deleteProfileImageAction,
  setPrimaryProfileImageAction,
  uploadProfileGalleryImageAction,
} from "@/server/profiles/image-actions";
import { Button } from "@/components/ui/button";

/**
 * Galerie d'un dossier — lecture.
 *
 * Trois états, trois rendus qui ne se ressemblent pas :
 *  - VISIBLE : les vignettes, servies par la route gardée ;
 *  - REDACTED : un cadre « IMAGE CONFIDENTIELLE » — la Toile a des images, le
 *    lecteur ne les voit pas. Aucune URL n'est présente dans la page ;
 *  - EMPTY : rien — une ligne discrète.
 */
export function ProfileGallery({
  profileId,
  gallery,
  tone = "dark",
}: {
  profileId: string;
  gallery: ProfileGalleryView;
  tone?: "dark" | "parchment";
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const parchment = tone === "parchment";

  if (gallery.state === "EMPTY") {
    return (
      <p className={`text-xs italic ${parchment ? "text-parchment-text/50" : "text-ink-faint"}`}>
        Aucune image connue.
      </p>
    );
  }
  if (gallery.state === "REDACTED") {
    return (
      <div
        role="img"
        aria-label={DISPLAY_ARIA_LABELS.REDACTED}
        title="La Toile détient des images de ce ninja — confidentielles sans accès au dossier"
        className="flex h-28 flex-col items-center justify-center gap-1 border border-gold-dim bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(184,150,62,0.10)_6px,rgba(184,150,62,0.10)_12px)]"
      >
        <span aria-hidden className="font-mono-toile text-lg tracking-[0.2em] text-gold">???</span>
        <span aria-hidden className="font-mono-toile text-[0.6rem] uppercase tracking-[0.3em] text-gold-dim">
          封 Images confidentielles
        </span>
      </div>
    );
  }

  const open = gallery.images.find((img) => img.id === openId) ?? null;
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Galerie du dossier">
        {gallery.images.map((img) => (
          <li key={img.id}>
            <button
              type="button"
              onClick={() => setOpenId(img.id)}
              className={`group relative block aspect-[3/4] w-full overflow-hidden border ${
                img.isPrimary ? "border-gold" : parchment ? "border-parchment-deep" : "border-border-default"
              } focus:outline-none focus-visible:ring-2 focus-visible:ring-gold`}
              aria-label={`Agrandir : ${img.caption ?? img.typeLabel}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/profils/${profileId}/images/${img.id}`}
                alt={img.caption ?? `${img.typeLabel} — dossier`}
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <span className="absolute left-1 top-1 border border-obsidian/40 bg-obsidian/70 px-1 font-mono-toile text-[0.55rem] uppercase tracking-wider text-gold">
                {img.isPrimary ? "Portrait" : img.typeLabel}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={open.caption ?? open.typeLabel}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-obsidian/90 p-4"
          onClick={() => setOpenId(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpenId(null); }}
        >
          <figure className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/profils/${profileId}/images/${open.id}`}
              alt={open.caption ?? open.typeLabel}
              className="max-h-[80vh] w-auto border border-border-gold object-contain"
            />
            <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>
                <span className="font-mono-toile uppercase tracking-wider text-gold">{open.typeLabel}</span>
                {open.caption && <span className="ml-2">{open.caption}</span>}
                {open.sourceMissionCode && (
                  <span className="ml-2 text-ink-faint">— mission {open.sourceMissionCode}</span>
                )}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setOpenId(null)} autoFocus>
                Fermer
              </Button>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}

/**
 * Galerie — édition. Glisser-déposer ou sélection, aperçu avant envoi, type,
 * légende, choix du portrait principal, suppression. Les contrôles client
 * (extension, taille) n'existent que pour prévenir : le serveur refait tout.
 */
export function ProfileGalleryEditor({
  profileId,
  images,
  sourceMissionId,
}: {
  profileId: string;
  images: ProfileImageView[];
  sourceMissionId?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [type, setType] = useState<ProfileImageType>(images.length === 0 ? "PORTRAIT" : "APPEARANCE");
  const [caption, setCaption] = useState("");
  const [primary, setPrimary] = useState(images.length === 0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!isAllowedImageExtension(file.name)) {
      setError("Format refusé : PNG, JPG/JPEG ou WEBP uniquement.");
      return;
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      setError("Image trop lourde : 2 Mo maximum.");
      return;
    }
    if (pending) URL.revokeObjectURL(pending.url);
    setPending({ file, url: URL.createObjectURL(file) });
  };

  const upload = () => {
    if (!pending || isPending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("profileId", profileId);
      fd.set("image", pending.file);
      fd.set("type", type);
      fd.set("caption", caption);
      fd.set("primary", primary ? "true" : "false");
      if (sourceMissionId) fd.set("sourceMissionId", sourceMissionId);
      const res = await uploadProfileGalleryImageAction(fd);
      if (!res.ok) {
        setError(res.error ?? "L'envoi a échoué.");
        return;
      }
      URL.revokeObjectURL(pending.url);
      setPending(null);
      setCaption("");
      setPrimary(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  };

  const makePrimary = (imageId: string) =>
    startTransition(async () => {
      const res = await setPrimaryProfileImageAction({ profileId, imageId });
      if (!res.ok) setError(res.error ?? "Échec.");
      else router.refresh();
    });

  const remove = (imageId: string) => {
    if (!window.confirm("Retirer cette image du dossier ?")) return;
    startTransition(async () => {
      const res = await deleteProfileImageAction({ profileId, imageId });
      if (!res.ok) setError(res.error ?? "Échec.");
      else router.refresh();
    });
  };

  const full = images.length >= PROFILE_IMAGES_MAX;

  return (
    <div className="space-y-4">
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => (
            <li key={img.id} className="space-y-1">
              <div className={`relative aspect-[3/4] overflow-hidden border ${img.isPrimary ? "border-gold" : "border-border-default"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/profils/${profileId}/images/${img.id}`}
                  alt={img.caption ?? img.typeLabel}
                  className="h-full w-full object-cover"
                />
                {img.isPrimary && (
                  <span className="absolute left-1 top-1 bg-obsidian/80 px-1 font-mono-toile text-[0.55rem] uppercase tracking-wider text-gold">
                    Portrait principal
                  </span>
                )}
              </div>
              <p className="truncate text-[0.65rem] text-ink-faint" title={img.caption ?? undefined}>
                {img.typeLabel}{img.caption ? ` — ${img.caption}` : ""}
              </p>
              <div className="flex gap-1">
                {!img.isPrimary && (
                  <button
                    type="button"
                    onClick={() => makePrimary(img.id)}
                    disabled={isPending}
                    className="border border-border-default px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-ink-muted hover:border-gold hover:text-gold"
                  >
                    Portrait
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(img.id)}
                  disabled={isPending}
                  className="border border-border-default px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-ink-muted hover:border-blood hover:text-blood-bright"
                >
                  Retirer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-xs text-ink-faint">{PROFILE_IMAGES_MAX} images : le dossier est plein.</p>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
          className={`border border-dashed p-4 text-center transition-colors ${
            dragging ? "border-gold bg-gold-faint/20" : "border-border-strong bg-elevated"
          }`}
        >
          <label htmlFor="gal-file" className="block cursor-pointer text-xs text-ink-muted">
            Glissez une image ici, ou <span className="text-gold underline">choisissez un fichier</span>
            <span className="mt-1 block text-[0.65rem] text-ink-faint">PNG, JPG ou WEBP · 2 Mo max</span>
          </label>
          <input
            id="gal-file"
            ref={inputRef}
            type="file"
            accept={PROFILE_IMAGE_ACCEPT}
            onChange={(e) => pick(e.target.files?.[0])}
            className="sr-only"
          />
        </div>
      )}

      {pending && (
        <div className="grid gap-3 border border-border-gold bg-raised p-3 sm:grid-cols-[6rem_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.url} alt="Aperçu avant envoi" className="aspect-[3/4] w-24 border border-border-default object-cover" />
          <div className="space-y-2">
            <label className="block text-[0.7rem] uppercase tracking-wider text-ink-faint">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ProfileImageType)}
                className="mt-1 block w-full border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink"
              >
                {PROFILE_IMAGE_TYPES.map((t) => (
                  <option key={t} value={t}>{PROFILE_IMAGE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="block text-[0.7rem] uppercase tracking-wider text-ink-faint">
              Légende (facultative)
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={200}
                className="mt-1 block w-full border border-border-default bg-elevated px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
              Définir comme portrait principal
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="gold" onClick={upload} disabled={isPending}>
                {isPending ? "Envoi…" : "Ajouter à la galerie"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { URL.revokeObjectURL(pending.url); setPending(null); if (inputRef.current) inputRef.current.value = ""; }}
                disabled={isPending}
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
    </div>
  );
}
