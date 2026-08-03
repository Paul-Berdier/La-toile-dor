import Link from "next/link";
import { ToileEmblem, ToileWordmark } from "@/components/ui/logo";
import { WebBackground } from "@/components/ui/web-background";
import { buttonClasses } from "@/components/ui/button";

export default function AttentePage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <WebBackground />
      <div className="relative w-full max-w-md">
        <section className="border border-border-gold bg-raised p-8 text-center shadow-modal sm:p-10">
          <div className="flex flex-col items-center gap-5">
            <ToileEmblem size={96} />
            <ToileWordmark className="text-xl sm:text-2xl" />
            <p className="font-mono-toile text-[0.65rem] uppercase tracking-[0.3em] text-warning">
              La Toile vous observe
            </p>
            <p className="text-sm leading-relaxed text-ink-muted">
              Votre fil est noué, mais l&rsquo;admission exige encore un regard. Un tisseur
              examinera votre profil ; vous serez prévenu par Discord lorsque le sceau tombera.
            </p>
            <Link href="/connexion" className={`${buttonClasses("ghost", "md")}`}>
              Revenir plus tard
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
