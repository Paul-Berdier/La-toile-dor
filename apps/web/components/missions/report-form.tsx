"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { REPORT_IMAGES_MAX, REPORT_IMAGE_MAX_BYTES } from "@toile/shared";
import { submitReportAction } from "@/server/mission-actions";
import { Button } from "@/components/ui/button";

interface PendingImage {
  file: File;
  previewUrl: string;
}

export function ReportForm({ missionId }: { missionId: string }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const isFinal = false;
  const [images, setImages] = useState<PendingImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImages = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setError(null);
    setImages((current) => {
      const next = [...current];
      for (const file of incoming) {
        if (next.length >= REPORT_IMAGES_MAX) {
          setError(`${REPORT_IMAGES_MAX} images maximum par rapport.`);
          break;
        }
        if (file.size > REPORT_IMAGE_MAX_BYTES) {
          setError(`Image « ${file.name} » trop lourde : 2 Mo maximum.`);
          continue;
        }
        next.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return next;
    });
    // Permet de resélectionner le même fichier après retrait
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  };

  const submit = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("missionId", missionId);
      formData.set("content", content);
      formData.set("isFinal", isFinal ? "true" : "false");
      for (const image of images) formData.append("images", image.file);

      const res = await submitReportAction(formData);
      if (!res.ok) {
        setError(res.error ?? "Échec de l'envoi.");
      } else {
        setError(null);
        setContent("");
        images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
        setImages([]);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor="report-content" className="block text-xs text-ink-faint uppercase tracking-wider">
        Rapport d&rsquo;étape
      </label>
      <textarea
        id="report-content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
        maxLength={20000}
        placeholder="Ce qui a été vu, fait, et ce qu'il en coûte…"
        className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
      />

      {/* Preuves visuelles facultatives */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => addImages(e.target.files)}
      />
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li key={image.previewUrl} className="relative border border-border-default bg-elevated p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt={`Preuve ${index + 1} — ${image.file.name}`}
                className="h-20 w-20 object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                aria-label={`Retirer ${image.file.name}`}
                className="absolute -right-2 -top-2 h-5 w-5 border border-blood bg-base text-[0.6rem] leading-none text-blood-bright hover:bg-blood/20"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={images.length >= REPORT_IMAGES_MAX}
          className="border border-border-default px-2 py-1 text-xs text-ink-muted hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Joindre des images
        </button>
        <span className="text-[0.65rem] text-ink-faint">
          {images.length}/{REPORT_IMAGES_MAX} — PNG, JPG ou WEBP, 2 Mo max
        </span>
      </div>

      {/* Le rapport FINAL passe par le parcours en trois étapes (résultat,
          renseignements, validation) : ici, seulement un point d'étape. */}
      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}
      <Button variant="outline" onClick={submit} disabled={isPending || content.trim().length < 10}>
        {isPending ? "Transmission…" : "Transmettre le point d'étape"}
      </Button>
    </div>
  );
}
