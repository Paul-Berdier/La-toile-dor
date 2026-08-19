import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@toile/database";
import { PERMISSIONS } from "@toile/shared";
import { requireUser } from "@/lib/session";
import { getProfileViewer } from "@/server/profiles/access";
import { loadEditData, loadProfileRefs } from "@/server/profiles/edit-data";
import { ProfileEditForm } from "@/components/profils/edit-form";
import {
  TechniqueManager,
  RelationManager,
  ProfileImageUpload,
} from "@/components/profils/technique-relation";
import { MergePanel } from "@/components/profils/merge-panel";
import { ProfileGalleryEditor } from "@/components/profils/gallery";
import { PROFILE_IMAGE_TYPE_LABELS, type ProfileImageType, type ProfileImageView } from "@toile/shared";

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
  searchParams: Promise<{ mission?: string; section?: string }>;
}) {
  const current = await requireUser();
  const viewer = await getProfileViewer(current);
  // Modération OU groupe créateur : la décision est prise par loadEditData,
  // qui renvoie null à quiconque ne peut pas modifier CE dossier. Un
  // acquéreur atterrit sur le dossier en lecture, pas sur un 404 sec.
  const { id } = await params;
  const { mission, section } = await searchParams;
  // « Modifier » depuis une section du dossier ouvre la section correspondante
  const SECTION_STEPS: Record<string, number> = {
    identite: 0, signalement: 1, affiliation: 2, capacites: 3, combat: 4, analyse: 5,
  };
  const initialStep = section ? (SECTION_STEPS[section] ?? 0) : 0;
  const [editData, refs, profile] = await Promise.all([
    loadEditData(id, viewer),
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
        // Métadonnées seulement : les octets passent par la route gardée
        images: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true, type: true, caption: true, isPrimary: true, sortOrder: true,
            sizeBytes: true, createdAt: true, sourceMission: { select: { code: true } },
          },
        },
      },
    }),
  ]);
  if (!profile) notFound();
  // La garde d'édition est prise par loadEditData (null = pas le droit) ; le
  // reste de la page n'expose rien au-delà de ce que la page de lecture montre.
  if (!editData) redirect(`/profils/${id}`);

  const galleryImages: ProfileImageView[] = profile.images.map((img) => ({
    id: img.id,
    type: img.type as ProfileImageType,
    typeLabel: PROFILE_IMAGE_TYPE_LABELS[img.type as ProfileImageType] ?? img.type,
    caption: img.caption,
    isPrimary: img.isPrimary,
    sortOrder: img.sortOrder,
    sizeBytes: img.sizeBytes,
    createdAt: img.createdAt.toISOString(),
    sourceMissionCode: img.sourceMission?.code ?? null,
  }));

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
        initialStep={initialStep}
        canAdminister={current.permissions.has(PERMISSIONS.PROFILE_MANAGE)}
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="border border-border-default bg-raised p-5">
          <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">
            Techniques propres
          </h2>
          <TechniqueManager
            profileId={id}
            jutsuTypes={refs.jutsuTypes
              .filter((j) => j.isActive)
              .map((j) => ({ id: j.id, label: j.label }))}
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
        <section className="border border-border-default bg-raised p-5 lg:col-span-2">
          <h2 className="mb-3 font-display text-sm tracking-widest text-gold uppercase">Portrait et galerie</h2>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[0.7rem] uppercase tracking-wider text-ink-faint">Portrait recadré</p>
              <ProfileImageUpload profileId={id} />
            </div>
            <div>
              <p className="mb-2 text-[0.7rem] uppercase tracking-wider text-ink-faint">Galerie (apparence, preuves…)</p>
              <ProfileGalleryEditor profileId={id} images={galleryImages} sourceMissionId={mission} />
            </div>
          </div>
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
