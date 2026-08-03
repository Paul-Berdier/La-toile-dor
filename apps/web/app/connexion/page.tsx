import Link from "next/link";
import { redirect } from "next/navigation";
import { ToileEmblem, ToileWordmark } from "@/components/ui/logo";
import { WebBackground } from "@/components/ui/web-background";
import { buttonClasses } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  acces:
    "La Toile ne vous reconnaît pas. Vérifiez votre invitation, ou adressez-vous à celui qui vous a tendu le fil.",
  limite: "Trop de tentatives. Le fil se retend dans quelques instants.",
};

export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const current = await getCurrentUser();
  if (current) redirect("/missions");

  const { erreur } = await searchParams;
  const errorMessage = erreur ? ERRORS[erreur] ?? ERRORS.acces : null;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <WebBackground />

      <div className="relative w-full max-w-md">
        {/* Fil vertical qui descend vers le panneau */}
        <div
          aria-hidden
          className="absolute -top-24 left-1/2 h-24 w-px bg-gradient-to-b from-transparent to-gold-dim"
        />

        <section
          className="border border-border-gold bg-raised p-8 shadow-modal sm:p-10"
          aria-labelledby="titre-connexion"
        >
          <div className="flex flex-col items-center gap-5 text-center">
            <ToileEmblem size={108} />
            <h1 id="titre-connexion" className="sr-only">
              La Toile d&rsquo;Or — connexion
            </h1>
            <ToileWordmark className="text-2xl sm:text-3xl" />
            <p className="font-mono-toile text-[0.65rem] uppercase tracking-[0.3em] text-ink-faint">
              Réseau privé · accès sur invitation
            </p>

            <div aria-hidden className="my-2 h-px w-24 bg-gold-dim" />

            <p className="text-sm leading-relaxed text-ink-muted">
              Ce réseau n&rsquo;accepte aucune inscription. Seuls ceux à qui un fil a été tendu
              peuvent franchir ce seuil. Chaque passage est consigné.
            </p>

            {errorMessage && (
              <p
                role="alert"
                className="w-full border border-blood bg-blood/10 px-4 py-3 text-sm text-blood-bright"
              >
                {errorMessage}
              </p>
            )}

            <Link href="/api/auth/login" className={`${buttonClasses("gold", "lg")} w-full`}>
              <DiscordMark />
              Se présenter via Discord
            </Link>

            <p className="text-xs leading-relaxed text-ink-faint">
              Vous détenez un lien d&rsquo;invitation ? Ouvrez-le directement : la Toile vous
              reconnaîtra au moment de la connexion.
            </p>
          </div>
        </section>

        <p className="mt-6 text-center font-mono-toile text-[0.6rem] uppercase tracking-[0.25em] text-ink-faint">
          Univers de jeu de rôle — contenu entièrement fictif
        </p>
      </div>
    </main>
  );
}

function DiscordMark() {
  return (
    <svg width="18" height="14" viewBox="0 0 24 18" fill="currentColor" aria-hidden>
      <path d="M20.3 1.5A19.8 19.8 0 0 0 15.4 0l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 0C6.9.3 5.2.9 3.7 1.5.7 6 0 10.4.3 14.7A19.9 19.9 0 0 0 6.4 18l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.7.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3.3c.4-5-.7-9.3-3-13.2ZM8.7 12.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm6.6 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
