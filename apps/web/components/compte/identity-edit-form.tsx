"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IDENTITY_VISIBILITIES,
  IDENTITY_VISIBILITY_LABELS,
  IDENTITY_VISIBILITY_HINTS,
  MISSION_CATEGORIES,
  type IdentityVisibility,
} from "@toile/shared";
import {
  removeOwnPortraitAction,
  updateOwnIdentityAction,
  uploadOwnPortraitAction,
} from "@/server/account-actions";
import { Button } from "@/components/ui/button";

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * Édition par le membre de sa propre identité. Le grade reste affiché mais
 * n'est modifiable que par la modération, car il conditionne les missions.
 */
export function IdentityEditForm({
  initial,
  userId,
}: {
  userId: string;
  initial: {
    firstName: string;
    lastName: string;
    displayName: string;
    publicBio: string;
    specialties: string[];
    hasPortrait: boolean;
    playerLevelLabel: string;
    identityVisibility: IdentityVisibility;
  };
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [publicBio, setPublicBio] = useState(initial.publicBio);
  const [specialties, setSpecialties] = useState(initial.specialties);
  const [identityVisibility, setIdentityVisibility] = useState<IdentityVisibility>(
    initial.identityVisibility,
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const portraitInputRef = useRef<HTMLInputElement>(null);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  const [hasPortrait, setHasPortrait] = useState(initial.hasPortrait);
  const [portraitVersion, setPortraitVersion] = useState(0);
  const [portraitError, setPortraitError] = useState<string | null>(null);
  const [portraitMessage, setPortraitMessage] = useState<string | null>(null);
  const [confirmPortraitRemoval, setConfirmPortraitRemoval] = useState(false);
  const [portraitPending, startPortraitTransition] = useTransition();

  useEffect(
    () => () => {
      if (portraitPreview) URL.revokeObjectURL(portraitPreview);
    },
    [portraitPreview],
  );

  const dirty =
    firstName !== initial.firstName ||
    lastName !== initial.lastName ||
    displayName !== initial.displayName ||
    publicBio !== initial.publicBio ||
    specialties.length !== initial.specialties.length ||
    specialties.some((specialty) => !initial.specialties.includes(specialty)) ||
    identityVisibility !== initial.identityVisibility;

  const toggleSpecialty = (specialty: string) => {
    setSpecialties((current) =>
      current.includes(specialty)
        ? current.filter((value) => value !== specialty)
        : [...current, specialty],
    );
    setSaved(false);
  };

  const choosePortrait = (file: File | undefined) => {
    setPortraitError(null);
    setPortraitMessage(null);
    setConfirmPortraitRemoval(false);
    setPortraitFile(null);
    setPortraitPreview(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setPortraitError("Format refusé : PNG, JPG/JPEG ou WEBP uniquement.");
      if (portraitInputRef.current) portraitInputRef.current.value = "";
      return;
    }
    if (file.size > 500 * 1024) {
      setPortraitError("Portrait trop lourd : 500 Ko maximum.");
      if (portraitInputRef.current) portraitInputRef.current.value = "";
      return;
    }
    setPortraitFile(file);
    setPortraitPreview(URL.createObjectURL(file));
  };

  const uploadPortrait = () => {
    if (!portraitFile || portraitPending) return;
    const formData = new FormData();
    formData.set("portrait", portraitFile);
    startPortraitTransition(async () => {
      const res = await uploadOwnPortraitAction(formData);
      if (!res.ok) {
        setPortraitError(res.error ?? "Échec de l'envoi.");
        setPortraitMessage(null);
        return;
      }
      setPortraitError(null);
      setPortraitMessage("Portrait public enregistré.");
      setHasPortrait(true);
      setPortraitVersion(Date.now());
      setPortraitFile(null);
      setPortraitPreview(null);
      if (portraitInputRef.current) portraitInputRef.current.value = "";
      router.refresh();
    });
  };

  const removePortrait = () => {
    if (portraitPending) return;
    startPortraitTransition(async () => {
      const res = await removeOwnPortraitAction();
      if (!res.ok) {
        setPortraitError(res.error ?? "Échec de la suppression.");
        return;
      }
      setPortraitError(null);
      setPortraitMessage("Portrait supprimé.");
      setHasPortrait(false);
      setConfirmPortraitRemoval(false);
      setPortraitFile(null);
      setPortraitPreview(null);
      if (portraitInputRef.current) portraitInputRef.current.value = "";
      router.refresh();
    });
  };

  const submit = () => {
    if (isPending) return;
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    const normalizedDisplayName = displayName.trim().replace(/\s+/g, " ");
    const normalizedPublicBio = publicBio.trim();
    startTransition(async () => {
      const res = await updateOwnIdentityAction({
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        displayName: normalizedDisplayName,
        publicBio: normalizedPublicBio,
        specialties,
        identityVisibility,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setGlobalError(res.fieldErrors ? null : res.error ?? "Échec de l'enregistrement.");
        setSaved(false);
      } else {
        setFirstName(normalizedFirstName);
        setLastName(normalizedLastName);
        setDisplayName(normalizedDisplayName);
        setPublicBio(normalizedPublicBio);
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
      <section className="border border-border-default bg-elevated p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="h-32 w-32 shrink-0 overflow-hidden border border-border-gold bg-raised">
            {portraitPreview || hasPortrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  portraitPreview ??
                  `/api/membres/${encodeURIComponent(userId)}/portrait?v=${portraitVersion}`
                }
                alt={portraitPreview ? "Aperçu du nouveau portrait" : "Votre portrait public"}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-3 text-center font-display text-xs tracking-widest text-ink-faint uppercase">
                Aucun portrait
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <label htmlFor="ac-portrait" className={label}>
                Portrait public
              </label>
              <p className="mb-2 text-xs leading-relaxed text-ink-muted">
                Visible par tous les membres connectés. PNG, JPG ou WEBP, 500 Ko maximum.
              </p>
              <input
                id="ac-portrait"
                ref={portraitInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => choosePortrait(event.target.files?.[0])}
                disabled={portraitPending}
                className="block w-full text-xs text-ink-muted file:mr-3 file:border file:border-border-gold file:bg-raised file:px-3 file:py-1.5 file:text-xs file:text-gold"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {portraitFile && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={uploadPortrait}
                  disabled={portraitPending}
                >
                  {portraitPending ? "Envoi…" : "Enregistrer le portrait"}
                </Button>
              )}
              {hasPortrait && !confirmPortraitRemoval && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmPortraitRemoval(true)}
                  disabled={portraitPending}
                >
                  Supprimer le portrait
                </Button>
              )}
              {hasPortrait && confirmPortraitRemoval && (
                <>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={removePortrait}
                    disabled={portraitPending}
                  >
                    {portraitPending ? "Suppression…" : "Confirmer la suppression"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmPortraitRemoval(false)}
                    disabled={portraitPending}
                  >
                    Annuler
                  </Button>
                </>
              )}
            </div>
            {portraitError && (
              <p role="alert" className="text-xs text-blood-bright">
                {portraitError}
              </p>
            )}
            {portraitMessage && (
              <p role="status" className="text-xs text-success">
                {portraitMessage}
              </p>
            )}
          </div>
        </div>
      </section>

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
        <label htmlFor="ac-public-bio" className={label}>
          Biographie publique
        </label>
        <p className="mb-1.5 text-xs leading-relaxed text-ink-muted">
          Présentez brièvement votre personnage. Ce texte sera visible par tous les membres
          connectés ; n&rsquo;y inscrivez aucune information personnelle réelle.
        </p>
        <textarea
          id="ac-public-bio"
          value={publicBio}
          onChange={(event) => {
            setPublicBio(event.target.value);
            setSaved(false);
          }}
          rows={5}
          maxLength={1000}
          className={input}
          placeholder="Rôle, parcours, manière d'opérer…"
        />
        <div className="mt-1 flex items-start justify-between gap-3 text-[0.65rem]">
          <span className="text-blood-bright">{fieldError("publicBio")}</span>
          <span className="ml-auto text-ink-faint">{publicBio.length} / 1 000</span>
        </div>
      </div>

      <fieldset>
        <legend className={label}>Spécialités publiques</legend>
        <p className="mb-2 text-xs leading-relaxed text-ink-muted">
          Choisissez les domaines dans lesquels votre personnage est reconnu. Le référentiel
          est le même que celui des missions.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MISSION_CATEGORIES.map((category) => {
            const selected = specialties.includes(category.value);
            return (
              <button
                key={category.value}
                type="button"
                onClick={() => toggleSpecialty(category.value)}
                aria-pressed={selected}
                className={`border px-2 py-1 text-[0.7rem] transition-colors ${
                  selected
                    ? "border-gold bg-gold-faint/40 text-gold"
                    : "border-border-default text-ink-muted hover:border-border-gold hover:text-ink"
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
        {fieldError("specialties") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("specialties")}
          </p>
        )}
      </fieldset>

      <div>
        <span className={label}>Grade de votre personnage</span>
        <div className="border border-border-default bg-elevated px-3 py-2 text-sm text-ink-muted">
          {initial.playerLevelLabel}
        </div>
        <p className="mt-1 text-[0.65rem] text-ink-faint">
          Le grade intervient dans l&rsquo;éligibilité aux missions. Demandez sa modification à la modération.
        </p>
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
