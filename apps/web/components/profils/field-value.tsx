import {
  CONFIDENCE_LABELS,
  DISPLAY_ARIA_LABELS,
  DISPLAY_LABELS,
  type IntelConfidenceCode,
  type ProfileFieldView,
} from "@toile/shared";

/** Explication courte d'un niveau de confiance (infobulle). */
const CONFIDENCE_HINTS: Record<IntelConfidenceCode, string> = {
  CONFIRMED: "Recoupé — la Toile le tient pour acquis",
  PROBABLE: "Source fiable, non recoupée",
  UNCONFIRMED: "Une seule source, à vérifier",
  RUMOR: "On-dit — à prendre avec prudence",
};

/**
 * Pastille de confiance (§47) : seulement pour les lecteurs autorisés (le
 * sérialiseur ne la fournit qu'à eux) et seulement si ce n'est PAS « confirmé »
 * — le cas normal ne doit pas encombrer le dossier. Le détail est en infobulle.
 */
export function ConfidenceTag({ confidence }: { confidence?: IntelConfidenceCode | null }) {
  if (!confidence || confidence === "CONFIRMED") return null;
  const rumor = confidence === "RUMOR";
  return (
    <span
      title={CONFIDENCE_HINTS[confidence]}
      className={`ml-1.5 inline-block border px-1 align-middle text-[0.55rem] uppercase tracking-wider ${
        rumor ? "border-copper/60 text-copper" : "border-border-strong text-ink-faint"
      }`}
    >
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

/**
 * Rendu d'une valeur de dossier selon son état.
 *
 * La distinction la plus importante du produit doit être indiscutable, et
 * lisible d'un coup d'œil comme dans un vrai dossier :
 * - « ??? » (acquis mais confidentiel) = trois points d'interrogation dorés,
 *   en chasse fixe, suivis d'un petit sceau 封 — c'est la mention littérale
 *   du cahier des charges, avec un label accessible « Information
 *   confidentielle » ;
 * - « Inconnu » (la Toile ne sait pas) = mention italique discrète.
 * La différence porte sur la FORME (glyphes, graisse, sceau) et pas seulement
 * sur la couleur. Le composant ne reçoit jamais de valeur réelle pour un état
 * non VISIBLE : ce qui n'est pas dans la réponse n'a pas quitté le serveur.
 */
export function FieldValue({
  field,
  tone = "dark",
  compact = false,
}: {
  field: ProfileFieldView;
  /** « parchment » : dossier ouvert (encre sur papier) ; « dark » : panneau scellé */
  tone?: "dark" | "parchment";
  /** Variante resserrée pour les en-têtes, cartes et listes */
  compact?: boolean;
}) {
  const parchment = tone === "parchment";
  switch (field.displayState) {
    case "VISIBLE":
      return (
        <span className={parchment ? "text-parchment-text" : "text-ink"}>
          {field.displayValue}
          {!compact && <ConfidenceTag confidence={field.confidence} />}
        </span>
      );
    case "REDACTED":
      return <Redacted compact={compact} />;
    case "NONE":
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.NONE}
          className={`inline-flex items-center gap-1.5 ${
            parchment ? "text-parchment-text/80" : "text-ink-muted"
          }`}
        >
          <span aria-hidden className="font-display text-[0.7rem] text-copper">
            無
          </span>
          Aucun
        </span>
      );
    case "CONFLICTING":
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.CONFLICTING}
          title={DISPLAY_ARIA_LABELS.CONFLICTING}
          className="inline-flex items-center gap-1 text-xs text-blood-bright"
        >
          <span aria-hidden>⚠</span>
          {compact ? "Contradictoire" : DISPLAY_LABELS.CONFLICTING}
        </span>
      );
    default:
      return <Unknown tone={tone} />;
  }
}

/**
 * « ??? » — information que la Toile possède mais que le lecteur n'a pas
 * achetée. Toujours le même glyphe, partout : en-tête, carte, ligne, rapport.
 */
export function Redacted({ compact = false }: { compact?: boolean }) {
  return (
    <span
      role="img"
      aria-label={DISPLAY_ARIA_LABELS.REDACTED}
      title={DISPLAY_ARIA_LABELS.REDACTED}
      className={`inline-flex cursor-help items-center gap-1 font-mono-toile tracking-[0.2em] text-gold select-none ${
        compact ? "text-[0.8rem]" : "text-sm"
      }`}
    >
      <span aria-hidden>???</span>
      <span aria-hidden className="font-display text-[0.65em] tracking-normal text-gold-dim">
        封
      </span>
    </span>
  );
}

/** « Inconnu » — la Toile ne possède pas cette information. */
export function Unknown({ tone = "dark" }: { tone?: "dark" | "parchment" }) {
  return (
    <span
      aria-label={DISPLAY_ARIA_LABELS.UNKNOWN}
      title={DISPLAY_ARIA_LABELS.UNKNOWN}
      className={tone === "parchment" ? "text-parchment-text/50 italic" : "text-ink-faint italic"}
    >
      Inconnu
    </span>
  );
}

/**
 * Valeur VISIBLE d'un référentiel coloré (cheveux, peau, iris) : une ou deux
 * pastilles devant le libellé. Deux pastilles = hétérochromie. À n'appeler que
 * pour un champ VISIBLE — le composant n'a aucun moyen de censurer.
 */
export function SwatchValue({
  swatches,
  label,
  tone = "dark",
  confidence,
}: {
  swatches: (string | null | undefined)[];
  label: string;
  tone?: "dark" | "parchment";
  confidence?: IntelConfidenceCode | null;
}) {
  const parchment = tone === "parchment";
  const hexes = swatches.filter((hex): hex is string => Boolean(hex));
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${parchment ? "text-parchment-text" : "text-ink"}`}>
      {hexes.length > 0 && (
        <span aria-hidden className="inline-flex">
          {hexes.map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className={`inline-block h-3 w-3 rounded-full border border-border-strong ${i > 0 ? "-ml-1" : ""}`}
              style={{ background: hex }}
            />
          ))}
        </span>
      )}
      <span>
        {label}
        <ConfidenceTag confidence={confidence} />
      </span>
    </span>
  );
}

/** Extrait les teintes d'une valeur sérialisée (option simple ou paire d'iris). */
export function swatchesOf(value: unknown): (string | null)[] {
  if (!value || typeof value !== "object") return [];
  if ("primary" in value) {
    const pair = value as { primary: { colorHex: string | null }; secondary: { colorHex: string | null } | null };
    return [pair.primary?.colorHex ?? null, pair.secondary?.colorHex ?? null];
  }
  if ("colorHex" in value) return [(value as { colorHex: string | null }).colorHex];
  return [];
}

/**
 * Ligne « libellé : valeur » d'un dossier. Le libellé à gauche, la valeur à
 * droite ; une valeur censurée se lit « ??? 封 », une valeur absente
 * « Inconnu » — même colonne, même alignement, jamais une boîte de formulaire.
 */
export function DossierRow({
  label,
  field,
  tone = "dark",
  children,
}: {
  label: string;
  field: ProfileFieldView;
  tone?: "dark" | "parchment";
  children?: React.ReactNode;
}) {
  const parchment = tone === "parchment";
  return (
    <div
      className={`flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0 ${
        parchment ? "border-parchment-deep/60" : "border-border-default/60"
      }`}
    >
      <dt
        className={`shrink-0 text-[0.7rem] uppercase tracking-wider ${
          parchment ? "text-parchment-text/60" : "text-ink-faint"
        }`}
      >
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm">
        {children ?? <FieldValue field={field} tone={tone} />}
      </dd>
    </div>
  );
}
