import Link from "next/link";

/**
 * Résumé du tableau — ce qui appelle une action, pas des statistiques.
 *
 * Chaque tuile est un RACCOURCI : elle applique le filtre correspondant.
 * « 3 candidatures » sans moyen d'aller les voir n'aide personne ; ici, un
 * clic amène exactement sur les contrats concernés.
 *
 * Les comptes respectent la confidentialité : un agent ne voit que ce qui
 * touche ses propres groupes, jamais l'activité des autres.
 */
export interface SummaryTile {
  label: string;
  value: number;
  href: string;
  /** Attire l'œil quand il y a quelque chose à faire */
  tone?: "warning" | "urgent";
  hint?: string;
}

export function BoardSummary({ tiles }: { tiles: SummaryTile[] }) {
  const shown = tiles.filter((tile) => tile.value > 0 || tile.tone === undefined);
  if (shown.length === 0) return null;
  return (
    <dl
      className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
      aria-label="Résumé du tableau"
    >
      {shown.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          title={tile.hint}
          className={`border bg-raised px-3 py-2 transition-colors hover:border-gold ${
            tile.value > 0 && tile.tone === "urgent"
              ? "border-blood/60"
              : tile.value > 0 && tile.tone === "warning"
                ? "border-warning/50"
                : "border-border-default"
          }`}
        >
          <dt className="text-[0.6rem] uppercase tracking-wider text-ink-faint">{tile.label}</dt>
          <dd
            className={`font-mono-toile text-lg ${
              tile.value > 0 && tile.tone === "urgent"
                ? "text-blood-bright"
                : tile.value > 0 && tile.tone === "warning"
                  ? "text-warning"
                  : "text-gold"
            }`}
          >
            {tile.value}
          </dd>
        </Link>
      ))}
    </dl>
  );
}
