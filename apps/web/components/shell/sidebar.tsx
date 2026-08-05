"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ToileEmblem } from "@/components/ui/logo";

export interface NavItem {
  href: string;
  label: string;
  glyph: string;
  /** Compteur (ex. échos non lus) affiché en pastille or */
  badge?: number;
}

export function Sidebar({
  items,
  userName,
  roleLabel,
}: {
  items: NavItem[];
  userName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Barre latérale (desktop) — fixe au défilement.
          `self-start` est indispensable : en flex, l'aside est autrement
          étirée à la hauteur de TOUT le contenu, et `sticky` n'a alors rien
          contre quoi coller. Avec sa propre hauteur d'écran, elle reste en
          place pendant que la page défile. */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col self-start border-r border-border-default bg-raised md:flex">
        <Link
          href="/missions"
          className="flex items-center gap-3 border-b border-border-default px-4 py-4"
        >
          <ToileEmblem size={36} />
          <span className="font-display text-sm tracking-[0.2em] text-gold uppercase">
            La Toile d&rsquo;Or
          </span>
        </Link>

        {/* La liste défile pour elle-même sur les écrans peu hauts : le bloc
            d'identité et la déconnexion doivent rester atteignables. */}
        <nav
          aria-label="Navigation principale"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"
        >
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  active ? "bg-hover-bg text-gold" : "text-ink-muted hover:bg-hover-bg hover:text-ink"
                }`}
              >
                {/* Fil d'or vertical marquant la page active */}
                <span
                  aria-hidden
                  className={`absolute left-0 top-1 bottom-1 w-px transition-colors ${
                    active ? "bg-gold" : "bg-transparent group-hover:bg-gold-dim"
                  }`}
                />
                <span aria-hidden className="w-5 text-center font-display text-gold-dim">
                  {item.glyph}
                </span>
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span
                    className="ml-auto border border-gold bg-gold-faint px-1.5 font-mono-toile text-[0.6rem] text-gold"
                    aria-label={`${item.badge} non lu${item.badge > 1 ? "s" : ""}`}
                  >
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border-default p-4">
          {/* Le bloc d'identité mène à ses propres informations */}
          <Link href="/compte" className="block hover:text-gold">
            <p className="truncate text-sm text-ink hover:text-gold">{userName}</p>
            <p className="font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">
              {roleLabel}
            </p>
          </Link>
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button
              type="submit"
              className="text-xs text-ink-faint underline-offset-2 hover:text-blood-bright hover:underline"
            >
              Couper le fil (déconnexion)
            </button>
          </form>
        </div>
      </aside>

      {/* Navigation mobile en bas d'écran */}
      {/* Au-delà de 5 entrées, la barre défile horizontalement plutôt que
          d'écraser les libellés les uns contre les autres. */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-30 flex snap-x overflow-x-auto border-t border-border-gold bg-raised md:hidden"
      >
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-[4.5rem] flex-1 shrink-0 snap-start flex-col items-center gap-0.5 px-1 py-2 text-center text-[0.6rem] uppercase tracking-wide ${
                active ? "text-gold" : "text-ink-faint"
              }`}
            >
              <span aria-hidden className="relative font-display text-base">
                {item.glyph}
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -top-1 -right-2 h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
