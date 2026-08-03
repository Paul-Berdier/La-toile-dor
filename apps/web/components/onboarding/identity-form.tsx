"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeIdentityAction } from "@/server/onboarding-actions";
import { Button } from "@/components/ui/button";

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

export function IdentityForm({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (isPending) return; // prévention des doubles soumissions
    startTransition(async () => {
      const res = await completeIdentityAction({
        firstName,
        lastName,
        displayName,
        privacyAcknowledged,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setGlobalError(res.fieldErrors ? null : res.error ?? "Échec de l'enregistrement.");
      } else {
        setErrors({});
        setGlobalError(null);
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
        <label htmlFor="ob-firstname" className={label}>
          Prénom *
        </label>
        <input
          id="ob-firstname"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
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
        <label htmlFor="ob-lastname" className={label}>
          Nom de famille — facultatif, votre personnage peut ne pas en posséder.
        </label>
        <input
          id="ob-lastname"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
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

      <div>
        <label htmlFor="ob-displayname" className={label}>
          Pseudonyme public *
        </label>
        <input
          id="ob-displayname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="ex. Araignée Rouge"
          className={input}
        />
        {fieldError("displayName") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("displayName")}
          </p>
        )}
      </div>

      {/* Encart de confidentialité */}
      <aside className="border border-gold-dim bg-gold-faint/20 p-4">
        <h2 className="font-display text-xs tracking-[0.2em] text-gold uppercase">
          Identité confidentielle
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Votre pseudonyme sera visible par l&rsquo;ensemble des membres autorisés de La
          Toile d&rsquo;Or.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Votre prénom et votre nom resteront confidentiels. Ils seront uniquement
          visibles par les modérateurs, les super-modérateurs et les membres de votre
          propre groupe.
        </p>
      </aside>

      <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-muted">
        <input
          type="checkbox"
          checked={privacyAcknowledged}
          onChange={(e) => setPrivacyAcknowledged(e.target.checked)}
          className="mt-0.5 accent-[var(--toile-gold)]"
          required
        />
        J&rsquo;ai compris quelles informations seront publiques et quelles informations
        resteront confidentielles.
      </label>
      {fieldError("privacyAcknowledged") && (
        <p role="alert" className="text-xs text-blood-bright">
          {fieldError("privacyAcknowledged")}
        </p>
      )}
      {globalError && (
        <p role="alert" className="border border-blood bg-blood/10 px-3 py-2 text-xs text-blood-bright">
          {globalError}
        </p>
      )}

      <Button
        type="submit"
        variant="gold"
        size="lg"
        className="w-full"
        disabled={isPending || !privacyAcknowledged || !firstName.trim() || !displayName.trim()}
      >
        {isPending ? "Le fil se noue…" : "Sceller mon identité"}
      </Button>
    </form>
  );
}
