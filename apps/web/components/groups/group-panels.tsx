"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateGroupAction,
  setGroupFactionAction,
  uploadGroupImageAction,
  promoteToLeaderAction,
} from "@/server/group-actions";
import { GroupFields, type GroupFieldsValues } from "@/components/onboarding/group-form";
import { Button } from "@/components/ui/button";

// ── Édition de la fiche ──

export function GroupEditSection({
  groupId,
  initial,
}: {
  groupId: string;
  initial: GroupFieldsValues;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<GroupFieldsValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await updateGroupAction({ groupId, values });
      if (!res.ok) {
        setError(res.error ?? "Échec de l'enregistrement.");
        setSaved(false);
      } else {
        setError(null);
        setSaved(true);
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { setOpen(true); setSaved(false); }}>
          Modifier la fiche du groupe
        </Button>
        {saved && <p role="status" className="text-xs text-success">Fiche enregistrée.</p>}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4 border border-border-gold bg-elevated p-4"
      noValidate
    >
      <GroupFields values={values} onChange={setValues} />
      {error && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Annuler
        </Button>
        <Button type="submit" variant="gold" size="sm" disabled={isPending || values.name.trim().length < 2}>
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

export function GroupFactionSelect({
  groupId,
  factionId,
  factions,
}: {
  groupId: string;
  factionId: string | null;
  factions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(factionId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-56 text-xs uppercase tracking-wider text-ink-faint">
        Faction du groupe (facultatif)
        <select
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-1 block w-full border border-border-default bg-elevated px-3 py-2 text-sm normal-case tracking-normal text-ink"
        >
          <option value="">Sans faction</option>
          {factions.map((faction) => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
        </select>
      </label>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending || value === (factionId ?? "")}
        onClick={() => startTransition(async () => {
          const result = await setGroupFactionAction({ groupId, factionId: value || null });
          setMessage(result.ok ? "Rattachement enregistré." : result.error ?? "Échec.");
          if (result.ok) router.refresh();
        })}
      >
        Enregistrer le rattachement
      </Button>
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </div>
  );
}

// ── Image ──

export function GroupImageUpload({ groupId }: { groupId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    setError(null);
    if (!file) return setPreview(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Format refusé : PNG, JPG/JPEG ou WEBP uniquement.");
      setPreview(null);
      return;
    }
    if (file.size > 500 * 1024) {
      setError("Image trop lourde : 500 Ko maximum.");
      setPreview(null);
      return;
    }
    setPreview(URL.createObjectURL(file));
  };

  const submit = () => {
    const file = inputRef.current?.files?.[0];
    if (!file || isPending) return;
    const formData = new FormData();
    formData.set("groupId", groupId);
    formData.set("image", file);
    startTransition(async () => {
      const res = await uploadGroupImageAction(formData);
      if (!res.ok) setError(res.error ?? "Échec de l'envoi.");
      else {
        setError(null);
        setPreview(null);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor="grp-image" className="block text-xs uppercase tracking-wider text-ink-faint">
        Image du groupe (PNG, JPG, WEBP — 500 Ko max)
      </label>
      <input
        id="grp-image"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full text-xs text-ink-muted file:mr-3 file:border file:border-border-gold file:bg-raised file:px-3 file:py-1.5 file:text-xs file:text-gold"
      />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Aperçu de la nouvelle image" className="h-24 w-24 border border-border-gold object-cover" />
      )}
      {error && <p role="alert" className="text-xs text-blood-bright">{error}</p>}
      {preview && (
        <Button variant="outline" size="sm" onClick={submit} disabled={isPending}>
          {isPending ? "Envoi…" : "Enregistrer l'image"}
        </Button>
      )}
    </div>
  );
}

// ── Promotion d'un agent ──

export function PromoteButton({
  groupId,
  userId,
  displayName,
}: {
  groupId: string;
  userId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const promote = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await promoteToLeaderAction({ groupId, userId });
      if (!res.ok) setError(res.error ?? "Échec de la promotion.");
      else {
        setError(null);
        setConfirming(false);
        router.refresh();
      }
    });
  };

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Promouvoir en chef de groupe
      </Button>
    );
  }

  return (
    <div className="border border-border-gold bg-elevated p-3">
      <p className="text-xs leading-relaxed text-ink-muted">
        Vous êtes sur le point de promouvoir <strong className="text-ink">{displayName}</strong> en
        chef de groupe.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        Cette personne pourra modifier le groupe, consulter les informations internes et gérer
        certaines actions réservées aux chefs.
      </p>
      {error && <p role="alert" className="mt-2 text-xs text-blood-bright">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="gold" size="sm" onClick={promote} disabled={isPending}>
          {isPending ? "Promotion…" : "Confirmer la promotion"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={isPending}>
          Renoncer
        </Button>
      </div>
    </div>
  );
}
