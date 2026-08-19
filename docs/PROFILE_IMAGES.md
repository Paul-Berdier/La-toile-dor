# Images des dossiers — portrait et galerie

## Modèle

`ProfileImage` (`packages/database/prisma/schema.prisma`) : une ligne par image,
**octets en base** (`imageData Bytes`) comme le portrait d'origine et les
preuves de rapport — le système de fichiers de Railway est éphémère et aucun
fournisseur payant n'est ajouté sans accord.

| Colonne | Rôle |
|---|---|
| `type` | `PORTRAIT` (visage, de face), `APPEARANCE` (tenue, déguisement), `EVIDENCE` (preuve rapportée de mission), `OTHER` |
| `isPrimary` | le portrait principal — **un seul vivant par dossier**, garanti par un index partiel SQL (`ProfileImage_one_primary_per_profile`) |
| `caption`, `sortOrder` | légende facultative, ordre d'affichage |
| `sourceMissionId`, `uploadedById` | d'où vient l'image, qui l'a versée |
| `deletedAt` | suppression **logique** : une preuve se retire, elle ne disparaît pas |

L'ancienne colonne `CharacterProfile.imageData` n'est **pas** supprimée : la
migration `20260819110000_dossiers_classe_yeux_galerie` a **copié** chaque
portrait existant dans la galerie comme `PORTRAIT` principal (INSERT … SELECT
rejouable), et la route continue de servir l'ancienne colonne à défaut.
L'écriture ne passe plus que par la galerie.

## Qui fait quoi

| Action | Qui | Où |
|---|---|---|
| Téléverser (glisser-déposer ou fichier), choisir le type, la légende, « portrait principal » | quiconque peut **modifier** le dossier (modération, groupe créateur) | `ProfileGalleryEditor`, `/profils/[id]/modifier` |
| Recadrer un portrait | idem | `ProfileImageUpload` (inchangé ; écrit désormais dans la galerie) |
| Définir le portrait principal, retirer une image | idem | `setPrimaryProfileImageAction`, `deleteProfileImageAction` |
| Voir la galerie, agrandir | quiconque peut **lire** le dossier | `ProfileGallery`, `/profils/[id]` |

Actions : `apps/web/server/profiles/image-actions.ts`. Chacune recharge le
dossier avec `accessTargetSelect` et passe par `decideAccess(...).canEdit`.

## Validation

- Extension **et** signature binaire (`sniffImageMime`) : PNG, JPG/JPEG, WEBP.
  Le type MIME déclaré par le navigateur n'est jamais cru.
- 2 Mo maximum par image (`PROFILE_IMAGE_MAX_BYTES`), 12 images vivantes par
  dossier (`PROFILE_IMAGES_MAX`).
- Le **nom du fichier n'est pas conservé** (il pourrait dire qui a pris la photo) ;
  l'audit ne journalise que type, MIME, taille.
- Premier `PORTRAIT` d'un dossier sans portrait : principal d'office. Retrait du
  principal : le portrait suivant prend la place. Plus aucune image nulle part :
  le champ « Portrait » redevient **Inconnu**.

## Garantie de non-fuite

Sans accès au dossier, **rien** : ni URL, ni identifiant, ni vignette, ni
nombre d'images. Le sérialiseur renvoie `ProfileGalleryView` :

```ts
| { state: "VISIBLE"; images: ProfileImageView[] }  // lecteur autorisé
| { state: "REDACTED" }                              // la Toile a des images, pas lui
| { state: "EMPTY" }                                 // aucune image connue
```

La forme porte la confidentialité : il n'y a pas de tableau à masquer. L'écran
affiche alors un cadre « 封 Image confidentielle ».

Routes gardées (`Cache-Control: private, no-store`, `nosniff`) :

- `GET /api/profils/[id]/image` — portrait principal (galerie, sinon colonne
  d'origine) ;
- `GET /api/profils/[id]/images/[imageId]` — une image de la galerie ; l'image
  doit appartenir à **ce** dossier (pas de traversée).

Les deux utilisent `getApiUser` (onboarding) puis `decideAccess(...).canView`.
Un refus vaut **404**, jamais 403 : l'existence d'une image est déjà un
renseignement. Vérifié par e2e (`dossiers-refonte.spec.ts` : 404 sans accès,
aucun identifiant ni légende dans le DOM ni le réseau, 200 avec accès, 404 en
traversée).

## Fusion et suppression

Fusion de doublons : les images suivent le dossier survivant ; si la cible avait
déjà un portrait principal, celles de la source perdent ce statut. Le portrait
d'origine (colonne) de la source devient une image de galerie si la cible n'en
avait aucune. Suppression d'un dossier : refusée s'il reste des accès **payés**
ou des missions qui le visent (archiver plutôt).
