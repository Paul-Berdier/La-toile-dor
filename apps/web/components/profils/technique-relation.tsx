"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  techniques,
}: {
  profileId: string;
  jutsuTypes: { id: string; label: string }[];
  techniques: { id: string; name: string; typeLabel: string | null; rank: string | null }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [typeId, setTypeId] = useState("");
  const [rank, setRank] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la technique *" aria-label="Nom de la technique" className={input} maxLength={120} />
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

export function ProfileImageUpload({ profileId }: { profileId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    setError(null);
    if (!file) return setPreview(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("Format refusé : PNG, JPG ou WEBP."); return; }
    if (file.size > 500 * 1024) { setError("Portrait trop lourd : 500 Ko maximum."); return; }
    setPreview(URL.createObjectURL(file));
  };

  const submit = () => {
    const file = inputRef.current?.files?.[0];
    if (!file || isPending) return;
    const fd = new FormData();
    fd.set("profileId", profileId);
    fd.set("image", file);
    startTransition(async () => {
      const res = await uploadProfileImageAction(fd);
      if (!res.ok) setError(res.error ?? "Échec.");
      else { setPreview(null); if (inputRef.current) inputRef.current.value = ""; router.refresh(); }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor="prf-portrait" className={label}>Portrait (PNG, JPG, WEBP — 500 Ko max)</label>
      <input id="prf-portrait" ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full text-xs text-ink-muted file:mr-3 file:border file:border-border-gold file:bg-raised file:px-3 file:py-1.5 file:text-xs file:text-gold" />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Aperçu du portrait" className="h-28 w-20 border border-border-gold object-cover" />
      )}
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      {preview && <Button size="sm" variant="outline" onClick={submit} disabled={isPending}>Enregistrer le portrait</Button>}
    </div>
  );
}
