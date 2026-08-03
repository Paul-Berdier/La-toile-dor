/**
 * Filigrane dynamique anti-fuite : pseudonyme, identifiant partiel, faction,
 * horodatage et identifiant de session répétés en diagonale.
 *
 * Intégré à plusieurs niveaux (coquille + panneaux confidentiels) et rendu
 * côté serveur : le supprimer dans l'inspecteur ne retire que la couche visée.
 * Ce n'est PAS la sécurité principale — seulement une protection contre les
 * fuites accidentelles en capture ou en stream.
 */

export interface WatermarkIdentity {
  displayName: string;
  partialId: string;
  factionName: string | null;
  sessionShortId: string;
}

export function buildWatermarkText(identity: WatermarkIdentity, now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  return [
    identity.displayName,
    `#${identity.partialId}`,
    identity.factionName ?? "—",
    stamp,
    `S:${identity.sessionShortId}`,
  ].join(" · ");
}

/** Couche de filigrane locale, posée à l'intérieur d'un panneau confidentiel. */
export function PanelWatermark({ identity }: { identity: WatermarkIdentity }) {
  const text = buildWatermarkText(identity, new Date());
  return (
    <div
      aria-hidden
      data-wm="panel"
      className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden"
      style={{ opacity: 0.06 }}
    >
      <div className="absolute -inset-[10%] flex flex-col gap-10" style={{ transform: "rotate(-16deg)" }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span
            key={i}
            className="whitespace-nowrap font-mono-toile text-[0.65rem] text-parchment-text"
            style={{ transform: `translateX(${i * 3}rem)` }}
          >
            {text} · {text}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Watermark({ identity, layer = 0 }: { identity: WatermarkIdentity; layer?: number }) {
  const text = buildWatermarkText(identity, new Date());
  const rows = 8;
  const cols = 3;

  return (
    <div
      aria-hidden
      data-wm={layer}
      className="pointer-events-none fixed inset-0 z-30 select-none overflow-hidden"
      style={{ opacity: 0.032 }}
    >
      <div
        className="absolute -inset-[20%] grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          transform: "rotate(-22deg)",
        }}
      >
        {Array.from({ length: rows * cols }, (_, i) => (
          <span
            key={i}
            className="whitespace-nowrap font-mono-toile text-xs text-gold"
            style={{ transform: `translateX(${(i % rows) * 2.5}rem)` }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
