import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@toile/database";
import { PERMISSIONS, categoryLabel, isRealUserView } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { isStreamerMode, maskValue } from "@/lib/streamer";
import { serializeUsersForViewer } from "@/server/identity-server";
import {
  GroupEditSection,
  GroupFactionSelect,
  GroupImageUpload,
  PromoteButton,
} from "@/components/groups/group-panels";

export const dynamic = "force-dynamic";

export default async function GroupePage({ params }: { params: Promise<{ id: string }> }) {
  const current = await requireUser();
  const { id } = await params;
  const streamer = await isStreamerMode();

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      faction: { select: { name: true } },
      members: {
        include: {
          user: { select: { id: true, displayName: true, status: true, playerLevel: { select: { label: true } } } },
        },
        orderBy: [{ isLeader: "desc" }, { joinedAt: "asc" }],
      },
    },
  });
  if (!group || !group.isActive) notFound();

  const myMembership = group.members.find((m) => m.userId === current.session.userId);
  const canManage =
    current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY) || myMembership?.isLeader === true;
  const canChangeFaction = current.permissions.has(PERMISSIONS.GROUP_EDIT_ANY);
  const factionOptions = canChangeFaction
    ? await prisma.faction.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // Identités réelles : sérialisation centralisée — les prénoms/noms
  // n'atteignent JAMAIS le HTML d'un visiteur non autorisé.
  const identities = await serializeUsersForViewer(
    current,
    group.members.map((m) => m.userId),
  );

  const mask = (value: string, prefix: string, seed: string) =>
    streamer ? maskValue(prefix, seed) : value;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <Link
        href="/groupes"
        className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold"
      >
        ← Tous mes groupes
      </Link>

      <header className="mt-4 border border-border-gold bg-raised p-5">
        <div className="flex flex-wrap items-start gap-4">
          {group.imageMime ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/groupes/${group.id}/image`}
              alt={`Emblème de ${group.name}`}
              className="h-20 w-20 shrink-0 border border-border-gold object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-20 w-20 shrink-0 items-center justify-center border border-border-gold bg-elevated font-display text-2xl text-gold-dim"
            >
              組
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-mono-toile text-[0.65rem] uppercase tracking-widest text-ink-faint">
              {group.factionId && group.faction
                ? mask(group.faction.name, "FAC", group.factionId)
                : "Sans faction"}
            </p>
            <h1 className="font-display text-2xl text-ink">
              {mask(group.name, "GRP", group.id)}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {streamer
                ? "Résidence voilée"
                : [group.primaryVillage, group.primaryCountry].filter(Boolean).join(", ") ||
                  "Résidence non renseignée"}
            </p>
            {group.specialties.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Spécialités">
                {group.specialties.map((specialty) => (
                  <li
                    key={specialty}
                    className="border border-gold-dim bg-gold-faint/30 px-2 py-0.5 text-[0.7rem] text-gold"
                  >
                    {categoryLabel(specialty)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </header>

      {canManage && (
        <section className="mt-5 space-y-4 border border-border-default bg-raised p-5">
          <h2 className="font-display text-sm tracking-widest text-gold uppercase">
            Gestion du groupe
          </h2>
          <GroupEditSection
            groupId={group.id}
            initial={{
              name: group.name,
              primaryCountry: group.primaryCountry ?? "",
              primaryVillage: group.primaryVillage ?? "",
              specialties: group.specialties,
            }}
          />
          {canChangeFaction && (
            <GroupFactionSelect
              groupId={group.id}
              factionId={group.factionId}
              factions={factionOptions}
            />
          )}
          <GroupImageUpload groupId={group.id} />
        </section>
      )}

      <section className="mt-5 border border-border-default bg-raised p-5">
        <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
          Membres ({group.members.length})
        </h2>
        <ul className="space-y-3">
          {group.members.map((member) => {
            const identity = identities.get(member.userId);
            const realLine =
              identity && isRealUserView(identity) && identity.realName
                ? identity.realName
                : null;
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-start justify-between gap-3 border border-border-default bg-elevated p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    {streamer ? maskValue("OPR", member.userId) : member.user.displayName}
                    {member.user.status !== "ACTIVE" && (
                      <span className="ml-2 text-[0.65rem] text-blood-bright uppercase">
                        {member.user.status === "SUSPENDED" ? "suspendu" : "inactif"}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {/* Identité réelle : uniquement pour la modération et les
                        membres de ce groupe (déjà filtrée côté serveur) */}
                    {realLine && !streamer ? `${realLine} — ` : ""}
                    {member.isLeader ? "Chef de groupe" : "Agent"}
                    {member.user.playerLevel ? ` · ${member.user.playerLevel.label}` : ""}
                  </p>
                </div>
                {canManage && !member.isLeader && member.user.status === "ACTIVE" && (
                  <PromoteButton
                    groupId={group.id}
                    userId={member.userId}
                    displayName={member.user.displayName}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
