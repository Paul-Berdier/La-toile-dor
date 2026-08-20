# Titre public d'une mission — généré, jamais saisi

```
Assassinat · B+ · Konin · Konoha
└ type      └ rang └ grade  └ origine
```

Le tableau des contrats est vu par **tous** les chefs de groupe, y compris ceux
qui ne prendront pas la mission. Un titre écrit à la main y disait tantôt trop
(« Éliminer Akira Hoki du clan Kaguya »), tantôt rien (« Contrat 12 »). Il se
compose désormais tout seul, à partir de quatre segments — et de quatre
seulement.

## Le service

`generateMissionPublicTitle` (`packages/shared/src/mission-title.ts`) est
**pur** : aucune requête, aucune date. Il reçoit le type, le rang, les cibles
et la visibilité de l'origine ; il retourne `{ title, segments }`. Les segments
servent à l'aperçu de l'éditeur, qui montre d'où vient chaque morceau.

| Cas | Segment « niveau » | Segment « origine » |
|---|---|---|
| Une cible | `Konin` | `Konoha` |
| Plusieurs, même grade | `3 cibles · Chunin` | `Konoha` |
| Plusieurs, grades différents | `3 cibles · max Jonin` | `Konoha` |
| Villages différents | — | `multi-origine` |
| Aucun village connu | — | `origine inconnue` |
| Origine masquée (`originVisibility = HIDE`) | — | *(segment absent)* |
| Grade inconnu | `grade inconnu` | — |
| Aucune cible (brouillon) | *(absent)* | *(absent)* |

Le rang porte une **nuance** : `MissionRankModifier` (`NONE` / `PLUS` /
`MINUS`) donne `B`, `B+`, `B-`. C'est un modificateur, pas un septième rang :
sinon `RankConfig`, le barème des points, les seuils d'éligibilité et toutes
les missions déjà écrites devraient connaître douze rangs au lieu de six.

## Ce qui n'entre JAMAIS dans le titre

Prénom, nom, pseudonyme, clan, Kekkei Genkai, image, relation, lieu,
commanditaire, objectif, contrainte. Le titre est **public** ; la cible et le
commanditaire sont **confidentiels**. Le grade et l'origine y figurent parce
que ce sont des mesures d'ampleur — comme le rang — et parce que le niveau de
cible était déjà public avant la refonte (`MissionVisibility.showTargetLevel`).

Un modérateur peut masquer l'origine seule (« Assassinat · B+ · Konin »).

## Stocké, pas seulement calculé

`Mission.publicTitle` conserve le titre. Trois raisons : la recherche
plein-texte l'interroge, Discord et le Kanban le lisent, et une mission
publiée doit garder **son** titre — celui qu'elle avait quand les groupes
l'ont lue.

- **En brouillon** : recalculé à chaque enregistrement.
- **À la publication** : figé avec les snapshots des cibles.
- **Après** : ne bouge que sur action explicite (« Synchroniser la mission »).

`titleAuto = false` marque un titre écrit à la main : c'est le cas de toutes
les missions antérieures à la refonte, et des rares dérogations.

## Dérogation

Un **super-modérateur** (`settings.manage`) peut imposer un titre, avec une
**justification obligatoire** (`titleOverrideReason`), journalisée dans
l'audit. Un bouton « Revenir au titre automatique » annule la dérogation. Un
modérateur ordinaire qui rouvre une mission au titre manuel en est averti :
son enregistrement rendra le titre calculé.

## Vérifié par

`packages/shared/src/mission-title.test.ts` — 12 cas : une cible, plusieurs
cibles de même grade, de grades différents, villages multiples, village
inconnu, origine masquée, brouillon sans cible, nuances de rang.
