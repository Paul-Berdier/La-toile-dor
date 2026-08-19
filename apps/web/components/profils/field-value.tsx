import { DISPLAY_ARIA_LABELS, type ProfileFieldView } from "@toile/shared";

/**
 * Rendu d'une valeur de dossier selon son état.
 *
 * La distinction la plus importante du produit doit être indiscutable :
 * - « ??? » (acquis mais confidentiel) = BANDE CENSURÉE pleine largeur, mate,
 *   liserée d'or, avec un sceau 封 — impossible à confondre ;
 * - « Inconnu » (non acquis) = mention discrète, sans cadre ni bande.
 * La différence porte sur la FORME et la LONGUEUR, pas seulement la couleur.
 * Le composant ne reçoit jamais de valeur réelle pour un état non VISIBLE.
 */
export function FieldValue({
  field,
  tone = "dark",
  compact = false,
}: {
  field: ProfileFieldView;
  /** « parchment » : dossier ouvert (encre sur papier) ; « dark » : panneau scellé */
  tone?: "dark" | "parchment";
  /** Variante resserrée pour les en-têtes et les listes */
  compact?: boolean;
}) {
  const parchment = tone === "parchment";
  switch (field.displayState) {
    case "VISIBLE":
      return (
        <span className={parchment ? "text-parchment-text" : "text-ink"}>
          {field.displayValue}
        </span>
      );
    case "REDACTED":
      return (
        <span
          role="img"
          aria-label={DISPLAY_ARIA_LABELS.REDACTED}
          title={DISPLAY_ARIA_LABELS.REDACTED}
          className={`inline-flex cursor-not-allowed items-center justify-between gap-2 border border-gold-dim bg-obsidian ${
            compact ? "px-1.5 py-0.5" : "w-full min-w-[8rem] px-2 py-1.5"
          }`}
        >
          <span
            aria-hidden
            className="min-w-0 flex-1 overflow-hidden font-mono-toile text-[0.7rem] tracking-[0.3em] text-gold-dim select-none"
          >
            {compact ? "▮▮▮▮" : "▮▮▮▮▮▮▮▮▮▮▮▮"}
          </span>
          <span aria-hidden className="shrink-0 font-display text-xs text-gold">
            封
          </span>
        </span>
      );
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
          className="inline-flex items-center gap-1.5 border border-blood/60 px-2 py-0.5 text-xs text-blood-bright"
        >
          <span aria-hidden>⚠</span>
          Information contradictoire
        </span>
      );
    default:
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.UNKNOWN}
          className={parchment ? "text-parchment-text/50 italic" : "text-ink-faint italic"}
        >
          Inconnu
        </span>
      );
  }
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
}: {
  swatches: (string | null | undefined)[];
  label: string;
  tone?: "dark" | "parchment";
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
              className={`inline-block h-3 w-3 border border-border-strong ${i > 0 ? "-ml-1" : ""}`}
              style={{ background: hex }}
            />
          ))}
        </span>
      )}
      {label}
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
 * Ligne « libellé : valeur » d'un dossier. Une valeur censurée occupe toute
 * la colonne de droite — c'est ce qui la distingue d'un « Inconnu » discret.
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
  const redacted = field.displayState === "REDACTED";
  const parchment = tone === "parchment";
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0 ${
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
      <dd
        className={
          redacted
            ? "flex min-w-0 max-w-[16rem] flex-1 justify-end text-right text-sm"
            : "min-w-0 text-right text-sm"
        }
      >
        {children ?? <FieldValue field={field} tone={tone} />}
      </dd>
    </div>
  );
}
