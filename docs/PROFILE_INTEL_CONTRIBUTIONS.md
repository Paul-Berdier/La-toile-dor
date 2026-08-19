# Contributions de renseignement

Un lecteur qui **voit** un dossier sans pouvoir le modifier (groupe acquéreur,
groupe engagé en mission) peut **proposer** une information. La modération — ou
le groupe créateur, sur son propre dossier — tranche. Un auteur habilité à
modifier (modération, groupe créateur) écrit directement, et sa contribution
est consignée `APPLIED` : même trace, même historique.

## Modèle

`ProfileIntelContribution` :

| Colonne | Rôle |
|---|---|
| `fieldKey`, `proposedValue` (JSON), `proposedLabel` | le champ et la valeur proposée ; le libellé est calculé à l'écriture pour la revue |
| `knowledgeState` | `KNOWN` avec valeur, ou `NONE_CONFIRMED` (« vérifié : il n'y en a pas ») |
| `confidence`, `note` | confiance déclarée, source/précision |
| `sourceType` | `GROUP`, `USER`, `MISSION` |
| `groupId`, `contributorId`, `sourceMissionId` | au nom de qui, par qui, d'où |
| `status` | `PENDING_REVIEW` → `ACCEPTED` / `MERGED` / `REJECTED` / `CONTRADICTORY` ; ou `APPLIED` d'emblée |
| `conflictsWithExisting` | la valeur en place différait à la soumission — **réservé à la revue** |
| `reviewedById`, `reviewedAt`, `reviewNote` | la décision |

Migration : `20260819120000_dossiers_contributions_renseignement` (additive).

## Forme des valeurs

`packages/shared/src/profile-contributions.ts` — `CONTRIBUTION_VALUE_SCHEMAS`
donne, par champ, le schéma zod de `proposedValue` (identifiants de référentiel,
texte, plage de taille, paire d'iris, techniques…). Tous les champs de dossier
sauf l'image (→ galerie) sont contribuables (`CONTRIBUTABLE_FIELD_KEYS`, testé).

`apps/web/server/profiles/contributions.ts` est le **seul** endroit qui sait
écrire une contribution dans le dossier (`applyContributionValue`) :

- listes de référentiel et techniques : on **ajoute**, on ne retire jamais ;
- textes : `ACCEPT` remplace, `MERGE` concatène (« — Complément : ») ;
- valeurs uniques (nom, faction, taille, âge, iris, classe…) : `ACCEPT` remplace ;
- `NONE_CONFIRMED` vide la valeur et marque le champ « Aucun ».

Chaque application met à jour `CharacterFieldIntel` et laisse une
`CharacterProfileRevision` — comme le formulaire.

> Un champ ajouté aux dossiers doit être traité dans `describeContributionValue`,
> `contributionConflicts` et `applyContributionValue`, sinon la contribution est
> acceptée… et rien ne s'écrit.

## Conflits — jamais révélés au contributeur

À la soumission, `contributionConflicts` compare la proposition à la valeur en
place **si le champ est connu** (listes : jamais de conflit, on ajoute). Le
résultat est stocké dans `conflictsWithExisting` et :

- le contributeur reçoit **le même message** qu'il y ait conflit ou non
  (« Renseignement transmis. La modération le vérifiera ») ;
- `conflictsWithExisting` n'est sérialisé (`ContributionView`) que si
  `access.canEdit` ;
- la valeur en place n'est **jamais** renvoyée dans le résultat de l'action.

Sans cela, proposer des valeurs et regarder lesquelles « passent » permettrait de
sonder un dossier. Vérifié par e2e (`dossiers-refonte.spec.ts`).

## Revue

- Page `/profils/contributions` (modération, `profile.manage`) : file groupée
  par dossier, avec lien vers le dossier.
- Section « Renseignement » du dossier : le groupe créateur tranche ce qu'on
  lui propose ; tout lecteur autorisé voit **ses** contributions et leur sort.
- Décisions : **Accepter** (écrit), **Refuser**, **Marquer contradictoire**
  (le champ passe `CONFLICTING`, les deux versions sont gardées), **Fusionner**
  (textes et listes seulement — `canMergeField`).

Notifications : `PROFILE_CONTRIBUTION_RECEIVED` (modération),
`PROFILE_CONTRIBUTION_REVIEWED` (contributeur : décision et note, pas la valeur
en place), `PROFILE_UPDATED` (groupes détenteurs : le champ, jamais la valeur).

## Missions

Le rapport de fin de mission crée des contributions `MISSION` attribuées au
groupe qui rapporte ; voir `MISSION_REPORTS.md`.
