# Gains et classement — `/classement`

## Ce que la page répond

« Combien je me suis fait, combien les miens se sont fait. » La page ouvre donc
sur **votre part** — la vôtre, celle de vos groupes, celle de vos factions —
avant tout classement général.

## Deux monnaies, jamais confondues

| Mesure | Origine | Sens |
|---|---|---|
| **Points** | `MissionScore` (registre immuable, par groupe) | le mérite accordé par la Toile — bonus, malus, sanctions comprises |
| **Ryōs** (両) | `MissionParticipant.ryoAwarded` | ce qui a réellement été touché à la résolution |

Les deux ne classent **pas dans le même ordre** — un groupe peut accumuler des
points sans toucher grand-chose, et l'inverse. C'est justement l'information
intéressante, d'où la bascule « Classer par : Points / Ryōs ».

## Il n'existe aucun portefeuille

Les ryōs affichés sont un **cumul de gains**, pas un solde débitable : le
règlement se fait en RP, hors de l'application. `priceRyos` sur les achats de
dossiers relève de la même logique — un montant convenu, consigné, jamais
prélevé. Voir [PROFILE_PURCHASES.md](PROFILE_PURCHASES.md).

## Trois échelles

- **Agents** : somme de leurs parts (`MissionParticipant`) ;
- **Groupes** : points du registre + somme des parts de leurs membres ;
- **Factions** : agrégat de leurs groupes. Les groupes **indépendants** ne sont
  versés dans aucun total de faction — ils restent classés en tant que groupes,
  sans gonfler une maison à laquelle ils n'appartiennent pas.

## Missions comptées

Les statistiques (accomplies, échouées, taux, série) lisent
`MissionAssignment` **sans filtrer sur `active`**. Une assignation est
désactivée *au moment de la résolution* : la filtrer revenait à ne compter
aucune mission terminée, d'où les « 0 accomplies » affichés partout alors que
des missions l'étaient. Une assignation résolue est un fait historique, pas un
état courant.

## Mode Streamer

Les noms d'agents, de groupes et de factions sont remplacés par des codes
(`maskValue`). Les montants restent visibles : ils n'ont rien de secret, et les
masquer priverait la page de son sens en direct.

## Données de démonstration

Le seed distribue des parts sur les missions accomplies — sans elles, tout
resterait à zéro et la moitié du produit ne serait jamais démontrée. Le
reliquat de la division revient au premier participant, si bien que la somme
des parts égale exactement le montant versé.
