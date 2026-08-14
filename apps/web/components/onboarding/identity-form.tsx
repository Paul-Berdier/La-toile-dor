"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeIdentityAction } from "@/server/onboarding-actions";
import { Button } from "@/components/ui/button";

const input =
  "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold";
const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

/**
 * Première connexion : le joueur déclare son identité.
 *
 * Deux points comptent plus que le reste :
 * - le pseudonyme demandé est un TITRE de jeu de rôle, pas le pseudo Discord.
 *   Le champ démarre donc VIDE, jamais pré-rempli avec le nom Discord, qui
 *   ferait croire qu'il suffit de le valider ;
 * - le grade fixé dans l'invitation est affiché sans pouvoir être élevé par le
 *   joueur. Le choix reste disponible uniquement pour les anciens comptes qui
 *   n'ont encore aucun grade.
 */
export function IdentityForm({
  levels,
  assignedLevel,
}: {
  levels: { id: string; label: string }[];
  assignedLevel: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [playerLevelId, setPlayerLevelId] = useState(assignedLevel?.id ?? "");
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
        playerLevelId,
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
      {/* Le Titre d'abord : c'est le point qui prête le plus à confusion */}
      <div>
        <label htmlFor="ob-displayname" className={label}>
          Votre Titre *
        </label>
        <p className="mb-1.5 text-xs leading-relaxed text-ink-muted">
          Ce n&rsquo;est <strong className="text-gold">pas</strong> votre pseudo Discord :
          c&rsquo;est le nom sous lequel la Toile vous connaît, celui qui circule dans
          les rumeurs — <em>« L&rsquo;assassin de l&rsquo;ombre »</em>,{" "}
          <em>« La Vipère de Kiri »</em>, <em>« Celui qui ne dort jamais »</em>.
        </p>
        <input
          id="ob-displayname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          required
          autoComplete="off"
          placeholder="ex. L'assassin de l'ombre"
          className={input}
        />
        {fieldError("displayName") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("displayName")}
          </p>
        )}
      </div>

      <div>
        {assignedLevel ? (
          <>
            <span className={label}>Grade de votre personnage</span>
            <div className="border border-border-default bg-elevated px-3 py-2 text-sm text-ink-muted">
              {assignedLevel.label}
            </div>
            <p className="mt-1 text-[0.65rem] text-ink-faint">
              Grade fixé dans votre invitation. Seule la modération peut le modifier.
            </p>
          </>
        ) : (
          <>
            <label htmlFor="ob-level" className={label}>
              Grade de votre personnage *
            </label>
            <p className="mb-1.5 text-xs text-ink-muted">
              Votre ancien compte n&rsquo;a aucun grade : choisissez-le une seule fois.
            </p>
            <select
              id="ob-level"
              value={playerLevelId}
              onChange={(e) => setPlayerLevelId(e.target.value)}
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
          </>
        )}
        {fieldError("playerLevelId") && (
          <p role="alert" className="mt-1 text-xs text-blood-bright">
            {fieldError("playerLevelId")}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ob-firstname" className={label}>
          Prénom du personnage *
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

      {/* Encart de confidentialité */}
      <aside className="border border-gold-dim bg-gold-faint/20 p-4">
        <h2 className="font-display text-xs tracking-[0.2em] text-gold uppercase">
          Identité confidentielle
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Votre Titre sera visible par l&rsquo;ensemble des membres autorisés de La
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
        disabled={
          isPending ||
          !privacyAcknowledged ||
          !firstName.trim() ||
          !displayName.trim() ||
          !playerLevelId
        }
      >
        {isPending ? "Le fil se noue…" : "Sceller mon identité"}
      </Button>
    </form>
  );
}
