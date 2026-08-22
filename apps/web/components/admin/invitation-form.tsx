"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvitationAction, revokeInvitationAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";

export interface GroupOption {
  id: string;
  name: string;
  factionId: string | null;
  factionName: string | null;
  primaryCountry: string | null;
  primaryVillage: string | null;
  specialties: string[];
  leaderNames: string[];
}

/** Regroupement interne utilisé par la page pour bâtir la liste des groupes. */
export interface FactionOption {
  id: string;
  name: string;
  groups?: GroupOption[];
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrateur",
  moderator: "Modérateur",
  group_leader: "Chef de groupe",
  group_member: "Agent de groupe",
};

/**
 * Formulaire « Tendre un nouveau fil ».
 *
 * L'inviteur fixe la position de l'invité et son grade RP. Le grade est une
 * donnée contrôlée car il participe aux règles d'éligibilité des missions.
 *
 * - `allowedRoles` : rôles que l'inviteur peut accorder (revérifié serveur) ;
 * - `groups` : groupes sélectionnables par la modération ;
 * - `leaderGroups` : si non nul, l'inviteur est un chef — seuls SES groupes
 *   sont proposés.
 */
export function InvitationForm({
  allowedRoles,
  groups,
  leaderGroups,
  factions = [],
  levels,
}: {
  allowedRoles: string[];
  groups: GroupOption[];
  leaderGroups: GroupOption[] | null;
  /** Factions actives — rattachement facultatif du groupe qu'un chef fondera. */
  factions?: { id: string; name: string }[];
  levels: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [roleSlug, setRoleSlug] = useState(allowedRoles[allowedRoles.length - 1] ?? "group_member");
  const [playerLevelId, setPlayerLevelId] = useState(levels[0]?.id ?? "");
  const [groupId, setGroupId] = useState(leaderGroups?.[0]?.id ?? "");
  // Parcours du chef invité : rejoindre un groupe existant ou fonder le sien
  const [leaderMode, setLeaderMode] = useState<"EXISTING_GROUP" | "CREATE_NEW_GROUP">("EXISTING_GROUP");
  // Faction du futur groupe (mode fondation) — vide = aucun rattachement
  const [factionId, setFactionId] = useState("");
  const [hours, setHours] = useState(72);
  const [restrictedDiscordId, setRestrictedDiscordId] = useState("");
  const [note, setNote] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableGroups = leaderGroups ?? groups;
  const selectedGroup = availableGroups.find((g) => g.id === groupId);
  const roleNeedsGroup = roleSlug === "group_leader" || roleSlug === "group_member";
  const isLeaderInvite = roleSlug === "group_leader";
  const creatingNewGroup = isLeaderInvite && !leaderGroups && leaderMode === "CREATE_NEW_GROUP";

  const submit = () => {
    startTransition(async () => {
      const res = await createInvitationAction({
        roleSlug,
        playerLevelId,
        groupId: groupId && !creatingNewGroup ? groupId : undefined,
        factionId: creatingNewGroup && factionId ? factionId : undefined,
        groupOnboardingMode: isLeaderInvite && !leaderGroups ? leaderMode : "NONE",
        expiresInHours: hours,
        restrictedDiscordId: restrictedDiscordId || undefined,
        note: note || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Échec de la création.");
      } else {
        setError(null);
        setInviteUrl(res.inviteUrl ?? null);
        router.refresh();
      }
    });
  };

  const input =
    "w-full border border-border-default bg-elevated px-3 py-2 text-sm text-ink focus:border-gold";
  const label = "mb-1 block text-xs uppercase tracking-wider text-ink-faint";

  return (
    <div className="border border-border-gold bg-raised p-4">
      <h2 className="mb-1 font-display text-sm tracking-widest text-gold uppercase">
        Tendre un nouveau fil
      </h2>
      <p className="mb-3 text-xs text-ink-faint">
        Choisissez son rôle, son grade et, s&rsquo;il y a lieu, le groupe qu&rsquo;il rejoint.
      </p>

      {inviteUrl ? (
        <div className="space-y-3">
          <p className="border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
            Ce lien n&rsquo;apparaîtra qu&rsquo;UNE seule fois. Copiez-le maintenant et
            transmettez-le par un canal sûr.
          </p>
          <code className="block overflow-x-auto border border-border-default bg-elevated p-3 font-mono-toile text-xs text-gold">
            {inviteUrl}
          </code>
          <div className="flex gap-2">
            <Button
              variant="gold"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                setCopied(true);
              }}
            >
              {copied ? "Copié ✓" : "Copier le lien"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setInviteUrl(null); setCopied(false); }}>
              Fermer
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="inv-role" className={label}>Rôle accordé</label>
            <select id="inv-role" value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} className={input}>
              {allowedRoles.map((slug) => (
                <option key={slug} value={slug}>{ROLE_LABELS[slug] ?? slug}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="inv-level" className={label}>Grade du personnage *</label>
            <select
              id="inv-level"
              value={playerLevelId}
              onChange={(event) => setPlayerLevelId(event.target.value)}
              required
              className={input}
            >
              <option value="">— choisir un grade —</option>
              {levels.map((level) => (
                <option key={level.id} value={level.id}>{level.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[0.65rem] text-ink-faint">
              Ce grade initial sera affiché à l&rsquo;invité pendant l&rsquo;onboarding ; il pourra ensuite l&rsquo;ajuster dans « Mes informations ».
              {leaderGroups && " Les invitations créées par un chef utilisent obligatoirement le grade initial."}
            </p>
          </div>

          {/* Chef invité par la modération : rejoindre ou fonder */}
          {isLeaderInvite && !leaderGroups && (
            <fieldset className="sm:col-span-2">
              <legend className={label}>Parcours du chef</legend>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 text-sm text-ink-muted">
                  <input type="radio" name="leader-mode" value="EXISTING_GROUP"
                    checked={leaderMode === "EXISTING_GROUP"}
                    onChange={() => setLeaderMode("EXISTING_GROUP")}
                    className="mt-1 accent-[var(--toile-gold)]" />
                  Ajouter le chef à un groupe existant
                </label>
                <label className="flex items-start gap-2 text-sm text-ink-muted">
                  <input type="radio" name="leader-mode" value="CREATE_NEW_GROUP"
                    checked={leaderMode === "CREATE_NEW_GROUP"}
                    onChange={() => { setLeaderMode("CREATE_NEW_GROUP"); setGroupId(""); }}
                    className="mt-1 accent-[var(--toile-gold)]" />
                  Autoriser le chef à fonder son propre groupe à sa première connexion
                </label>
              </div>
            </fieldset>
          )}

          {leaderGroups ? (
            <div className="sm:col-span-2">
              <label htmlFor="inv-group" className={label}>Groupe rejoint</label>
              <select id="inv-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={input}>
                {leaderGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
          ) : creatingNewGroup ? (
            <div className="space-y-3 sm:col-span-2">
              <p className="border border-border-default bg-elevated px-3 py-2 text-xs text-ink-muted">
                Le chef fondera son groupe lui-même à sa première connexion : il en
                choisira le nom, la résidence et les spécialités.
              </p>
              <div>
                <label htmlFor="inv-faction" className={label}>
                  Faction du futur groupe (facultatif)
                </label>
                <select
                  id="inv-faction"
                  value={factionId}
                  onChange={(e) => setFactionId(e.target.value)}
                  className={input}
                >
                  <option value="">— Aucune —</option>
                  {factions.map((faction) => (
                    <option key={faction.id} value={faction.id}>{faction.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[0.65rem] text-ink-faint">
                  Le rattachement reste modifiable ensuite par la modération.
                </p>
              </div>
            </div>
          ) : (
            <div className="sm:col-span-2">
              <label htmlFor="inv-group" className={label}>
                Groupe {roleNeedsGroup ? "rejoint *" : "rejoint (facultatif)"}
              </label>
              {/* Groupes rassemblés par faction — les sans-faction ferment la liste */}
              <select id="inv-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={input}>
                <option value="">—</option>
                {factions
                  .map((faction) => ({
                    faction,
                    members: groups.filter((group) => group.factionId === faction.id),
                  }))
                  .filter(({ members }) => members.length > 0)
                  .map(({ faction, members }) => (
                    <optgroup key={faction.id} label={faction.name}>
                      {members.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </optgroup>
                  ))}
                {groups.some((group) => group.factionId === null) && (
                  <optgroup label="Sans faction">
                    {groups
                      .filter((group) => group.factionId === null)
                      .map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          {/* Fiche du groupe sélectionné : le modérateur confirme en connaissance */}
          {!leaderGroups && selectedGroup && !creatingNewGroup && (
            <aside className="border border-border-default bg-elevated p-3 text-xs text-ink-muted sm:col-span-2">
              <p className="font-medium text-ink">
                {selectedGroup.name}
                <span className="ml-2 text-ink-faint">
                  · {selectedGroup.factionName ?? "Sans faction"}
                </span>
              </p>
              <p className="mt-1">
                {[selectedGroup.primaryVillage, selectedGroup.primaryCountry]
                  .filter(Boolean)
                  .join(", ") || "Résidence non renseignée"}
              </p>
              {selectedGroup.specialties.length > 0 && (
                <p className="mt-1 text-ink-faint">
                  Spécialités : {selectedGroup.specialties.join(", ")}
                </p>
              )}
              <p className="mt-1 text-ink-faint">
                {selectedGroup.leaderNames.length > 0
                  ? `Chefs actuels : ${selectedGroup.leaderNames.join(", ")}`
                  : "Aucun chef pour l'instant"}
              </p>
            </aside>
          )}

          <div>
            <label htmlFor="inv-hours" className={label}>Validité (heures)</label>
            <input id="inv-hours" type="number" min={1} max={720} value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 72)} className={input} />
          </div>
          <div>
            <label htmlFor="inv-discord" className={label}>Restreindre à un ID Discord</label>
            <input id="inv-discord" value={restrictedDiscordId}
              onChange={(e) => setRestrictedDiscordId(e.target.value)}
              placeholder="Facultatif" className={input} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="inv-note" className={label}>Note interne</label>
            <input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)}
              maxLength={500} className={input} />
          </div>
          <p className="text-xs text-ink-faint sm:col-span-2">
            Le compte sera actif dès que cette invitation aura été validée avec Discord.
          </p>
          {error && <p className="text-xs text-blood-bright sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button
              variant="gold"
              onClick={submit}
              disabled={isPending || !playerLevelId || (roleNeedsGroup && !creatingNewGroup && !groupId)}
            >
              {isPending ? "Tissage…" : "Générer l'invitation"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await revokeInvitationAction(invitationId);
          router.refresh();
        })
      }
    >
      Rompre
    </Button>
  );
}
