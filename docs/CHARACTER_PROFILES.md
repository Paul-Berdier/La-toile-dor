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
- **Doublons** : à la création, les dossiers dont le prénom normalisé
  **commence par** la saisie sont listés en avertissement (« Aki » fait
  ressortir « Akira »). Ni égalité stricte — qui ne signalerait presque
  jamais rien — ni `contains`, qui ferait ressortir « Ran » dans « Kiran » et
  réclamerait une confirmation à presque chaque création, jusqu'à ce que
  l'avertissement soit cliqué sans être lu. La création n'est **jamais
  bloquée** : le modérateur confirme (« Créer quand même »).
- **Dossiers déjà ouverts** : la modale interroge la recherche au fil de la
  frappe et propose d'ouvrir un dossier existant plutôt que d'en créer un
  second — le doublon se repère avant la création, pas dans un message d'erreur
  après coup.
- **Depuis une mission** : sur une mission attribuée/en cours/accomplie, le
  bouton « Ajouter les renseignements au dossier » ouvre `/profils?mission=…`.
  La mission est alors enregistrée comme source de chaque champ modifié.
  Aucune donnée n'est appliquée automatiquement depuis un rapport texte : le
  modérateur saisit et confirme les champs structurés.

## Saisie : un état par champ

Le formulaire d'édition encadre **chaque champ facultatif** d'un sélecteur
d'état — le modérateur n'a jamais à comprendre les codes internes :

| Choix affiché | État stocké | Rendu pour un lecteur autorisé |
|---|---|---|
| Inconnu | `UNKNOWN` | « Inconnu » (pour tous) |
| Valeur connue | `KNOWN` | la valeur |
| Absence confirmée | `NONE_CONFIRMED` | « Aucun » |
| Contradictoire | `CONFLICTING` | « Information contradictoire » |

La zone de saisie reste **accessible** en « Inconnu » comme en « Valeur
connue », et **renseigner un champ le fait passer de lui-même en « connu »**.
Exiger de basculer l'état avant de pouvoir écrire donnait l'impression que le
champ n'existait pas — c'est ce qui faisait croire à l'absence des couleurs de
cheveux et de peau. Un état choisi explicitement (« Absence confirmée »,
« Contradictoire ») n'est jamais promu par une saisie et masque la zone : dans
ces deux cas, il n'y a effectivement rien à écrire. Choisir « Inconnu » ou
« Absence confirmée » **efface** la valeur correspondante côté serveur.

Les référentiels se saisissent par un **sélecteur de recherche** : frappe
tolérante aux accents et à la casse, correspondance sur les **alias**
(« uchiwa » trouve Uchiha), tags retirables, navigation clavier complète
(↑ ↓ Entrée Échap, ⌫ retire le dernier tag), provenance affichée à côté de
chaque entrée. Si une valeur manque, le pied de liste propose « Ajouter … au
référentiel » (détenteurs de `profile.reference.manage`, avec nuancier pour les
couleurs) ou « Proposer … comme nouvelle entrée » — voir
[PROFILE_REFERENCE_DATA.md](PROFILE_REFERENCE_DATA.md).

L'onglet « Source & aperçu » montre le rendu simultané pour un modérateur, un
groupe ayant acheté le dossier et un groupe sans accès — utile pour vérifier
d'un coup d'œil que rien ne fuite.

## Écriture concurrente (verrouillage optimiste)

`CharacterProfile.version` est incrémenté à chaque enregistrement **et relu**.
Le formulaire renvoie la version chargée à l'ouverture ; si elle a bougé,
l'écriture est refusée et rien n'est appliqué.

Sans cela, deux modérateurs complétant le même dossier pendant une même session
RP s'écrasaient en silence — le dernier à enregistrer gagnait, et le premier
n'apprenait jamais que son travail avait disparu.

Deux gardes, pas une seule :

1. un test **précoce**, juste après la lecture du dossier, qui donne un message
   clair ;
2. une garde **atomique** à l'écriture (`updateMany` conditionné sur la
   version, `count !== 1` → transaction annulée), pour la course où l'autre
   enregistrement tombe pendant le traitement.

Côté écran, l'avertissement ne fait perdre aucune saisie : le texte reste à
l'écran, et « Recharger le dossier » déclenche un rechargement **complet**
(l'état du formulaire est initialisé une seule fois — `router.refresh()`
renouvellerait les props sans réinitialiser les champs).

Couvert par l'e2e « deux rédacteurs simultanés : le second n'écrase pas le
premier ».

## Conflits

Quand une nouvelle valeur contredit une information déjà **connue**, le serveur
refuse d'écrire et renvoie la liste des conflits. Le modérateur choisit :

| Choix | Effet |
|---|---|
| Remplacer | La nouvelle valeur devient la valeur courante (ancienne en historique) |
| Conserver | L'ancienne valeur reste ; la nouvelle est consignée en historique |
| Marquer contradictoire | Le champ passe en `CONFLICTING` → « Information contradictoire » |

L'arbitrage d'un conflit **prime** sur l'état affiché dans le formulaire : un
champ marqué contradictoire ne repasse pas en « connu » par effet de bord.

## Fusion (super-modérateurs)

`mergeProfilesAction` déplace vers le dossier cible : traits, techniques,
renseignements absents, historiques, relations, accès et demandes (les doublons
sont neutralisés, pas perdus).

### Les relations se déplacent une par une

`CharacterRelationship` porte `@@unique([fromProfileId, toProfileId, type])`.
Un déplacement en bloc (`updateMany`) violait cette contrainte dès que les deux
dossiers partageaient un lien — or **deux doublons ont presque toujours un
parent ou un frère commun** : c'est souvent ce qui les fait repérer. La fusion
échouait alors sur un `P2002` et toute la transaction était perdue.

Chaque relation est donc réécrite individuellement :

1. les extrémités pointant vers la source sont redirigées vers la cible ;
2. une relation devenue **réflexive** (elle liait les deux dossiers fusionnés)
   est supprimée ;
3. `SIBLING_OF` est **re-canonisée** (`fromProfileId < toProfileId`) : la
   redirection peut casser cet ordre, et la même fratrie existerait sinon sous
   deux formes ;
4. si la cible porte déjà ce lien, le doublon est supprimé plutôt que déplacé.

Couvert par l'e2e « la fusion de deux dossiers ayant un parent commun ne casse
pas ».
Le dossier source devient une **redirection** (`mergedIntoId` + `archivedAt`) :
son ancien code mène toujours au dossier fusionné.

## Archivage et suppression (super-modérateurs)

| Action | Effet | Réversible |
|---|---|---|
| Archiver | `archivedAt` : le dossier quitte les listes, tout est conservé | oui |
| Supprimer | `deleteProfileAction` : disparition définitive | **non** |

L'archivage est la voie normale. La suppression existe pour les dossiers
ouverts par erreur ; elle exige de **recopier le code du dossier** et consigne
dans l'audit ce qui a disparu (`profile.deleted` : code, prénom, nom).

Les dépendances (renseignements, traits, techniques, relations, révisions,
demandes, accès) tombent en cascade. Les doublons qui redirigeaient vers le
dossier supprimé sont **détachés au préalable** (`mergedIntoId` remis à `null`) :
leur clé étrangère est restrictive et bloquerait sinon la suppression.

## Relations : un stockage orienté, deux lectures

Une relation est stockée sous forme **canonique** : « X est enfant de Y » est
enregistré comme le `PARENT_OF` de Y vers X. Un dossier peut donc être à la
source (`relationsFrom`) **ou** à la cible (`relationsTo`), et les deux sens
doivent être lus — sinon les relations saisies « à l'envers » (enfant, création)
disparaissent de l'écran juste après leur création. Les libellés inverses sont
dérivés à la lecture :

| Type stocké | Depuis la source | Depuis la cible |
|---|---|---|
| `PARENT_OF` | Parent de | Enfant de |
| `CREATOR_OF` | Créateur de | Création de |
| `SIBLING_OF` | Frère / sœur de | Frère / sœur de |

## Portrait

Stocké en base (`imageData` / `imageMime`) comme les emblèmes de groupe — le
système de fichiers Railway est éphémère. Servi par `/api/profils/[id]/image`,
qui **revérifie les droits** : un portrait connu mais non acheté renvoie 404,
jamais l'image. Formats PNG/JPEG/WEBP validés par **signature binaire**
(le type déclaré ne suffit pas), 500 Ko maximum, cache `private, no-store`.

## Notes internes

`internalNotes` n'est jamais inclus dans un dossier acheté : le champ n'est lu
que dans la branche `internal` réservée à la modération.
