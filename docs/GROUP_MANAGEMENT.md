# Gestion des groupes

## Fiche d'un groupe

La page `/groupes` affiche tous les groupes actifs à la modération et seulement
les groupes d'appartenance aux autres membres. La fiche `/groupes/[id]` suit la
même autorisation : connaître ou deviner son identifiant ne donne aucun accès
à un tiers. La visibilité publique éventuelle d'une équipe reste limitée à la
mission où le chef l'a expressément autorisée.

La fiche présente :

- le nom du groupe et sa faction éventuelle ;
- le pays et le village principaux de résidence ;
- les spécialités ;
- l'image ou l'emblème de remplacement ;
- les membres, leur niveau et leur statut de chef.

Les spécialités partagent le référentiel `MissionCategory` avec les missions,
y compris Infiltration, Traque, Contre-espionnage et Guerre.

## Création

Un chef invité peut recevoir l'un des parcours suivants :

- rejoindre un groupe existant (`EXISTING_GROUP`) ;
- fonder son groupe pendant l'onboarding (`CREATE_NEW_GROUP`).

Dans le second cas, le serveur vérifie l'invitation consommée, l'identité déjà
complétée et l'absence de groupe déjà dirigé. Le groupe, l'appartenance au
groupe et le statut de chef sont créés dans une transaction. La faction portée
par l'invitation est facultative ; sans elle, aucune faction homonyme n'est
créée implicitement.

La permission `group.create` permet à la modération de créer un groupe avec ou
sans faction. Elle ne permet pas de contourner le mode de l'invitation dans
`createOnboardingGroupAction`.

## Groupes et factions

Le groupe est l'unité d'appartenance, d'autorité, de confidentialité et de
score. Une faction (`Suna`, `Konoha`, `Ame`...) est seulement un rattachement
facultatif de `Group.factionId` :

- un groupe peut n'appartenir à aucune faction ;
- une personne n'obtient aucun droit parce qu'un autre groupe partage sa faction ;
- il n'existe aucun rôle applicatif de chef de faction ;
- la modération peut attacher ou détacher un groupe, avec audit
  `group.faction_changed` ;
- l'ancienne table `FactionMember` est conservée uniquement pour compatibilité
  de migration et n'est plus consultée par l'application.

## Modification

Peuvent modifier une fiche :

- un chef de ce groupe précis ;
- la modération avec `group.edit.any`.

Le contrôle est exécuté côté serveur par `canManageGroup`. `group.manage`
reste la permission fonctionnelle des chefs, mais la portée effective est
toujours limitée par leur appartenance `GroupMember.isLeader`.

Le nom est unique au sein d'un même rattachement (même faction ou ensemble des
groupes sans faction). Une modification écrit l'événement
`group.updated` avec les anciennes et nouvelles valeurs utiles.

## Image

L'image est stockée dans PostgreSQL (`imageData`, `imageMime`) parce que le
disque du conteneur Railway est éphémère. Les règles sont :

- 500 Ko maximum ;
- PNG, JPEG ou WEBP ;
- type détecté par signature binaire, sans faire confiance au nom de fichier
  ni au type MIME déclaré ;
- lecture via la route authentifiée `/api/groupes/[id]/image` ;
- aperçu local avant envoi.

Une modification produit l'audit `group.image_changed` avec le type détecté et
la taille, jamais le contenu binaire.

## Membres et identités

La liste affiche toujours le pseudonyme public. Le prénom et le nom sont
ajoutés seulement après passage dans le sérialiseur central d'identité : même
groupe, propre identité ou permission `identity.view.real`. Voir
`IDENTITY_AND_PRIVACY.md`.

Avant la fin de `/bienvenue`, le nom Discord provisoire d'un invité n'est pas
affiché aux membres ordinaires. Seuls le chef du groupe et la modération le
voient afin de pouvoir administrer l'arrivée.

Un utilisateur peut appartenir à plusieurs groupes : `GroupMember` est
identifié par le couple `(groupId, userId)`. Depuis `/admin/utilisateurs`, un
super-administrateur peut ajouter ou retirer un compte actif de plusieurs
groupes. L'ajout ne crée aucune appartenance de faction. Un chef ne peut pas être retiré par cette case
générique afin de ne pas laisser un rôle de direction incohérent.

Cette gestion est volontairement protégée par `user.manage` : un modérateur
peut être membre de plusieurs groupes, mais ne peut pas s'y ajouter lui-même.
Les événements `group.member_added` et `group.member_removed` sont audités.

Le niveau RP (`PlayerLevel`) est choisi dès la création de l'invitation et
appliqué au compte dans la transaction OAuth. La gestion des utilisateurs
permet de corriger le niveau des comptes historiques ; la migration attribue
provisoirement le niveau le plus bas aux anciennes fiches qui n'en avaient pas.
Un chef peut inviter un agent au grade initial le plus bas ; seule la modération
peut attribuer un grade supérieur ou corriger ensuite le grade.

## Promotion d'un agent

Un chef du groupe ou la modération peut promouvoir un membre actif du même
groupe. L'action demande une confirmation explicite puis met à jour, dans une
transaction :

1. `GroupMember.isLeader` ;
2. le rôle applicatif `group_leader`.

Les permissions sont relues à chaque requête et deviennent donc effectives
immédiatement. L'événement `group.member_promoted` ne contient que l'identifiant
et le pseudonyme public de la cible. Une notification `MEMBER_PROMOTED` est
également créée.

La promotion conserve l'historique d'appartenance : le membre n'est ni retiré
ni recréé.

## Invariants d'exploitation

- ne jamais autoriser une édition sur la seule présence du bouton client ;
- ne jamais stocker les images sur le système de fichiers Railway ;
- ne jamais inclure prénom ou nom dans les audits et notifications ;
- utiliser le référentiel partagé des catégories pour les spécialités ;
- conserver l'unicité du nom dans un même rattachement, y compris quand
  `factionId` vaut `NULL` ;
- ne jamais déduire une permission, une notification ou une visibilité d'une
  faction partagée.
