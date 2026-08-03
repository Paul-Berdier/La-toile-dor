"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvitationAction, revokeInvitationAction } from "@/server/admin-actions";
import { Button } from "@/components/ui/button";

export interface FactionOption {
  id: string;
  name: string;
  groups: { id: string; name: string }[];
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrateur",
  moderator: "Modérateur",
  faction_leader: "Chef de groupe / faction",
  faction_member: "Agent",
};

/**
 * Formulaire « Tendre un nouveau fil ».
 * - `allowedRoles` : rôles que l'inviteur a le droit d'accorder (recalculé
 *   côté serveur de toute façon) ;
 * - `factions` : factions + groupes sélectionnables (modération) ;
 * - `leaderGroups` : si non nul, l'inviteur est un chef — seul le choix
 *   parmi SES groupes est proposé.
 */
export function InvitationForm({
  allowedRoles,
  factions,
  leaderGroups,
}: {
  allowedRoles: string[];
  factions: FactionOption[];
  leaderGroups: { id: string; name: string; factionName: string }[] | null;
}) {
  const router = useRouter();
  const [roleSlug, setRoleSlug] = useState(allowedRoles[allowedRoles.length - 1] ?? "faction_member");
  const [factionId, setFactionId] = useState("");
  const [groupId, setGroupId] = useState(leaderGroups?.[0]?.id ?? "");
  const [hours, setHours] = useState(72);
  const [requireApproval, setRequireApproval] = useState(true);
  const [restrictedDiscordId, setRestrictedDiscordId] = useState("");
  const [note, setNote] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedFaction = factions.find((f) => f.id === factionId);
  const roleNeedsFaction = roleSlug === "faction_leader" || roleSlug === "faction_member";

  const submit = () => {
    startTransition(async () => {
      const res = await createInvitationAction({
        roleSlug,
        factionId: !leaderGroups && roleNeedsFaction && factionId ? factionId : undefined,
        groupId: roleNeedsFaction && groupId ? groupId : undefined,
        expiresInHours: hours,
        requireApproval,
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
        L&rsquo;invité déclinera son titre RP et son village avant de lier son compte Discord.
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
          <div>
            <label htmlFor="inv-role" className={label}>Rôle accordé</label>
            <select id="inv-role" value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} className={input}>
              {allowedRoles.map((slug) => (
                <option key={slug} value={slug}>{ROLE_LABELS[slug] ?? slug}</option>
              ))}
            </select>
          </div>

          {leaderGroups ? (
            <div>
              <label htmlFor="inv-group" className={label}>Groupe rejoint</label>
              <select id="inv-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} className={input}>
                {leaderGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.factionName} — {group.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            roleNeedsFaction && (
              <>
                <div>
                  <label htmlFor="inv-faction" className={label}>Faction / organisation</label>
                  <select
                    id="inv-faction"
                    value={factionId}
                    onChange={(e) => { setFactionId(e.target.value); setGroupId(""); }}
                    className={input}
                  >
                    <option value="">—</option>
                    {factions.map((faction) => (
                      <option key={faction.id} value={faction.id}>{faction.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="inv-group" className={label}>Groupe (facultatif)</label>
                  <select
                    id="inv-group"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    className={input}
                    disabled={!selectedFaction}
                  >
                    <option value="">—</option>
                    {selectedFaction?.groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )
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
          <label className="flex items-center gap-2 text-sm text-ink-muted sm:col-span-2">
            <input type="checkbox" checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              className="accent-[var(--toile-gold)]" />
            Exiger une approbation manuelle après la connexion Discord
          </label>
          {error && <p className="text-xs text-blood-bright sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button variant="gold" onClick={submit} disabled={isPending}>
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
