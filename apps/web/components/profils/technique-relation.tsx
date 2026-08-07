"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeRefLabel } from "@toile/shared";
import {
  addTechniqueAction,
  deleteTechniqueAction,
  addRelationAction,
  deleteRelationAction,
  uploadProfileImageAction,
} from "@/server/profiles/profile-actions";
import { Button } from "@/components/ui/button";

const input = "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

// ── Techniques propres ──

export function TechniqueManager({
  profileId,
  jutsuTypes,
  knownTechniques = [],
  techniques,
}: {
  profileId: string;
  jutsuTypes: { id: string; label: string }[];
  /** Subjutsu répertoriés (Rasengan, Multi clonage…), proposés à la saisie */
  knownTechniques?: { label: string; jutsuTypeId: string | null }[];
  techniques: { id: string; name: string; typeLabel: string | null; rank: string | null }[];
}) {
  const router = useRouter();
  const catalogId = useId();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [typeId, setTypeId] = useState("");
  const [rank, setRank] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Choisir une entrée du catalogue préremplit le type — sans jamais écraser
  // un type déjà renseigné : la saisie reste libre.
  const onNameChange = (value: string) => {
    setName(value);
    const match = knownTechniques.find(
      (k) => normalizeRefLabel(k.label) === normalizeRefLabel(value),
    );
    if (match?.jutsuTypeId && !typeId) setTypeId(match.jutsuTypeId);
  };

  const add = () => {
    if (isPending || !name.trim()) return;
    startTransition(async () => {
      const res = await addTechniqueAction({
        profileId,
        name,
        shortDescription: desc || undefined,
        jutsuTypeId: typeId || null,
        rank: rank || null,
      });
      if (!res.ok) setError(res.error ?? "Échec.");
      else { setName(""); setDesc(""); setTypeId(""); setRank(""); setError(null); router.refresh(); }
    });
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {techniques.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 border border-border-default bg-elevated px-3 py-1.5 text-sm">
            <span className="text-ink">
              {t.name}
              {t.rank && <span className="ml-2 font-mono-toile text-xs text-gold">rang {t.rank}</span>}
              {t.typeLabel && <span className="ml-2 text-xs text-ink-faint">{t.typeLabel}</span>}
            </span>
            <button type="button" aria-label={`Retirer ${t.name}`} className="text-ink-faint hover:text-blood-bright"
              onClick={() => startTransition(async () => { await deleteTechniqueAction(t.id); router.refresh(); })}>✕</button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="Nom de la technique *" aria-label="Nom de la technique" className={input} maxLength={120} list={knownTechniques.length > 0 ? catalogId : undefined} />
        {knownTechniques.length > 0 && (
          <datalist id={catalogId}>
            {knownTechniques.map((k) => <option key={k.label} value={k.label} />)}
          </datalist>
        )}
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Type de jutsu" className={input}>
          <option value="">Type — inconnu</option>
          {jutsuTypes.map((jt) => <option key={jt.id} value={jt.id}>{jt.label}</option>)}
        </select>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description courte" aria-label="Description" className={input} maxLength={1000} />
        <select value={rank} onChange={(e) => setRank(e.target.value)} aria-label="Rang" className={input}>
          <option value="">Rang — inconnu</option>
          {["D", "C", "B", "A", "S", "SS"].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      <Button size="sm" variant="outline" onClick={add} disabled={isPending || !name.trim()}>Ajouter la technique</Button>
    </div>
  );
}

// ── Relations ──

const REL_TYPES = [
  ["PARENT_OF", "est parent de"],
  ["CHILD_OF", "est enfant de"],
  ["CREATOR_OF", "est créateur de"],
  ["CREATION_OF", "est création de"],
  ["SIBLING_OF", "est frère / sœur de"],
] as const;

export function RelationManager({
  profileId,
  relations,
}: {
  profileId: string;
  relations: { relationId: string; groupLabel: string; relatedName: string; relatedCode: string }[];
}) {
  const router = useRouter();
  const [uiType, setUiType] = useState("PARENT_OF");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; code: string; firstName: string }[]>([]);
  const [relatedId, setRelatedId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const doSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 2) return setResults([]);
    const res = await fetch(`/api/profils/recherche?q=${encodeURIComponent(q)}&exclude=${profileId}`);
    if (res.ok) setResults(await res.json());
  };

  const add = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await addRelationAction({
        profileId,
        uiType,
        relatedProfileId: relatedId || undefined,
        newRelatedFirstName: !relatedId && newName ? newName : undefined,
      });
      if (!res.ok) setError(res.error ?? "Échec.");
      else { setRelatedId(""); setNewName(""); setSearch(""); setResults([]); setError(null); router.refresh(); }
    });
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        {relations.map((rel) => (
          <li key={rel.relationId} className="flex items-center justify-between gap-2 border border-border-default bg-elevated px-3 py-1.5 text-sm">
            <span className="text-ink-muted">
              <span className="text-[0.7rem] uppercase tracking-wider text-ink-faint">{rel.groupLabel}</span>
              {" — "}{rel.relatedName}
              <span className="ml-1 font-mono-toile text-[0.65rem] text-ink-faint">{rel.relatedCode}</span>
            </span>
            <button type="button" aria-label="Supprimer la relation" className="text-ink-faint hover:text-blood-bright"
              onClick={() => startTransition(async () => { await deleteRelationAction(rel.relationId); router.refresh(); })}>✕</button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 border border-border-default bg-elevated p-3">
        <select value={uiType} onChange={(e) => setUiType(e.target.value)} aria-label="Type de relation" className={input}>
          {REL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={search} onChange={(e) => doSearch(e.target.value)} placeholder="Rechercher un profil (prénom, code)…" aria-label="Rechercher un profil" className={input} />
        {results.length > 0 && (
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setRelatedId(r.id); setSearch(`${r.firstName} (${r.code})`); setResults([]); }}
                  className={`w-full px-2 py-1 text-left hover:bg-hover-bg ${relatedId === r.id ? "text-gold" : "text-ink-muted"}`}>
                  {r.firstName} — {r.code}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-center text-[0.65rem] text-ink-faint">— ou créer un profil minimal —</p>
        <input value={newName} onChange={(e) => { setNewName(e.target.value); setRelatedId(""); }} placeholder="Prénom du personnage lié" aria-label="Prénom du profil lié" className={input} maxLength={80} />
        {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
        <Button size="sm" variant="outline" onClick={add} disabled={isPending || (!relatedId && !newName.trim())}>
          Ajouter la relation
        </Button>
      </div>
    </div>
  );
}

// ── Portrait ──

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** Format portrait 3:4 : l'image est recadrée et optimisée avant l'envoi. */
const PORTRAIT_WIDTH = 480;
const PORTRAIT_HEIGHT = 640;

export function ProfileImageUpload({ profileId }: { profileId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ url: string; width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(50); // cadrage, en pourcentage
  const [offsetY, setOffsetY] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    setError(null);
    setSource(null);
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Format refusé : PNG, JPG ou WEBP.");
      return;
    }
    // Le recadrage ré-encode l'image : la source peut dépasser 500 Ko,
    // seul le résultat est soumis à la limite de stockage.
    if (file.size > 12 * 1024 * 1024) {
      setError("Fichier trop volumineux (12 Mo maximum).");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setSource({ url, width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffsetX(50);
      setOffsetY(50);
    };
    image.onerror = () => setError("Image illisible.");
    image.src = url;
  };

  /** Génère le portrait recadré, sous la limite de 500 Ko. */
  const buildCropped = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      if (!source) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = PORTRAIT_WIDTH;
      canvas.height = PORTRAIT_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return resolve(null);

      const image = new Image();
      image.onload = () => {
        // Échelle « couvrante » : le cadre est toujours entièrement rempli
        const cover = Math.max(PORTRAIT_WIDTH / source.width, PORTRAIT_HEIGHT / source.height);
        const scale = cover * zoom;
        const drawWidth = source.width * scale;
        const drawHeight = source.height * scale;
        const dx = (PORTRAIT_WIDTH - drawWidth) * (offsetX / 100);
        const dy = (PORTRAIT_HEIGHT - drawHeight) * (offsetY / 100);
        context.fillStyle = "#0b0a08";
        context.fillRect(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
        context.drawImage(image, dx, dy, drawWidth, drawHeight);
        // Qualité dégressive jusqu'à passer sous la limite
        const tryQuality = (quality: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(null);
              if (blob.size <= 500 * 1024 || quality <= 0.5) return resolve(blob);
              tryQuality(quality - 0.1);
            },
            "image/jpeg",
            quality,
          );
        };
        tryQuality(0.9);
      };
      image.onerror = () => resolve(null);
      image.src = source.url;
    });

  const submit = () => {
    if (!source || isPending) return;
    startTransition(async () => {
      const blob = await buildCropped();
      if (!blob) {
        setError("Le recadrage a échoué.");
        return;
      }
      const fd = new FormData();
      fd.set("profileId", profileId);
      fd.set("image", new File([blob], "portrait.jpg", { type: "image/jpeg" }));
      const res = await uploadProfileImageAction(fd);
      if (!res.ok) setError(res.error ?? "Échec.");
      else {
        setSource(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <label htmlFor="prf-portrait" className={label}>
        Portrait — PNG, JPG ou WEBP (recadré au format portrait)
      </label>
      <input
        id="prf-portrait"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full text-xs text-ink-muted file:mr-3 file:border file:border-border-gold file:bg-raised file:px-3 file:py-1.5 file:text-xs file:text-gold"
      />

      {source && (
        <div className="space-y-2">
          {/* Aperçu exact du cadrage retenu */}
          <div
            className="relative overflow-hidden border border-border-gold bg-obsidian"
            style={{ width: 120, height: 160 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={source.url}
              alt="Aperçu du recadrage"
              className="absolute h-full w-full object-cover"
              style={{
                objectPosition: `${offsetX}% ${offsetY}%`,
                transform: `scale(${zoom})`,
                transformOrigin: `${offsetX}% ${offsetY}%`,
              }}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[0.7rem] text-ink-faint">
              Zoom
              <input type="range" min={1} max={3} step={0.05} value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="mt-1 block w-full accent-[var(--toile-gold)]" />
            </label>
            <label className="text-[0.7rem] text-ink-faint">
              Horizontal
              <input type="range" min={0} max={100} value={offsetX}
                onChange={(e) => setOffsetX(Number(e.target.value))}
                className="mt-1 block w-full accent-[var(--toile-gold)]" />
            </label>
            <label className="text-[0.7rem] text-ink-faint">
              Vertical
              <input type="range" min={0} max={100} value={offsetY}
                onChange={(e) => setOffsetY(Number(e.target.value))}
                className="mt-1 block w-full accent-[var(--toile-gold)]" />
            </label>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      {source && (
        <Button size="sm" variant="outline" onClick={submit} disabled={isPending}>
          {isPending ? "Envoi…" : "Enregistrer le portrait"}
        </Button>
      )}
    </div>
  );
}
