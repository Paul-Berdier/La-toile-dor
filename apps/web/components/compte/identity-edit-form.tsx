"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IDENTITY_VISIBILITIES,
  IDENTITY_VISIBILITY_LABELS,
  IDENTITY_VISIBILITY_HINTS,
  type IdentityVisibility,
} from "@toile/shared";
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
    identityVisibility: IdentityVisibility;
  };
  levels: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [playerLevelId, setPlayerLevelId] = useState(initial.playerLevelId);
  const [identityVisibility, setIdentityVisibility] = useState<IdentityVisibility>(
    initial.identityVisibility,
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    displayName !== initial.displayName ||
    playerLevelId !== initial.playerLevelId ||
    identityVisibility !== initial.identityVisibility;

  const submit = () => {
    if (isPending) return;
    startTransition(async () => {
      const res = await updateOwnIdentityAction({
        firstName,
        lastName,
        displayName,
        playerLevelId,
        identityVisibility,
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

      {/* Portée du prénom et du nom : le choix appartient à l'intéressé. */}
      <fieldset className="border border-gold-dim bg-gold-faint/10 p-4">
        <legend className="px-1 font-display text-xs tracking-[0.2em] text-gold uppercase">
          Qui peut voir votre nom
        </legend>
        <p className="mb-2 text-xs text-ink-muted">
          Votre Titre et votre grade restent visibles par tous. Vous décidez en revanche
          qui accède à votre prénom et à votre nom.
        </p>
        <div className="space-y-1.5">
          {IDENTITY_VISIBILITIES.map((scope) => (
            <label
              key={scope}
              className={`flex cursor-pointer items-start gap-2 border p-2 transition-colors ${
                identityVisibility === scope
                  ? "border-gold bg-gold-faint/30"
                  : "border-border-default hover:border-border-gold"
              }`}
            >
              <input
                type="radio"
                name="identity-visibility"
                value={scope}
                checked={identityVisibility === scope}
                onChange={() => { setIdentityVisibility(scope); setSaved(false); }}
                className="mt-0.5 accent-[var(--toile-gold)]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-ink">
                  {IDENTITY_VISIBILITY_LABELS[scope]}
                </span>
                <span className="block text-[0.7rem] leading-relaxed text-ink-faint">
                  {IDENTITY_VISIBILITY_HINTS[scope]}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-[0.65rem] leading-relaxed text-ink-faint">
          Quel que soit votre choix, les modérateurs et super-modérateurs y ont accès :
          ils en ont besoin pour arbitrer les litiges et vérifier les dossiers.
        </p>
      </fieldset>

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
