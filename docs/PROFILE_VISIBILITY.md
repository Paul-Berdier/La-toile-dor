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

## Anti-fuite par les filtres

Les filtres qui révéleraient une information protégée (faction, clan, état,
grade) ne sont proposés **et appliqués** que pour la modération. Un chef ou un
agent ne dispose que de filtres neutres : recherche par prénom/code, et état
d'accès de ses propres groupes. Un utilisateur ne peut donc pas déduire la
faction d'un dossier par différence de résultats ou par un compteur.

## Relations

Le prénom d'un profil lié reste visible (règle générale), mais le **type** de
relation est « ??? » si le lecteur n'a pas accès au dossier consulté. Le graphe
relationnel est toujours doublé d'une **vue liste** accessible.
