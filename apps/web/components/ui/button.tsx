import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "gold" | "outline" | "ghost" | "danger" | "seal";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-body font-medium " +
  "transition-colors duration-200 rounded-sm cursor-pointer select-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 " +
  "focus-visible:outline-gold-bright focus-visible:outline-offset-2";

const variants: Record<Variant, string> = {
  gold: "bg-gold text-obsidian hover:bg-gold-bright active:bg-gold-dim border border-gold",
  outline:
    "bg-transparent text-gold border border-border-gold hover:border-gold hover:bg-hover-bg",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-hover-bg border border-transparent",
  danger:
    "bg-transparent text-blood-bright border border-blood hover:bg-blood hover:text-ink",
  seal: "bg-blood text-ink border border-blood-bright hover:bg-blood-bright",
};

const sizes: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-6 py-3",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = "outline",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/** Variante lien stylée bouton (navigations). */
export function buttonClasses(variant: Variant = "outline", size: Size = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}
