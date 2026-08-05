# Identité et confidentialité

Ce document décrit le parcours d'identité des membres et la règle de
confidentialité applicable au prénom et au nom de famille.

## Données d'identité

`User` distingue deux niveaux de données :

- le **Titre** public (`displayName`), visible dans l'application ;
- l'identité réelle (`firstName`, `lastName`), confidentielle ;
- le **grade** (`playerLevelId`), public, déclaré par le joueur lui-même.

`firstName` est obligatoire après l'onboarding. `lastName` est facultatif :
l'interface emploie exactement le libellé « Nom de famille — facultatif, votre
personnage peut ne pas en posséder. ».

### Le Titre n'est pas le pseudo Discord

`displayName` est un **Titre de jeu de rôle** — « L'assassin de l'ombre », « La
Vipère de Kiri » — et non le pseudonyme Discord du joueur. C'est la confusion
la plus fréquente à l'inscription, aussi le champ est-il placé **en premier**,
expliqué avec des exemples, et **jamais pré-rempli** avec le nom Discord : un
champ déjà rempli serait validé machinalement, ce qui produirait exactement le
contraire de l'effet recherché.

`displayNameNorm` contient le pseudonyme normalisé (espaces réduits, casse
ignorée) et porte un index unique. Deux variantes telles que `Kitsune` et
` kitsune ` ne peuvent donc pas coexister. La vérification applicative fournit
un message lisible et l'index protège également les écritures concurrentes.

## Onboarding `/bienvenue`

Tout compte dont `profileCompleted` vaut `false` est redirigé vers
`/bienvenue` après la connexion. Le formulaire demande, dans cet ordre :

1. le **Titre** public unique ;
2. le **grade** du personnage ;
3. le prénom ;
4. le nom de famille facultatif ;
5. la confirmation explicite de l'encart de confidentialité.

Le grade est déclaré **par le joueur**, jamais par celui qui l'invite : une
invitation ne porte plus de niveau (`Invitation.playerLevelId` reste nullable
et n'est renseigné que sur les fils historiques). Les positions qui relèvent de
la hiérarchie — rôle et groupe — restent, elles, décidées par l'inviteur.

La date de confirmation est conservée dans `privacyAcknowledgedAt`. Les
prénoms et noms ne sont jamais copiés dans le journal d'audit : l'événement
`profile.identity_completed` ne contient que le Titre public.

Une invitation de chef peut ensuite imposer une seconde étape :

- `EXISTING_GROUP` : le compte rejoint le groupe indiqué par l'invitation ;
- `CREATE_NEW_GROUP` : le chef doit fonder son groupe avant de terminer ;
- `NONE` : aucune étape de groupe supplémentaire.

La création de groupe depuis l'onboarding est autorisée par le mode porté par
l'invitation consommée, et non par un simple bouton côté client. Une invitation
ne peut produire qu'un premier groupe.

La faction éventuellement portée par cette invitation est seulement le
rattachement facultatif du futur groupe. Aucune faction n'est créée
automatiquement et aucune autorité n'en découle.

## Modifier ses informations — `/compte`

Chacun reste maître de sa fiche : `/compte` rejoue les mêmes champs que la
première connexion (Titre, grade, prénom, nom) avec les mêmes règles —
unicité du Titre insensible à la casse, grade existant. `updateOwnIdentityAction`
n'écrit **jamais** sur un autre compte : l'identifiant vient de la session, pas
de l'entrée, et aucune permission n'est requise puisqu'il s'agit de soi.

La case de confidentialité n'est pas rejouée et `privacyAcknowledgedAt` n'est
pas réécrit : l'accord initial reste horodaté à sa date d'origine.

Rôle et groupes figurent sur la page en **lecture seule** : ils relèvent de la
hiérarchie d'invitation. L'audit `profile.identity_updated` ne consigne que le
Titre et le grade — jamais le prénom ni le nom.

## Matrice de visibilité

| Visiteur | Identité réelle de la cible |
|---|---|
| La cible elle-même | Visible |
| Membre d'au moins un même groupe | Visible |
| Détenteur de `identity.view.real` | Visible |
| Tout autre compte | Absente de la réponse |

La règle centrale est `canViewRealIdentity` dans
`packages/shared/src/identity.ts`. Les pages serveur construisent un
`IdentityViewer`, puis passent les utilisateurs à `serializeUserIdentity` ou
`serializeUsersForViewer`.

Le sérialiseur produit l'un des deux DTO suivants :

- vue publique : `id`, `displayName` ;
- vue réelle : les mêmes champs, plus `firstName`, `lastName`, `realName`.

Pour un visiteur non autorisé, les clés `firstName` et `lastName` n'existent
pas. Elles ne sont ni masquées en CSS ni envoyées avec une valeur vide. Toute
nouvelle page affichant des utilisateurs doit utiliser ce sérialiseur et ne
doit pas sélectionner directement l'identité réelle pour la transmettre à un
composant.

## Permission de modération

`identity.view.real` est attribuée par défaut aux rôles `moderator` et
`super_admin`. La co-appartenance à un groupe est une règle métier séparée :
elle ne confère pas cette permission globale.

## Mode Streamer

Le mode Streamer masque également les valeurs visibles pour un utilisateur
autorisé. Il limite les fuites accidentelles à l'écran, mais ne remplace pas le
filtrage serveur décrit ci-dessus.

## Migration des comptes existants

La migration remplit `displayNameNorm` pour les pseudonymes historiques sans
conflit. Les doublons normalisés éventuels restent à résoudre durant
l'onboarding. Aucun compte existant n'est supprimé ; tous repassent
intentionnellement par `/bienvenue` à leur prochaine connexion.

## Vérifications attendues

- tests unitaires de la matrice `canViewRealIdentity` et des clés des DTO ;
- e2e d'un membre de même groupe et de la modération ;
- e2e de non-fuite vers un autre groupe, dans le DOM et les réponses réseau ;
- e2e de pseudonyme dupliqué refusé ;
- exécution des tests de non-fuite sur un build de production.
