"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOwnIdentityAction } from "@/server/account-actions";
import { Button } from "@/components/ui/button";

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * Édition par le membre de sa propre identité. Mêmes champs que la première
 * connexion : chacun reste maître de son Titre, de son grade et de son nom.
 */
export function IdentityEditForm({
  initial,
  levels,
}: {
  initial: {
    firstName: string;
    lastName: string;
    displayName: string;
    playerLevelId: string;
  };
  levels: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [playerLevelId, setPlayerLevelId] = useState(initial.playerLevelId);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    displayName !== initial.displayName ||
    playerLevelId !== initial.playerLevelId;

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await updateOwnIdentityAction({
        firstName,
        lastName,
        displayName,
        playerLevelId,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setGlobalError(res.fieldErrors ? null : res.error ?? "Échec de l'enregistrement.");
        setSaved(false);
      } else {
        setErrors({});
        setGlobalError(null);
        setSaved(true);
        router.refresh();
      }
    });
  };

  const fieldError = (key: string) => errors[key]?.[0] ?? null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
      noValidate
    >
      <div>
        <label htmlFor="ac-displayname" className={label}>
          Votre Titre *
        </label>
        <p className="mb-1.5 text-xs leading-relaxed text-ink-muted">
          Ce n&rsquo;est <strong className="text-gold">pas</strong> votre pseudo Discord :
          c&rsquo;est le nom sous lequel la Toile vous connaît —{" "}
          <em>« L&rsquo;assassin de l&rsquo;ombre »</em>.
        </p>
        <input
          id="ac-displayname"
          value={displayName}
          onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }}
          maxLength={60}
          required
          autoComplete="off"
          className={input}
        />
        {fieldError("displayName") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("displayName")}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ac-level" className={label}>
          Grade de votre personnage *
        </label>
        <select
          id="ac-level"
          value={playerLevelId}
          onChange={(e) => { setPlayerLevelId(e.target.value); setSaved(false); }}
          required
          className={input}
        >
          <option value="">— choisir votre grade —</option>
          {levels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.label}
            </option>
          ))}
        </select>
        {fieldError("playerLevelId") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("playerLevelId")}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ac-firstname" className={label}>
            Prénom du personnage *
          </label>
          <input
            id="ac-firstname"
            value={firstName}
            onChange={(e) => { setFirstName(e.target.value); setSaved(false); }}
            maxLength={60}
            required
            autoComplete="off"
            className={input}
          />
          {fieldError("firstName") && (
            <p role="alert" className="mt-1 text-xs text-blood-bright">
              {fieldError("firstName")}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ac-lastname" className={label}>
            Nom de famille — facultatif
          </label>
          <input
            id="ac-lastname"
            value={lastName}
            onChange={(e) => { setLastName(e.target.value); setSaved(false); }}
            maxLength={60}
            autoComplete="off"
            className={input}
          />
          {fieldError("lastName") && (
            <p role="alert" className="mt-1 text-xs text-blood-bright">
              {fieldError("lastName")}
            </p>
          )}
        </div>
      </div>

      {globalError && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {globalError}
        </p>
      )}
      {saved && !dirty && (
        <p role="status" className="text-xs text-success">
          Identité mise à jour.
        </p>
      )}

      <Button type="submit" variant="gold" disabled={isPending || !dirty}>
        {isPending ? "Enregistrement…" : "Enregistrer mes informations"}
      </Button>
    </form>
  );
}
