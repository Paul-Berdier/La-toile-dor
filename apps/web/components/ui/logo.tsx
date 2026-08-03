/**
 * Emblème original de La Toile d'Or : une toile géométrique octogonale en
 * fils d'or, une araignée stylisée en son centre. Création originale — aucun
 * asset officiel.
 */
export function ToileEmblem({ size = 96, className }: { size?: number; className?: string }) {
  const spokes = 8;
  const rings = [14, 26, 38];
  const cx = 50;
  const cy = 50;

  const spokeLines = Array.from({ length: spokes }, (_, i) => {
    const angle = (i * Math.PI * 2) / spokes - Math.PI / 2;
    return {
      x2: cx + Math.cos(angle) * 46,
      y2: cy + Math.sin(angle) * 46,
    };
  });

  const ringPolygon = (r: number) =>
    Array.from({ length: spokes }, (_, i) => {
      const angle = (i * Math.PI * 2) / spokes - Math.PI / 2;
      return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
    }).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Emblème de La Toile d'Or"
      className={className}
    >
      {/* Cercle d'enceinte gravé */}
      <circle cx={cx} cy={cy} r={48} fill="none" stroke="var(--toile-gold-dim)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={45.5} fill="none" stroke="var(--toile-gold-faint)" strokeWidth="0.5" />
      {/* Rayons de la toile */}
      {spokeLines.map((line, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={line.x2}
          y2={line.y2}
          stroke="var(--toile-gold-dim)"
          strokeWidth="0.7"
        />
      ))}
      {/* Anneaux octogonaux */}
      {rings.map((r) => (
        <polygon
          key={r}
          points={ringPolygon(r)}
          fill="none"
          stroke="var(--toile-gold)"
          strokeWidth="0.8"
          opacity={0.85}
        />
      ))}
      {/* Araignée stylisée : corps en losange, huit pattes fines */}
      <g stroke="var(--toile-gold-bright)" strokeWidth="1.1" strokeLinecap="round">
        <line x1="50" y1="46" x2="42" y2="38" />
        <line x1="50" y1="46" x2="58" y2="38" />
        <line x1="49" y1="49" x2="39" y2="46" />
        <line x1="51" y1="49" x2="61" y2="46" />
        <line x1="49" y1="52" x2="40" y2="57" />
        <line x1="51" y1="52" x2="60" y2="57" />
        <line x1="50" y1="54" x2="44" y2="62" />
        <line x1="50" y1="54" x2="56" y2="62" />
      </g>
      <path
        d="M 50 43 L 54 50 L 50 57 L 46 50 Z"
        fill="var(--toile-gold-bright)"
        stroke="var(--toile-gold)"
        strokeWidth="0.5"
      />
      <circle cx="50" cy="44" r="2.2" fill="var(--toile-gold-bright)" />
    </svg>
  );
}

export function ToileWordmark({ className }: { className?: string }) {
  return (
    <span
      className={`font-display tracking-[0.35em] text-gold uppercase ${className ?? ""}`}
      style={{ textShadow: "0 0 14px rgba(184,150,62,0.2)" }}
    >
      La Toile d&rsquo;Or
    </span>
  );
}
