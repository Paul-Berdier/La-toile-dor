/**
 * Toile géométrique d'arrière-plan — fils d'or très fins, quasi subliminaux.
 * Purement décorative (aria-hidden), aucune information portée.
 */
export function WebBackground() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full opacity-[0.07]"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1440 900"
    >
      <g stroke="var(--toile-gold)" strokeWidth="0.6" fill="none">
        {/* Ancres de toile aux angles */}
        <path d="M 0 0 L 480 220 L 960 120 L 1440 300" />
        <path d="M 0 900 L 380 640 L 900 760 L 1440 560" />
        <path d="M 0 300 L 480 220 M 480 220 L 380 640 M 960 120 L 900 760 M 1440 300 L 1440 560" />
        <path d="M 480 220 L 900 760 M 380 640 L 960 120" />
        {/* Anneaux partiels autour du croisement principal */}
        <path d="M 600 320 Q 700 260 800 330 T 980 380" />
        <path d="M 560 420 Q 690 340 830 420 T 1050 470" />
        <path d="M 520 540 Q 690 430 880 520 T 1120 560" />
      </g>
      <g fill="var(--toile-gold)">
        <circle cx="480" cy="220" r="2" />
        <circle cx="960" cy="120" r="1.5" />
        <circle cx="380" cy="640" r="1.5" />
        <circle cx="900" cy="760" r="2" />
      </g>
    </svg>
  );
}
