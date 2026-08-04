import { DISPLAY_ARIA_LABELS, type ProfileFieldView } from "@toile/shared";

/**
 * Rendu d'une valeur de dossier selon son état :
 * - VISIBLE : la valeur ;
 * - REDACTED (« ??? ») : ligne censurée noir et or, label accessible ;
 * - UNKNOWN (« Inconnu ») : style neutre, information non acquise ;
 * - NONE (« Aucun ») / CONFLICTING : acquis particuliers.
 * Le composant ne reçoit JAMAIS de valeur réelle pour un état non VISIBLE.
 */
export function FieldValue({ field }: { field: ProfileFieldView }) {
  switch (field.displayState) {
    case "VISIBLE":
      return <span className="text-ink">{field.displayValue}</span>;
    case "REDACTED":
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.REDACTED}
          title={DISPLAY_ARIA_LABELS.REDACTED}
          className="inline-flex items-center gap-1.5 border border-gold-dim bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(184,150,62,0.12)_4px,rgba(184,150,62,0.12)_8px)] px-2 py-0.5 font-mono-toile text-xs text-gold"
        >
          ???
        </span>
      );
    case "NONE":
      return (
        <span aria-label={DISPLAY_ARIA_LABELS.NONE} className="text-ink-muted">
          Aucun
        </span>
      );
    case "CONFLICTING":
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.CONFLICTING}
          className="inline-flex items-center gap-1.5 border border-blood/60 px-2 py-0.5 text-xs text-blood-bright"
        >
          Information contradictoire
        </span>
      );
    default:
      return (
        <span
          aria-label={DISPLAY_ARIA_LABELS.UNKNOWN}
          className="text-ink-faint italic"
        >
          Inconnu
        </span>
      );
  }
}

/** Ligne « libellé : valeur » d'un dossier. */
export function DossierRow({
  label,
  field,
  children,
}: {
  label: string;
  field: ProfileFieldView;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-default/60 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[0.7rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children ?? <FieldValue field={field} />}</dd>
    </div>
  );
}
