# Dossiers de renseignement (CharacterProfile)

> Fiches des **personnages du RP** observés par La Toile d'Or. Entité
> strictement distincte du modèle `User` (comptes des joueurs) : ne jamais
> confondre `CharacterProfile.characterFirstName` avec `User.firstName`.

## Principes

- **Seul le prénom est obligatoire.** Tout le reste peut rester inconnu.
- Deux dossiers peuvent porter le même prénom — le prénom n'est jamais un
  identifiant. Chaque dossier reçoit `codeNumber` (compteur) et un code
  lisible `PRF-000142` généré automatiquement.
- Aucune information n'est écrasée silencieusement : chaque changement crée
  une ligne `CharacterProfileRevision` (ancienne/nouvelle valeur, auteur,
  mission source, confiance, justification).

## Modèle

| Table | Rôle |
|---|---|
| `CharacterProfile` | Le dossier : identité, apparence, affiliation, âge, analyse, notes internes |
| `CharacterFieldIntel` | **État de connaissance par champ** (`fieldKey` → UNKNOWN/KNOWN/NONE_CONFIRMED/CONFLICTING) + confiance + mission source. L'absence de ligne vaut UNKNOWN |
| `CharacterProfileTrait` | Liaison générique dossier ↔ référentiel (clans, natures, KG, styles, sous-styles, artefacts). Le type vient de l'option : filtrable comme six tables dédiées, sans duplication |
| `CharacterSignatureTechnique` | « Subjutsu » — techniques propres (nom obligatoire, reste facultatif) |
| `CharacterRelationship` | Relations sous forme **canonique** (`PARENT_OF`, `CREATOR_OF`, `SIBLING_OF` ordonné) |
| `CharacterProfileRevision` | Historique champ par champ |
| `ProfileReferenceOption` / `Suggestion` | Référentiels contrôlés — voir [PROFILE_REFERENCE_DATA.md](PROFILE_REFERENCE_DATA.md) |
| `ProfilePurchaseRequest` / `ProfileAccessGrant` | Achat par groupe — voir [PROFILE_PURCHASES.md](PROFILE_PURCHASES.md) |

### Relations : inverses dérivées, jamais dupliquées

Une seule ligne est stockée par lien. Les inverses sont **calculées à la
lecture** — impossible de désynchroniser une paire :

```
A PARENT_OF B    → A voit « Enfants : B », B voit « Parents : A »
A CREATOR_OF B   → A voit « Créations : B », B voit « Créateurs : A »
A SIBLING_OF B   → symétrique (fromId < toId imposé par le service)
```

Garde-fous SQL : `CHECK (fromProfileId <> toProfileId)` et unicité
`(fromProfileId, toProfileId, type)`.

### Taille

Toujours une plage en centimètres (`heightMinCm`, `heightMaxCm`), jamais une
chaîne. `CHECK (min <= max)`. Affichage : « 185 cm », « Entre 180 et 190 cm »,
« Plus de 180 cm », ou l'état de connaissance.

## Création

- **Rapide** : bouton « Nouveau profil » → prénom seul → code généré, tous les
  autres champs UNKNOWN, historique de création, dossier visible immédiatement.
- **Doublons** : à la création, les dossiers au prénom normalisé identique sont
  listés en avertissement. La création n'est **jamais bloquée** — le modérateur
  confirme (« Créer quand même »).
- **Depuis une mission** : sur une mission attribuée/en cours/accomplie, le
  bouton « Ajouter les renseignements au dossier » ouvre `/profils?mission=…`.
  La mission est alors enregistrée comme source de chaque champ modifié.
  Aucune donnée n'est appliquée automatiquement depuis un rapport texte : le
  modérateur saisit et confirme les champs structurés.

## Conflits

Quand une nouvelle valeur contredit une information déjà **connue**, le serveur
refuse d'écrire et renvoie la liste des conflits. Le modérateur choisit :

| Choix | Effet |
|---|---|
| Remplacer | La nouvelle valeur devient la valeur courante (ancienne en historique) |
| Conserver | L'ancienne valeur reste ; la nouvelle est consignée en historique |
| Marquer contradictoire | Le champ passe en `CONFLICTING` → « Information contradictoire » |

## Fusion (super-modérateurs)

`mergeProfilesAction` déplace vers le dossier cible : traits, techniques,
renseignements absents, historiques, relations (les réflexives sont
supprimées), accès et demandes (les doublons sont neutralisés, pas perdus).
Le dossier source devient une **redirection** (`mergedIntoId` + `archivedAt`) :
son ancien code mène toujours au dossier fusionné.

## Portrait

Stocké en base (`imageData` / `imageMime`) comme les emblèmes de groupe — le
système de fichiers Railway est éphémère. Servi par `/api/profils/[id]/image`,
qui **revérifie les droits** : un portrait connu mais non acheté renvoie 404,
jamais l'image. Formats PNG/JPEG/WEBP validés par **signature binaire**
(le type déclaré ne suffit pas), 500 Ko maximum, cache `private, no-store`.

## Notes internes

`internalNotes` n'est jamais inclus dans un dossier acheté : le champ n'est lu
que dans la branche `internal` réservée à la modération.
