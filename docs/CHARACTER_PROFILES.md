# Dossiers de renseignement (CharacterProfile)

> Fiches des **personnages du RP** observés par La Toile d'Or. Entité
> strictement distincte du modèle `User` (comptes des joueurs) : ne jamais
> confondre `CharacterProfile.characterFirstName` avec `User.firstName`.

## Principes

- **Seul le prénom est obligatoire.** Tout le reste peut rester inconnu.
- **Titre, prénom et nom sont publics** ; le titre est généré s'il manque
  (« Dossier — Akira Hoki ») et peut être choisi à la création.
- **Un dossier appartient à un groupe** (`createdByGroupId`) — pas à la personne
  qui l'a ouvert. Le groupe reçoit un octroi `CREATED_BY_GROUP` ; tous ses
  membres, présents et futurs, le voient et le complètent. La modération peut
  ouvrir un dossier sans groupe (dossier de la Toile). Voir
  [PROFILE_VISIBILITY.md](PROFILE_VISIBILITY.md) pour la règle d'accès unique.
- Deux dossiers peuvent porter le même prénom — le prénom n'est jamais un
  identifiant. Chaque dossier reçoit `codeNumber` (compteur) et un code
  lisible `PRF-000142` généré automatiquement.
- Aucune information n'est écrasée silencieusement : chaque changement crée
  une ligne `CharacterProfileRevision` (ancienne/nouvelle valeur, auteur,
  mission source, confiance, justification).

## Modèle

| Table | Rôle |
|---|---|
| `CharacterProfile` | Le dossier : identité, titre, groupe créateur, apparence (dont **yeux** : `eyeColorId` + `eyeColorSecondaryId` en hétérochromie, CHECK SQL), **classe** (`ninjaClassId`), affiliation, âge, analyse, notes internes |
| `ProfileImage` | Galerie (portrait principal + pièces) — voir [PROFILE_IMAGES.md](PROFILE_IMAGES.md) |
| `ProfileIntelContribution` | Renseignements proposés par les lecteurs autorisés — voir [PROFILE_INTEL_CONTRIBUTIONS.md](PROFILE_INTEL_CONTRIBUTIONS.md) |
| `CharacterFieldIntel` | **État de connaissance par champ** (`fieldKey` → UNKNOWN/KNOWN/NONE_CONFIRMED/CONFLICTING) + confiance + mission source. L'absence de ligne vaut UNKNOWN |
| `CharacterProfileTrait` | Liaison générique dossier ↔ référentiel (clans, natures, KG, styles, sous-styles, artefacts). Le type vient de l'option : filtrable comme six tables dédiées, sans duplication |
| `CharacterSignatureTechnique` | Techniques propres — jutsu originaux (nom obligatoire, reste facultatif) |
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

- **Qui** : tout membre d'un groupe actif (et la modération). Un seul groupe →
  pré-sélectionné ; plusieurs → à choisir ; aucun → impossible (sauf modération,
  dossier sans propriétaire).
- **Rapide** : bouton « Nouveau dossier » → Prénom (obligatoire), Nom, Titre
  (proposé), Groupe → « Créer rapidement » (ouvre le dossier) ou « Créer et
  compléter » (ouvre le formulaire). Code généré, autres champs UNKNOWN,
  historique de création, octroi `CREATED_BY_GROUP`.
- **Une seule voie d'insertion** : `createOwnedProfile` /
  `createProfileRecord` (`apps/web/server/profiles/create.ts`), utilisée par la
  création rapide, les relations « nouveau proche », les cibles ajoutées depuis
  une mission et les ninjas découverts en rapport.
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
  bouton « Ajouter les renseignements au dossier » ouvre `/profils?mission=…`
  (modération). Les **groupes engagés** passent par le rapport de fin de
  mission en trois étapes — voir [MISSION_REPORTS.md](MISSION_REPORTS.md). La
  mission est enregistrée comme source de chaque champ modifié.

## Qui modifie quoi

- **Modération** : tout, y compris les notes internes.
- **Groupe créateur** : le formulaire complet (sauf notes internes), la galerie,
  les techniques et relations ; il tranche aussi les contributions proposées sur
  son dossier. Page `/profils/[id]/modifier` : `loadEditData(profileId, viewer)`
  renvoie `null` à quiconque ne peut pas modifier — les valeurs et les notes ne
  quittent jamais le serveur pour un lecteur qui ne le pourrait pas.
- **Acquéreur** (achat, mission) : lecture, et **contributions** (« + Ajouter un
  renseignement ») soumises à revue.
- Chaque section du dossier porte un lien « Modifier » qui ouvre la bonne
  rubrique du formulaire (`?section=identite|signalement|affiliation|capacites|combat|analyse`).

## Classe et couleur des yeux

- **Classe** (Soigneur / Traqueur / Ravageur / Défenseur) : référentiel
  `NINJA_CLASS` administrable (pas un enum SQL) — la modération peut renommer
  (le seed ne réécrase pas un libellé modifié, `preserveLabel`) ou ajouter. Une
  seule classe principale en V1. Tarifée au barème comme une aptitude de combat.
- **Couleur des yeux** : référentiel `EYE_COLOR` (Noir, Brun foncé, Brun,
  Noisette, Ambre, Vert, Bleu, Gris, Rouge, Violet, Blanc, Doré, Autre) ; case
  « Couleurs différentes (hétérochromie) » → Œil 1 / Œil 2, affiché « Bleu /
  Vert ». **Un dôjutsu n'est pas une couleur d'yeux** : il se consigne dans les
  techniques de clan. Un seul renseignement « yeux » au barème, quel que soit le
  nombre d'iris.
- Ajouter un champ de dossier impose de toucher **tous** les points de
  couplage : `PROFILE_FIELD_KEYS`/`LABELS`, le sérialiseur (`rawValue`),
  `edit-data.ts` (`inferKnown`, `EditFormData`), le formulaire,
  `DEFAULT_PROFILE_PRICING.fieldValues` (test bloquant si une clé manque),
  `updateProfileAction` (conflits, application, vidage) et les contributions
  (`CONTRIBUTION_VALUE_SCHEMAS`, `describe/conflicts/applyContributionValue`).

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

## Subjutsu, techniques propres et techniques de clan

Trois champs voisins, trois natures différentes :

- **Subjutsu** (`SIGNATURE_TECHNIQUE`) : les techniques notoires du serveur —
  Rasengan, Chidori, Hiraishin, Multi clonage, Rang X, Ermites… Un référentiel
  contrôlé, choisi dans l'étape Capacités comme les Kekkei Genkai.
- **Techniques propres** (`CharacterSignatureTechnique`) : les jutsu originaux
  du personnage, en saisie libre — nom obligatoire, type et rang facultatifs.
- **Techniques de clan** (`CLAN_TECHNIQUE`) : un référentiel contrôlé, car ces
  techniques circulent entre personnages et méritent un libellé stable.

Les techniques propres se saisissent depuis la page du dossier, mais leur
**état** se déclare dans le formulaire, avec les autres champs : sans cela, il
était impossible d'affirmer « la Toile a vérifié, ce personnage n'a aucune
technique propre » — l'absence se confondait avec le simple fait de ne pas
savoir.

Déclarer « Aucun » alors que le dossier liste des techniques ne les efface
pas : ces fiches sont trop riches pour disparaître sur un choix de liste
déroulante. Le serveur renvoie un avertissement et laisse arbitrer.

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
dans l'audit ce qui a disparu (`profile.deleted` : code, prénom, nom). Elle est
**refusée** tant que des groupes ont **payé** l'accès (révoquer avec motif, ou
archiver) ou que des missions visent ou citent le dossier (sinon cibles
fantômes). La fusion, elle, emporte la galerie vers le survivant.

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

## Portrait et galerie

Voir [PROFILE_IMAGES.md](PROFILE_IMAGES.md). Le portrait principal et la galerie
vivent dans `ProfileImage` (octets en base) ; l'ancienne colonne `imageData`
est conservée et encore servie à défaut. Routes gardées, 404 sans accès,
validation par signature binaire, 2 Mo, `private, no-store`.

## Historique et complétude

Tout lecteur **autorisé** voit la section « **Historique du renseignement** »
(timeline : date, champ, confiance, mission source, auteur, justification —
l'auteur et la mission n'étant nommés qu'à la modération ou à l'auteur
lui-même ; jamais les valeurs brutes, qui restent côté modération) et un
**score de complétude** (part des champs connus ou vérifiés absents). Ni l'un
ni l'autre n'est calculé pour un lecteur sans accès : un second compte à côté
du nombre de renseignements scellés parlerait par soustraction. L'état de
connaissance UNKNOWN est représenté par l'**absence** de ligne
`CharacterFieldIntel` (aucun code « UNKNOWN » dans les référentiels classe /
yeux) : les anciens dossiers affichent « Inconnu » sans backfill.

## Notes internes

`internalNotes` n'est jamais inclus dans un dossier acheté : le champ n'est lu
que dans la branche `internal` réservée à la modération.
