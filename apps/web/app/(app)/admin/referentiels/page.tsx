import { prisma } from "@toile/database";
import {
  PERMISSIONS,
  REFERENCE_TYPE_LABELS,
  SOURCE_SCOPE_LABELS,
  type ReferenceType,
} from "@toile/shared";
import { requireUserWith } from "@/lib/session";
import {
  ToggleOptionButton,
  CreateOptionForm,
  SuggestionReview,
} from "@/components/profils/reference-admin";

export const dynamic = "force-dynamic";

export default async function AdminReferentielsPage() {
  await requireUserWith(PERMISSIONS.PROFILE_REFERENCE_MANAGE);

  const [options, suggestions] = await Promise.all([
    prisma.profileReferenceOption.findMany({
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.profileReferenceSuggestion.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const types = Object.entries(REFERENCE_TYPE_LABELS) as [ReferenceType, string][];

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-faint">
        Référentiels des dossiers de renseignement. Les codes sont stables ; les
        libellés et alias évitent les variantes (Uchiha / UCHIWA / Uchïha).
      </p>

      <section className="border border-border-gold bg-raised p-4">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Créer une option (super-modérateur)
        </h2>
        <CreateOptionForm types={types.map(([value, label]) => ({ value, label }))} />
      </section>

      {suggestions.length > 0 && (
        <section className="border border-warning/50 bg-raised p-4">
          <h2 className="mb-3 font-display text-sm tracking-widest text-warning uppercase">
            Propositions en attente ({suggestions.length})
          </h2>
          <ul className="space-y-3">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="border border-border-default bg-elevated p-3">
                <p className="text-sm text-ink">
                  {suggestion.proposedLabel}
                  <span className="ml-2 text-xs text-ink-faint">
                    {REFERENCE_TYPE_LABELS[suggestion.type as ReferenceType] ?? suggestion.type}
                    {" · "}{SOURCE_SCOPE_LABELS[suggestion.sourceScope]}
                  </span>
                </p>
                {suggestion.description && (
                  <p className="mt-1 text-xs text-ink-muted">{suggestion.description}</p>
                )}
                {suggestion.reason && (
                  <p className="mt-1 text-xs text-ink-faint italic">Motif : {suggestion.reason}</p>
                )}
                <div className="mt-2">
                  <SuggestionReview
                    suggestionId={suggestion.id}
                    sameTypeOptions={options
                      .filter((o) => o.type === suggestion.type && o.isActive)
                      .map((o) => ({ id: o.id, label: o.label }))}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {types.map(([type, label]) => {
        const typeOptions = options.filter((o) => o.type === type);
        if (typeOptions.length === 0) return null;
        return (
          <details key={type} className="border border-border-default bg-raised">
            <summary className="cursor-pointer p-4 font-display text-sm tracking-widest text-gold uppercase hover:bg-hover-bg">
              {label} <span className="ml-2 font-mono-toile text-xs text-ink-faint">{typeOptions.length}</span>
            </summary>
            <ul className="space-y-1 border-t border-border-default p-4">
              {typeOptions.map((option) => (
                <li key={option.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className={option.isActive ? "text-ink" : "text-ink-faint line-through"}>
                    {option.colorHex && (
                      <span aria-hidden className="mr-2 inline-block h-3 w-3 border border-border-strong align-middle" style={{ background: option.colorHex }} />
                    )}
                    {option.label}
                    {option.kanji && <span className="ml-2 text-xs text-ink-faint">{option.kanji}</span>}
                    <span className="ml-2 text-[0.65rem] text-ink-faint">
                      {SOURCE_SCOPE_LABELS[option.sourceScope]}
                      {option.aliases.length > 0 && ` · alias : ${option.aliases.join(", ")}`}
                    </span>
                  </span>
                  <ToggleOptionButton optionId={option.id} isActive={option.isActive} />
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
