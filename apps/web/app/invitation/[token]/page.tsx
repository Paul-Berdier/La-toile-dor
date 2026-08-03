import Link from "next/link";
import { headers } from "next/headers";
import { checkInvitation, rateLimit } from "@toile/auth";
import { ToileEmblem, ToileWordmark } from "@/components/ui/logo";
import { WebBackground } from "@/components/ui/web-background";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  // Limitation stricte des tentatives de devinette de jeton
  const limit = rateLimit(`invite-check:${ip}`, 8, 300);
  const check = limit.allowed ? await checkInvitation(token) : null;
  const valid = check?.valid === true;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <WebBackground />
      <div className="relative w-full max-w-md">
        <section className="border border-border-gold bg-raised p-8 text-center shadow-modal sm:p-10">
          <div className="flex flex-col items-center gap-5">
            <ToileEmblem size={96} />
            <ToileWordmark className="text-xl sm:text-2xl" />

            {valid ? (
              <>
                <p className="font-mono-toile text-[0.65rem] uppercase tracking-[0.3em] text-gold">
                  Un fil vous a été tendu
                </p>
                <p className="text-sm leading-relaxed text-ink-muted">
                  Cette invitation est authentique. Présentez-vous : votre identité Discord sera
                  liée à ce fil, puis examinée par la Toile avant l&rsquo;admission.
                </p>
                <Link
                  href={`/api/auth/login?invite=${encodeURIComponent(token)}`}
                  className={`${buttonClasses("gold", "lg")} w-full`}
                >
                  Saisir le fil — continuer avec Discord
                </Link>
                <p className="text-xs text-ink-faint">
                  Ce lien est à usage unique et expirera. Ne le partagez avec personne.
                </p>
              </>
            ) : (
              <>
                <p className="font-mono-toile text-[0.65rem] uppercase tracking-[0.3em] text-blood-bright">
                  Fil rompu
                </p>
                <p className="text-sm leading-relaxed text-ink-muted">
                  Ce lien ne mène nulle part. Il a peut-être déjà servi, expiré, ou n&rsquo;a
                  jamais existé. La Toile ne fournit pas d&rsquo;explication.
                </p>
                <Link href="/connexion" className={`${buttonClasses("outline", "md")} w-full`}>
                  Retour au seuil
                </Link>
              </>
            )}
          </div>
        </section>
        <p className="mt-6 text-center font-mono-toile text-[0.6rem] uppercase tracking-[0.25em] text-ink-faint">
          Univers de jeu de rôle — contenu entièrement fictif
        </p>
      </div>
    </main>
  );
}
