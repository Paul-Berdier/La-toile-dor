"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sous-navigation de l'administration — même langage de fil d'or que la sidebar. */
export function AdminNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Administration"
      className="mt-3 mb-6 flex flex-wrap gap-4 border-b border-border-default"
    >
      {links.map((link) => {
        const active =
          link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`relative pb-2 text-xs transition-colors ${
              active ? "text-gold" : "text-ink-muted hover:text-ink"
            }`}
          >
            {link.label}
            {/* Fil d'or horizontal marquant l'onglet actif */}
            <span
              aria-hidden
              className={`absolute inset-x-0 -bottom-px h-px transition-colors ${
                active ? "bg-gold" : "bg-transparent"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
