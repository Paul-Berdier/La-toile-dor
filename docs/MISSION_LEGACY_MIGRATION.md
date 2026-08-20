# Missions antérieures à la refonte — ce qui les attend

**Rien n'a été supprimé.** Les missions déjà écrites fonctionnent telles
quelles : elles s'affichent, se revendiquent, s'attribuent, se rapportent et se
closent exactement comme avant. Ce document dit ce qui reste à régulariser, et
pourquoi on ne l'a pas fait automatiquement.

## Colonnes conservées (LEGACY)

| Colonne | Remplacée par | Encore lue ? |
|---|---|---|
| `Mission.targetIdentity` | liens `role = TARGET` | oui — affichée « Cible(s) — saisie historique » |
| `Mission.targetProfileId` | liens `role = TARGET` | non (les backfills l'ont recopiée dans `MissionTarget`) |
| `Mission.targetFactionId` | dérivée des snapshots des cibles | oui — recalculée à chaque enregistrement |
| `Mission.targetLevelId` | dérivée du grade le plus élevé | oui — **matérialisée**, le filtre du tableau l'interroge en SQL |
| `Mission.clientName` | liens `role = CLIENT` | oui — affichée « Commanditaire — saisie historique » |
| `Mission.clientProfileId` | liens `role = CLIENT` | oui — trace de clôture chez le commanditaire |
| `publicTitle` saisi | `generateMissionPublicTitle` | oui — `titleAuto = false` marque les titres manuels |

Elles seront retirées dans une **migration ultérieure**, une fois le parc
régularisé et la nouvelle voie éprouvée en production. Les retirer aujourd'hui
ferait perdre le nom des cibles des missions jamais reliées.

## Pourquoi aucun rattachement automatique

Une mission dit `targetIdentity = "Akira Hoki"`. Trois dossiers portent ce
prénom. Deviner lequel, sur un contrat d'assassinat, c'est risquer d'attribuer
une mort à la mauvaise personne, d'ouvrir son dossier aux groupes engagés et de
réécrire son état vital à la clôture. On ne devine pas : on relie à la main.

## L'outil : « Missions à régulariser »

`/missions/regulariser` (modération) rassemble les contrats vivants qui portent
au moins un de ces manques :

- une cible ou un commanditaire en **texte libre** sans dossier relié ;
- un **titre écrit à la main** (`titleAuto = false`) ;
- **aucune cible** rattachée à un dossier.

Chaque ligne mène à l'éditeur, où le texte d'origine s'affiche en bandeau et
où les dossiers se rattachent normalement. Une fois relié :

- le titre public se compose seul et `titleAuto` passe à `true` ;
- le niveau de cible et la faction cible se dérivent des snapshots ;
- le rapport de fin de mission sait de qui l'on parle.

Une mission peut rester en l'état indéfiniment : elle fonctionne.

## Ce que la migration a fait, elle

`20260820100000_missions_liens_dossiers_titre_auto` — additive, idempotente,
aucun `DROP` ni `TRUNCATE` :

1. le commanditaire (`clientProfileId`) est devenu un lien `role = CLIENT`,
   marqué principal ;
2. les liens existants ont pris un **snapshot** de l'état **actuel** de leur
   dossier — l'historique du grade n'est pas rejouable, c'est la meilleure
   approximation disponible ; la garde `snapshotAt IS NULL` la rend rejouable
   sans écraser ce qui a été figé depuis ;
3. la plus ancienne cible de chaque mission est devenue la **principale** ;
4. `EligibilityMode.MANUAL_REVIEW` (valeur que l'application ne produit plus)
   est devenu `WARNING` + `requiresEnhancedReview = true` — l'enum garde la
   valeur, la retirer serait destructif.

## Conséquence pour les titres

Les missions historiques gardent leur titre manuel (`titleAuto = false`).
Quand un **super-modérateur** les rouvre, le titre reste imposé (avec sa
justification) ; quand un **modérateur ordinaire** les rouvre, un bandeau
prévient que l'enregistrement le remplacera par le titre calculé. Personne ne
perd un titre sans avoir été averti.
