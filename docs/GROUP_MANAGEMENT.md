# Gestion des groupes

## Fiche d'un groupe

La page `/groupes` affiche tous les groupes actifs à la modération et seulement
les groupes d'appartenance aux autres membres. `/groupes/[id]` présente :

- la faction et le nom du groupe ;
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
complétée et l'absence de groupe déjà dirigé. Le groupe, l'appartenance à la
faction, l'appartenance au groupe et le statut de chef sont créés dans une
transaction.

La permission `group.create` est réservée à la modération pour les futurs flux
de création hors onboarding. Elle ne permet pas de contourner le mode de
l'invitation dans `createOnboardingGroupAction`.

## Modification

Peuvent modifier une fiche :

- un chef de ce groupe précis ;
- la modération avec `group.edit.any`.

Le contrôle est exécuté côté serveur par `canManageGroup`. `group.manage`
reste la permission fonctionnelle des chefs, mais la portée effective est
toujours limitée par leur appartenance `GroupMember.isLeader`.

Le nom est unique au sein d'une faction. Une modification écrit l'événement
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

## Promotion d'un agent

Un chef du groupe ou la modération peut promouvoir un membre actif du même
groupe. L'action demande une confirmation explicite puis met à jour, dans une
transaction :

1. `GroupMember.isLeader` ;
2. `FactionMember.isLeader` ;
3. le rôle applicatif `faction_leader`.

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
- conserver l'unicité `(factionId, name)` lors des créations et renommages.
