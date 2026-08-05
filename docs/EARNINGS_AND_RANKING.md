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

## Ce que vaut un dossier

Le prix d'un dossier n'est pas une constante du produit : ce qu'une faiblesse
vaut face à un Kekkei Genkai relève de l'équilibre du serveur. La modération
règle donc le barème dans `/admin/configuration`, et le calcul lui-même vit
dans `packages/shared/src/profile-pricing.ts` — pur, testé, rejouable.

Le principe tient en une phrase : **on paie ce qui sert à agir**.

| Poste | Défaut | Pourquoi |
|---|---:|---|
| Faiblesses | 2 500 | le plus cher — c'est ce qui décide d'un combat |
| Kekkei Genkai | 2 000 | rare et déterminant |
| Techniques de clan | 1 600 | savoir qu'un non-membre les porte vaut cher |
| Forces, artefacts | 1 500 | |
| Subjutsu | 1 400 | |
| Styles, natures | 1 000–1 200 | |
| Clan, faction, grade | 700–900 | sert à trouver, pas à vaincre |
| Portrait | 900 | reconnaître quelqu'un a un prix |
| Apparence (taille, cheveux, peau) | 100–200 | complète, ne décide rien |
| Parenté | 400 par lien, 8 au plus | |

À quoi s'ajoutent un **prix plancher** (ouvrir un dossier a déjà coûté), un
**multiplicateur de grade** (`1 + (rang − 1) × pas`, plafonné — le dossier d'un
Kage n'a pas le prix de celui d'un apprenti) et un **multiplicateur global**
pour l'inflation du serveur. Le taux `ryosPerPoint` convertit la valeur en
points de mérite.

Seuls les renseignements **acquis** (`KNOWN`) se facturent : une absence
confirmée ou une contradiction sont utiles, mais ce n'est pas ce qu'on achète.

Le prix s'affiche avec son **détail** : un prix qu'on ne peut pas expliquer ne
se négocie pas. Et il reste un **conseil** — la modération fixe le montant.

## Dépenses

Le classement affiche, sous les gains d'un groupe, ce qu'il a engagé en achats
de dossiers (somme des `priceRyos` de ses accès). Ce n'est **pas** un solde :
les gains ne sont pas diminués, rien n'est bloqué si le montant dépasse ce que
le groupe a touché.

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
