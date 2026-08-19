import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { loadEditData, loadProfileRefs } from "@/server/profiles/edit-data";
import { ProfileEditForm } from "@/components/profils/edit-form";
import {
  TechniqueManager,
  RelationManager,
  ProfileImageUpload,
} from "@/components/profils/technique-relation";
import { MergePanel } from "@/components/profils/merge-panel";

export const dynamic = "force-dynamic";

/**
 * Les relations sont stockées sous une forme canonique orientée : « enfant de »
 * est enregistré comme le PARENT_OF de l'autre profil. Le dossier courant peut
 * donc être à la source (`relationsFrom`) OU à la cible (`relationsTo`) ; il
 * faut lire les deux sens, sinon les relations saisies « à l'envers »
 * (enfant, création) disparaissent de l'écran juste après leur création.
 */
const RELATION_LABELS_FROM: Record<string, string> = {
  PARENT_OF: "Parent de",
  CREATOR_OF: "Créateur de",
  SIBLING_OF: "Frère / sœur de",
};
const RELATION_LABELS_TO: Record<string, string> = {
  PARENT_OF: "Enfant de",
  CREATOR_OF: "Création de",
  SIBLING_OF: "Frère / sœur de",
};

export default async function ModifierDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mission?: string }>;
}) {
  const current = await requireUser();
  if (!current.permissions.has(PERMISSIONS.PROFILE_MANAGE)) redirect("/profils");

  const { id } = await params;
  const { mission } = await searchParams;
  const [editData, refs, profile] = await Promise.all([
    loadEditData(id),
    loadProfileRefs(),
    prisma.characterProfile.findUnique({
      where: { id },
      include: {
        techniques: { include: { jutsuType: { select: { label: true } } }, orderBy: { createdAt: "asc" } },
        relationsFrom: {
          include: {
            toProfile: { select: { code: true, characterFirstName: true, archivedAt: true } },
          },
        },
        relationsTo: {
          include: {
            fromProfile: { select: { code: true, characterFirstName: true, archivedAt: true } },
          },
        },
      },
    }),
  ]);
  if (!editData || !profile) notFound();

  const relations = [
    ...profile.relationsFrom
      .filter((rel) => !rel.toProfile.archivedAt)
      .map((rel) => ({
        relationId: rel.id,
        groupLabel: RELATION_LABELS_FROM[rel.type] ?? rel.type,
        relatedName: rel.toProfile.characterFirstName,
        relatedCode: rel.toProfile.code,
      })),
    ...profile.relationsTo
      .filter((rel) => !rel.fromProfile.archivedAt)
      .map((rel) => ({
        relationId: rel.id,
        groupLabel: RELATION_LABELS_TO[rel.type] ?? rel.type,
        relatedName: rel.fromProfile.characterFirstName,
        relatedCode: rel.fromProfile.code,
      })),
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link href={`/profils/${id}`} className="font-mono-toile text-[0.7rem] uppercase tracking-widest text-ink-faint hover:text-gold">
        ← Dossier {profile.code}
      </Link>
      <h1 className="mt-3 font-display text-xl tracking-[0.15em] text-ink uppercase">
        Compléter le dossier {profile.code} — {profile.characterFirstName}
      </h1>
      <p className="mt-1 mb-6 text-xs text-ink-faint">
        Chaque section peut être enregistrée partiellement. Les conflits seront signalés.
      </p>

      <ProfileEditForm
        initial={editData}
        refs={refs}
        sourceMissionId={mission}
        canManageReferences={current.permissions.has(PERMISSIONS.PROFILE_REFERENCE_MANAGE)}
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="border border-border-default bg-raised p-5">
          <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
            Techniques propres
          </h2>
          <TechniqueManager
            profileId={id}
            jutsuTypes={refs.jutsuTypes.map((j) => ({ id: j.id, label: j.label }))}
            techniques={profile.techniques.map((t) => ({
              id: t.id,
              name: t.name,
              typeLabel: t.jutsuType?.label ?? null,
              rank: t.rank,
            }))}
          />
        </section>
        <section className="border border-border-default bg-raised p-5">
          <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
            Réseau relationnel
          </h2>
          <RelationManager profileId={id} relations={relations} />
        </section>
        <section className="border border-border-default bg-raised p-5">
          <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">Portrait</h2>
          <ProfileImageUpload profileId={id} />
        </section>

        {/* Fusion et archivage : super-modérateurs uniquement */}
        {current.permissions.has(PERMISSIONS.PROFILE_MERGE) && (
          <section className="border border-copper/50 bg-raised p-5">
            <h2 className="mb-3 font-display text-sm tracking-widest text-copper uppercase">
              Doublons, archivage et suppression
            </h2>
            <MergePanel
              profileId={id}
              profileCode={profile.code}
              profileName={profile.characterFirstName}
            />
          </section>
        )}
      </div>
    </main>
  );
}
