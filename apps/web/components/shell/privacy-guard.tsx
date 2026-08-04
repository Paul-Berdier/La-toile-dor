"use client";

/**
 * Garde de confidentialité côté client :
 * - bouton permanent « voile » → écran noir & or immédiat ;
 * - raccourci Ctrl+Shift+S → bascule du mode Streamer (cookie + refresh serveur) ;
 * - masquage automatique après inactivité ;
 * - flou du contenu quand la fenêtre perd le focus (option).
 *
 * Ces mécanismes protègent des fuites ACCIDENTELLES (stream, partage d'écran).
 * La sécurité réelle reste le filtrage serveur des données.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const INACTIVITY_MS = 5 * 60 * 1000;

export function PrivacyGuard({
  streamerActive,
  children,
}: {
  streamerActive: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [veiled, setVeiled] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [clock, setClock] = useState("");
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleStreamer = useCallback(() => {
    const next = !streamerActive;
    document.cookie = `toile_streamer=${next ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    router.refresh();
  }, [streamerActive, router]);

  // Raccourci clavier Ctrl+Shift+S (mode Streamer) et Échap (lever le voile)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleStreamer();
      }
      if (e.key === "Escape") setVeiled(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleStreamer]);

  // Voile automatique après inactivité
  useEffect(() => {
    const reset = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(() => setVeiled(true), INACTIVITY_MS);
    };
    const events = ["mousemove", "keydown", "scroll", "pointerdown"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, []);

  // Flou léger quand la fenêtre perd le focus
  useEffect(() => {
    const onBlur = () => setBlurred(true);
    const onFocus = () => setBlurred(false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Horloge du voile
  useEffect(() => {
    if (!veiled) return;
    const tick = () =>
      setClock(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const interval = setInterval(tick, 10_000);
    return () => clearInterval(interval);
  }, [veiled]);

  return (
    <>
      <div className={blurred && !veiled ? "blur-md transition-[filter] duration-300" : ""}>
        {children}
      </div>

      {/* Boutons permanents compacts : voile + mode Streamer.
          Ancrés à GAUCHE sous lg : les valeurs des dossiers sont alignées à
          droite et se faisaient recouvrir. Au-dessus de la barre d'onglets. */}
      <div className="fixed left-2 bottom-[4.5rem] z-40 flex flex-col gap-1.5 lg:left-auto lg:right-2 lg:bottom-3">
        <button
          type="button"
          onClick={toggleStreamer}
          aria-pressed={streamerActive}
          aria-label={streamerActive ? "Désactiver le mode Streamer" : "Activer le mode Streamer"}
          title="Mode Streamer (Ctrl+Shift+S) : remplace les informations sensibles par des codes"
          className={`flex h-11 w-11 items-center justify-center border font-display text-sm opacity-70 transition-all hover:opacity-100 focus-visible:opacity-100 ${
            streamerActive
              ? "border-gold bg-gold text-obsidian"
              : "border-border-gold bg-raised/90 text-ink-muted hover:text-gold"
          }`}
        >
          隠
        </button>
        <button
          type="button"
          onClick={() => setVeiled(true)}
          aria-label="Voiler immédiatement l'écran"
          title="Voiler immédiatement l'écran"
          className="flex h-11 w-11 items-center justify-center border border-border-gold bg-raised/90 font-display text-sm text-ink-muted opacity-70 transition-all hover:text-gold hover:opacity-100 focus-visible:opacity-100"
        >
          幕
        </button>
      </div>

      {/* Écran de confidentialité */}
      {veiled && (
        <div
          role="dialog"
          aria-label="Mode confidentiel"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-obsidian"
          onClick={() => setVeiled(false)}
        >
          <VeilWeb />
          <p className="font-display text-2xl tracking-[0.3em] text-gold uppercase">
            Mode confidentiel
          </p>
          <p className="font-mono-toile text-lg text-ink-muted" aria-live="off">
            {clock}
          </p>
          <p className="font-mono-toile text-[0.6rem] uppercase tracking-[0.25em] text-ink-faint">
            Cliquer ou presser Échap pour lever le voile
          </p>
        </div>
      )}
    </>
  );
}

function VeilWeb() {
  return (
    <svg aria-hidden viewBox="0 0 100 100" className="absolute h-[140%] w-[140%] opacity-10">
      <g stroke="var(--toile-gold)" strokeWidth="0.15" fill="none">
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return (
            <line
              key={i}
              x1="50"
              y1="50"
              x2={50 + Math.cos(a) * 70}
              y2={50 + Math.sin(a) * 70}
            />
          );
        })}
        {[12, 24, 36, 48].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} />
        ))}
      </g>
    </svg>
  );
}
