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
                  Cette invitation est authentique. Déclinez votre identité de l&rsquo;ombre :
                  elle sera liée à votre compte Discord, puis examinée par la Toile.
                </p>

                {/* La fiche RP part avec la connexion (cookies éphémères côté serveur) */}
                <form
                  action="/api/auth/login"
                  method="get"
                  className="w-full space-y-3 text-left"
                >
                  <input type="hidden" name="invite" value={token} />
                  <div>
                    <label
                      htmlFor="rp-titre"
                      className="mb-1 block text-xs uppercase tracking-wider text-ink-faint"
                    >
                      Titre — votre pseudonyme dans le RP *
                    </label>
                    <input
                      id="rp-titre"
                      name="titre"
                      required
                      maxLength={60}
                      placeholder="ex. La Lame Silencieuse"
                      className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="rp-village"
                      className="mb-1 block text-xs uppercase tracking-wider text-ink-faint"
                    >
                      Village ou pays d&rsquo;appartenance *
                    </label>
                    <input
                      id="rp-village"
                      name="village"
                      required
                      maxLength={60}
                      placeholder="ex. Kumogakure"
                      className="w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold"
                    />
                  </div>
                  <button type="submit" className={`${buttonClasses("gold", "lg")} w-full`}>
                    Saisir le fil — continuer avec Discord
                  </button>
                </form>
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
