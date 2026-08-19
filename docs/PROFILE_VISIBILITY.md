# Visibilité des dossiers — « Inconnu » vs « ??? »

## La distinction fondamentale

| Affichage | Signification | Qui le voit |
|---|---|---|
| **Inconnu** | La Toile ne possède PAS cette information | Tout le monde |
| **???** | La Toile la possède, mais vous n'y avez pas droit | Lecteurs sans accès |
| *valeur* | L'information elle-même | Modération + groupes ayant acheté |
| **Aucun** | Absence **confirmée** (pas de clan, pas d'artefact…) | Lecteurs autorisés — « ??? » sinon, car c'est un acquis |
| **Information contradictoire** | Renseignements incompatibles recueillis | Lecteurs autorisés — « ??? » sinon |

Les textes « Inconnu » et « ??? » ne sont **jamais stockés**. La base contient
la valeur réelle (ou rien) et un **état de connaissance** ; l'affichage est
calculé par `resolveFieldDisplay(knowledge, canView)`
(`packages/shared/src/profile-fields.ts`).

Il est **acceptable** qu'un lecteur déduise qu'une information existe sans
connaître sa valeur : c'est le comportement attendu (§13 du cahier des charges).

## Rendu visuel : la distinction doit être indiscutable

La différence entre « pas d'information » et « information refusée » ne repose
**jamais sur la seule couleur** — elle porte sur les glyphes et la graisse :

| État | Rendu | Label accessible |
|---|---|---|
| `???` | **« ??? »** en chasse fixe dorée, suivi d'un petit sceau 封 — le littéral du produit, partout identique (lignes, cartes, en-têtes, galerie, portrait) | « Information confidentielle » |
| `Inconnu` | Mention italique discrète, sans cadre ni fond | « Information non renseignée » |
| `Aucun` | Glyphe 無 cuivre + « Aucun » | « Absence confirmée » |
| `Contradictoire` | ⚠ rouge sang + « Contradictoire » | « Renseignements contradictoires » |

Le composant unique est `FieldValue` / `Redacted`
(`apps/web/components/profils/field-value.tsx`) — aucun écran ne réécrit le
littéral. Les valeurs VISIBLES portent leur pastille de **confiance** (§47)
lorsque celle-ci n'est pas « Confirmé », avec l'explication en infobulle.

**Dossier ouvert = parchemin.** Un dossier dont le lecteur possède les valeurs
s'affiche sur `bg-parchment` avec titres à l'encre de sceau — même grammaire
que les dossiers de mission : on ouvre un document. Un dossier **scellé**
reste sur panneau sombre : il n'y a rien à lire, et la colonne latérale
affiche le sceau 封, le **nombre de renseignements sous scellé** et, pour un
chef, le dernier tarif consenti à titre indicatif.

## Garantie de non-fuite

Le sérialiseur `serializeDossier` (`apps/web/server/profiles/serializer.ts`)
construit un `ProfileFieldView` par champ. **La clé `value` n'est ajoutée que
lorsque `displayState === "VISIBLE"`** — pour un lecteur non autorisé, la
valeur réelle n'existe pas dans l'objet retourné, donc :

- pas dans le HTML ;
- pas dans les propriétés React ;
- pas dans le payload RSC ;
- pas dans une réponse d'API.

Vérifié par `apps/web/e2e/profils.spec.ts` et `dossiers-refonte.spec.ts` : le
DOM **et** toutes les réponses réseau sont inspectés (build de production), y
compris pour la galerie (aucun identifiant d'image, aucune légende), les
contributions (aucun indicateur de conflit pour le contributeur) et
l'estimation (aucun grade pour un acheteur potentiel).

Même discipline pour la **galerie** (`ProfileGalleryView` : sans accès, il n'y a
pas de tableau `images` — `{ state: "REDACTED" }` tout court) et pour les
**contributions** (`conflictsWithExisting` n'est sérialisé que si
`access.canEdit`). Voir `PROFILE_IMAGES.md` et
`PROFILE_INTEL_CONTRIBUTIONS.md`.

⚠ Rappel : en **mode développement**, React streame des valeurs de débogage.
Les garanties valent pour `next build` + `next start`.

Le « dernier tarif consenti » d'un dossier est réservé à la **modération**
(`lastPrice`) : pour un chef, ce serait un renseignement sur les achats des
autres groupes. Le chef négocie sur l'estimation publique arrondie.

## La règle d'accès est UNIQUE et centralisée

Toute décision « ce lecteur voit-il / modifie-t-il ce dossier ? » est prise par
`packages/shared/src/profile-access.ts` (pur, testé) :

| Fonction | Vrai si… |
|---|---|
| `canViewCharacterProfile(viewer, profile)` | `profile.intel.view` **ou** membre du groupe créateur **ou** octroi actif (`ProfileAccessGrant.revokedAt = null`) pour l'un des groupes du lecteur **ou** dossier cible d'une mission EN COURS attribuée à l'un de ses groupes (`missionTargetProfileIds`) |
| `canEditCharacterProfile` | non archivé **et** (`profile.manage` **ou** membre du groupe créateur) |
| `canContributeToCharacterProfile` | non archivé **et** `canView` |
| `canAdministerCharacterProfile` | `profile.manage` |
| `canCreateCharacterProfile` | `profile.manage` **ou** membre d'au moins un groupe actif |
| `accessOrigin` | pourquoi il voit : `CREATED_BY_GROUP` > `PURCHASED` > `MODERATOR_GRANTED` > `MISSION_GRANTED` > `MISSION_TARGET` (calculée, provisoire) |

### Accès par la mission (`MISSION_TARGET`)

Quand une revendication est **acceptée** (attribution active, mission
`ASSIGNED` ou `IN_PROGRESS`), tous les membres du groupe lisent les dossiers
des **cibles** de la mission — sans achat. Cet accès est **calculé**, jamais
stocké : il naît avec l'attribution, disparaît si elle est retirée, et devient
un octroi durable `MISSION_GRANTED` à la clôture
(`applyMissionOutcomeToProfiles`). Il donne à lire et à **contribuer**, jamais
à modifier la source. L'interface l'étiquette « ⟡ Mission en cours ».
`getProfileViewer` charge ces dossiers une fois par requête
(`missionTargetProfileIds`), et `visibleProfileIds` — l'union créés ∪ octroyés
∪ cibles de mission — est le SEUL ensemble utilisé pour restreindre les listes
et les filtres protégés.

Côté web, `apps/web/server/profiles/access.ts` charge le lecteur une fois par
requête (`getProfileViewer`, groupes **actifs** seulement) et expose
`decideAccess(viewer, target)`. Pages, actions serveur et routes API l'appellent
toutes — aucune ne réimplémente la règle. Les routes API utilisent `getApiUser`
(session valide **et** onboarding terminé), la même garde que les pages.

**L'accès appartient au groupe, pas à la personne** : quitter le groupe fait
perdre l'accès immédiatement ; le rejoindre le rend (e2e
`dossiers-refonte.spec.ts`).

## Ce qu'un lecteur SANS accès reçoit

Exactement quatre vraies valeurs : **code, titre, prénom, nom**. Le nom est
public (`PUBLIC_FIELD_KEYS`) parce qu'il figure dans le titre généré
(« Dossier — Akira Hoki ») ; il garde un état de connaissance (on peut ignorer
un nom) mais vaut **0** au barème. Tout le reste est absent du payload — pas
de `value`, pas d'URL d'image, pas de nombre d'images ni de contributions, pas
de nom de groupe propriétaire, pas de grade dans l'estimation (forme
`{ scope: "public", price }` uniquement).

Trois canaux latéraux sont volontairement brouillés pour ce lecteur :

- **`updatedAt` est tronqué au jour** (liste et détail) : à la minute près,
  croisé avec la clôture d'une mission, il dirait quel renseignement vient
  d'entrer dans un dossier scellé ;
- **l'estimation publique est arrondie au millier** (`≈`) : au palier fin du
  barème, les valeurs de champs étant des multiples ronds, une division
  suffirait à retrouver le multiplicateur de grade — pourtant « ??? » ;
- **`sealedCount` est dérivé du sérialiseur** (nombre de champs `REDACTED` +
  galerie) — la même source de vérité que les « ??? » affichés, donc aucune
  soustraction possible entre deux comptes.

## Matrice des permissions

| Action | Super-mod. | Modérateur | Groupe créateur | Groupe acquéreur (achat / mission close) | Groupe en mission (cible, provisoire) | Sans accès |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Voir la liste : code, titre, prénom, nom | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Voir toutes les valeurs, galerie, historique | ✔ | ✔ | ✔ | ✔ | ✔ (le temps de la mission) | — |
| Ouvrir un dossier (pour son groupe) | ✔ (sans groupe possible) | ✔ | ✔ tout membre | ✔ tout membre | ✔ tout membre | ✔ si membre d'un groupe |
| Modifier le dossier (formulaire, galerie) | ✔ | ✔ | ✔ | — | — | — |
| Proposer un renseignement (contribution) | écrit direct | écrit direct | écrit direct | ✔ → revue | ✔ → revue | — |
| Trancher une contribution | ✔ | ✔ | ✔ (sur son dossier) | — | — | — |
| Notes internes | ✔ | ✔ | — | — | — | — |
| Demander l'accès pour SON groupe | — | — | (déjà propriétaire) | (déjà acquis) | chef ✔ (pour garder après la mission) | chef ✔ |
| Approuver / refuser / révoquer (motivé) | ✔ | ✔ | — | — | — | — |
| Référentiels (dont classes, yeux), fusion, suppression | ✔ | proposer | — | — | — | — |

Permissions : `profile.manage`, `profile.intel.view`,
`profile.purchase.review`, `profile.request.create`,
`profile.reference.manage`, `profile.merge`. Toutes vérifiées **côté serveur**.
L'interface dit toujours **pourquoi** on voit : « ✓ Créé par votre groupe »,
« ✓ Dossier acquis », « ✓ Accès accordé », « ✓ Gagné en mission », ou « 封 Non
acquis ».

## Pagination

La liste est paginée par **24 dossiers** (`PROFILE_PAGE_SIZE`) et affiche le
total. Auparavant elle était tronquée à 100 **sans le dire** : au-delà, un
dossier existant devenait introuvable et l'on aurait conclu à une panne de la
recherche plutôt qu'à une limite d'affichage.

Le total est compté avec les mêmes filtres que la liste : il ne révèle jamais
l'existence d'un dossier hors de portée du lecteur.

## La liste : carte scellée vs carte acquise

La liste affiche pour tous le **titre**, « Prénom Nom » et le code, plus un
**aperçu** de quatre rubriques (classe, grade, faction, yeux) produit par la
même règle que le dossier (`serializePreview`, qui repose sur
`buildFieldView`) : sans accès, chaque rubrique n'est qu'un **état** — « ??? »
ou « Inconnu » — sans valeur ni identifiant dans la charge. Une carte
**scellée** montre une silhouette, ces quatre états, le sceau « 封 Dossier non
acquis » et les actions « Voir » / « Demander l'accès » (l'ancre `#acces` mène
au panneau de demande) ; une carte **acquise** montre le portrait,
« Grade · Classe », la faction, la raison de l'accès (« ✓ Créé par votre
groupe »…) et « Ouvrir le dossier ». `hasVisiblePortrait` n'est vrai que pour
un lecteur autorisé. Rien n'est masqué en CSS : ce qui n'est pas dans la ligne
n'a pas quitté le serveur.

En tête de liste, le résumé (§48) : pour un groupe — dossiers accessibles,
ouverts par ses groupes, acquis, demandes en attente, renseignements
proposés ; pour la modération — dossiers, contributions en attente, conflits
(`?conflits=1` sur la file de revue), demandes d'achat.

## Anti-fuite par les filtres

La recherche textuelle porte sur les **quatre champs publics** (titre, prénom,
nom, code) pour tout le monde — chercher dessus ne révèle rien. Les filtres qui
révéleraient une information protégée (faction, clan, grade, état, portrait,
traits, volume de renseignements) ne sont **proposés** qu'à la modération, et
pour tout autre lecteur `listProfiles` restreint d'abord l'ensemble aux
dossiers qu'il voit déjà (`visibleProfileIds`) avant de filtrer dedans : un
dossier scellé n'est jamais dans la base de recherche d'un filtre protégé,
donc pas de fuite par différence de résultats ni par compteur.

Les filtres s'appliquent **au fil de la frappe** (`ProfileFilters`, temporisation
de 250 ms puis `router.replace`) : l'URL reste partageable, l'historique ne se
remplit pas d'un état par caractère, et le tri des permissions reste entièrement
serveur — le composant n'affiche les filtres sensibles que pour la modération,
mais c'est `listProfiles` qui les ignore pour les autres.

## Relations

Le prénom d'un profil lié reste visible (règle générale), mais le **type** de
relation est « ??? » si le lecteur n'a pas accès au dossier consulté. Le graphe
relationnel est toujours doublé d'une **vue liste** accessible.
