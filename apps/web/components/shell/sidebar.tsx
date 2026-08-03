"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ToileEmblem } from "@/components/ui/logo";

export interface NavItem {
  href: string;
  label: string;
  glyph: string;
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
      {/* Barre latérale (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border-default bg-raised md:flex">
        <Link
          href="/missions"
          className="flex items-center gap-3 border-b border-border-default px-4 py-4"
        >
          <ToileEmblem size={36} />
          <span className="font-display text-sm tracking-[0.2em] text-gold uppercase">
            La Toile d&rsquo;Or
          </span>
        </Link>

        <nav aria-label="Navigation principale" className="flex flex-1 flex-col gap-1 p-3">
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
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border-default p-4">
          <p className="truncate text-sm text-ink">{userName}</p>
          <p className="font-mono-toile text-[0.6rem] uppercase tracking-widest text-ink-faint">
            {roleLabel}
          </p>
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
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border-gold bg-raised md:hidden"
      >
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.6rem] uppercase tracking-wide ${
                active ? "text-gold" : "text-ink-faint"
              }`}
            >
              <span aria-hidden className="font-display text-base">
                {item.glyph}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
