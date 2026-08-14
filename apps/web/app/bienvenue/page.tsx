import { redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { getCurrentUser } from "@/lib/session";
import { getOnboardingState } from "@/server/onboarding-state";
import { ToileEmblem, ToileWordmark } from "@/components/ui/logo";
import { WebBackground } from "@/components/ui/web-background";
import { IdentityForm } from "@/components/onboarding/identity-form";
import { OnboardingGroupForm } from "@/components/onboarding/group-form";

export const dynamic = "force-dynamic";

/**
 * Onboarding de première connexion : identité (prénom, nom facultatif,
 * pseudonyme unique, confidentialité), puis création de groupe pour les
 * chefs invités avec le mode CREATE_NEW_GROUP. Reprenable à tout moment ;
 * aucune page sensible n'est accessible avant complétion (requireUser).
 */
export default async function BienvenuePage() {
  const current = await getCurrentUser();
  if (!current) redirect("/connexion");
  if (current.session.user.profileCompleted) redirect("/missions");

  const state = await getOnboardingState(current.session.userId);
  const step: "identity" | "group" = state.identityDone ? "group" : "identity";
  const [levels, userLevel] = await Promise.all([
    prisma.playerLevel.findMany({
      orderBy: { order: "asc" },
      select: { id: true, label: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: current.session.userId },
      select: { playerLevel: { select: { id: true, label: true } } },
    }),
  ]);
  // Faction prévue par l'invitation pour le futur groupe (facultative)
  const plannedFaction = state.invitation?.factionId
    ? await prisma.faction.findUnique({
        where: { id: state.invitation.factionId },
        select: { name: true },
      })
    : null;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-8">
      <WebBackground />
      <div className="relative w-full max-w-lg">
        <section className="border border-border-gold bg-raised p-6 shadow-modal sm:p-8">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <ToileEmblem size={72} />
            <ToileWordmark className="text-lg" />
            <p className="font-mono-toile text-[0.65rem] uppercase tracking-[0.3em] text-ink-faint">
              {step === "identity"
                ? "Choisissez le Titre sous lequel la Toile vous connaîtra"
                : "Fondez votre groupe"}
            </p>
            {state.groupStepNeeded && (
              <ol className="flex gap-3 font-mono-toile text-[0.6rem] uppercase tracking-widest">
                <li className={step === "identity" ? "text-gold" : "text-ink-faint line-through"}>
                  01 Identité
                </li>
                <li aria-hidden className="text-ink-faint">·</li>
                <li className={step === "group" ? "text-gold" : "text-ink-faint"}>02 Groupe</li>
              </ol>
            )}
          </div>

          {step === "identity" ? (
            <IdentityForm levels={levels} assignedLevel={userLevel.playerLevel} />
          ) : (
            <>
              <p className="mb-4 text-xs leading-relaxed text-ink-muted">
                Votre invitation vous autorise à fonder un nouveau groupe sur la Toile.
                Vous en deviendrez le premier chef.
                {plannedFaction
                  ? ` Il naîtra rattaché à ${plannedFaction.name}.`
                  : " Il naîtra sans rattachement de faction — la modération peut l'ajuster ensuite."}
              </p>
              <OnboardingGroupForm />
            </>
          )}
        </section>
        <p className="mt-4 text-center font-mono-toile text-[0.6rem] uppercase tracking-[0.25em] text-ink-faint">
          Univers de jeu de rôle — contenu entièrement fictif
        </p>
      </div>
    </main>
  );
}
