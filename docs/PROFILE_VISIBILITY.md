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
**jamais sur la seule couleur** — elle porte sur la forme et la longueur :

| État | Rendu | Label accessible |
|---|---|---|
| `???` | **Bande censurée** pleine largeur, fond obsidienne mat, liseré or, blocs `▮▮▮▮` et sceau 封, curseur `not-allowed` | « Information connue mais confidentielle » |
| `Inconnu` | Mention italique discrète, sans cadre ni fond | « Information non renseignée » |
| `Aucun` | Glyphe 無 cuivre + « Aucun » | « Absence confirmée » |
| `Contradictoire` | Cadre rouge sang + ⚠ | « Renseignements contradictoires » |

Une variante `compact` de la bande existe pour les en-têtes et les listes.

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

Vérifié par `apps/web/e2e/profils.spec.ts` : le DOM **et** toutes les réponses
réseau sont inspectés (build de production).

⚠ Rappel : en **mode développement**, React streame des valeurs de débogage.
Les garanties valent pour `next build` + `next start`.

## Matrice des permissions

| Action | Super-mod. | Modérateur | Chef de groupe | Agent |
|---|:--:|:--:|:--:|:--:|
| Voir la liste et les prénoms | ✔ | ✔ | ✔ | ✔ |
| Voir toutes les valeurs | ✔ | ✔ | achat | achat |
| Créer / modifier un dossier | ✔ | ✔ | — | — |
| Portrait (route gardée) | ✔ | ✔ | achat | achat |
| Notes internes, sources, historique | ✔ | ✔ | — | — |
| Demander l'accès pour SON groupe | — | — | ✔ | — |
| Approuver / refuser / révoquer | ✔ | ✔ | — | — |
| Référentiels, fusion, archivage | ✔ | proposer | — | — |

Permissions : `profile.manage`, `profile.intel.view`,
`profile.purchase.review`, `profile.request.create`,
`profile.reference.manage`, `profile.merge`. Toutes vérifiées **côté serveur**.

## Pagination

La liste est paginée par **24 dossiers** (`PROFILE_PAGE_SIZE`) et affiche le
total. Auparavant elle était tronquée à 100 **sans le dire** : au-delà, un
dossier existant devenait introuvable et l'on aurait conclu à une panne de la
recherche plutôt qu'à une limite d'affichage.

Le total est compté avec les mêmes filtres que la liste : il ne révèle jamais
l'existence d'un dossier hors de portée du lecteur.

## Le nom de famille dans la liste

La liste affiche « Akira **Kaguya** » pour un lecteur autorisé, « Akira » seul
sinon. Le nom est un renseignement comme un autre : la clé `lastName` n'existe
**pas** dans la ligne envoyée à un lecteur sans accès (`ProfileListRow`), au
même titre que `value` dans le sérialiseur du dossier. Rien n'est masqué en CSS.

## Anti-fuite par les filtres

Les filtres qui révéleraient une information protégée (faction, clan, état,
grade) ne sont proposés **et appliqués** que pour la modération. Un chef ou un
agent ne dispose que de filtres neutres : recherche par prénom/code, et état
d'accès de ses propres groupes. Un utilisateur ne peut donc pas déduire la
faction d'un dossier par différence de résultats ou par un compteur.

La recherche **par nom de famille** obéit à la même règle : elle n'est ajoutée
à la clause `OR` que pour `viewer.canViewAll`. Sans cette restriction, un
lecteur pourrait deviner un nom protégé par essais successifs en observant les
résultats.

Les filtres s'appliquent **au fil de la frappe** (`ProfileFilters`, temporisation
de 250 ms puis `router.replace`) : l'URL reste partageable, l'historique ne se
remplit pas d'un état par caractère, et le tri des permissions reste entièrement
serveur — le composant n'affiche les filtres sensibles que pour la modération,
mais c'est `listProfiles` qui les ignore pour les autres.

## Relations

Le prénom d'un profil lié reste visible (règle générale), mais le **type** de
relation est « ??? » si le lecteur n'a pas accès au dossier consulté. Le graphe
relationnel est toujours doublé d'une **vue liste** accessible.
