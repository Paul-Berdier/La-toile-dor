# Identité et confidentialité

Ce document décrit le parcours d'identité des membres et la règle de
confidentialité applicable au prénom et au nom de famille.

## Données d'identité

`User` distingue deux niveaux de données :

- le **Titre** public (`displayName`), visible dans l'application ;
- l'identité réelle (`firstName`, `lastName`), confidentielle ;
- le **grade** (`playerLevelId`), public et contrôlé, car il intervient dans
  l'éligibilité aux missions.

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
2. le **grade** du personnage, affiché en lecture seule ;
3. le prénom ;
4. le nom de famille facultatif ;
5. la confirmation explicite de l'encart de confidentialité.

Toute nouvelle invitation porte obligatoirement le grade choisi par l'inviteur
autorisé. Le serveur vérifie qu'il existe dans `PlayerLevel`, l'applique au
compte pendant le parcours d'invitation, puis `/bienvenue` le présente sans
commande de modification. Une requête client altérée ne peut pas le remplacer.

Une exception assure la reprise des anciens comptes : si `playerLevelId` est
encore nul, `/bienvenue` affiche le référentiel et permet au joueur de déclarer
son grade **une seule fois**. L'écriture est conditionnelle dans une transaction
afin qu'une attribution concurrente par la modération ne puisse pas être
écrasée. Dès qu'un grade existe, cette exception disparaît.

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

Chacun reste maître de son Titre, de son prénom, de son nom et de la portée de
son identité réelle. `/compte` affiche aussi le grade actuel, mais uniquement
en lecture seule. `updateOwnIdentityAction` n'accepte aucun `playerLevelId` et
n'écrit **jamais** sur un autre compte : l'identifiant vient de la session, pas
de l'entrée, et aucune permission n'est requise puisqu'il s'agit de soi.

Après l'onboarding, seule la gestion des utilisateurs protégée par
`user.manage` peut modifier le grade. `setUserLevelAction` valide la référence
`PlayerLevel`, conserve l'ancien et le nouvel identifiant dans l'audit
`user.level_updated`, puis rafraîchit l'administration. Le joueur doit donc
s'adresser à la modération pour toute correction ou évolution de grade.
Un chef qui invite un agent utilise obligatoirement le grade initial le plus
bas ; la modération peut ensuite attribuer un grade supérieur. Le formulaire
filtre la liste et l'action serveur revérifie cette borne.

La case de confidentialité n'est pas rejouée et `privacyAcknowledgedAt` n'est
pas réécrit : l'accord initial reste horodaté à sa date d'origine.

La page porte aussi le choix de **qui peut voir son nom** (voir la matrice
ci-dessous). Chaque option affiche sa conséquence en clair plutôt qu'un
libellé technique : quelqu'un doit pouvoir décider sans connaître le modèle de
données.

Grade, rôle et groupes figurent sur la page en **lecture seule** : ils relèvent
de la hiérarchie et de la modération. L'audit `profile.identity_updated` ne
consigne que le Titre et la portée choisie — jamais le grade, le prénom ni le
nom. Les changements de grade suivent leur événement séparé
`user.level_updated`. La portée figure dans l'audit d'identité parce que c'est
une décision de confidentialité, et que savoir quand elle a changé peut compter.

## Matrice de visibilité

La portée du prénom et du nom est **choisie par l'intéressé**
(`User.identityVisibility`), sur la page « Mes informations ».

| Choix | Qui voit le prénom et le nom |
|---|---|
| `MODERATORS` | la modération seule — pas même ses coéquipiers |
| `MY_GROUPS` (défaut) | + les membres de ses propres groupes |
| `EVERYONE` | + tout membre autorisé de la Toile |

Deux accès ne dépendent **jamais** de ce choix :

| Visiteur | Identité réelle de la cible |
|---|---|
| La cible elle-même | Toujours visible |
| Détenteur de `identity.view.real` | Toujours visible — la modération doit pouvoir arbitrer, et l'intéressé en est informé au moment où il choisit |
| Tout autre compte | Selon le choix ci-dessus ; sinon **absente de la réponse** |

`MY_GROUPS` est la valeur par défaut en base : les comptes créés avant ce
réglage ne voient aucun changement tant qu'ils n'ont rien décidé.

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
