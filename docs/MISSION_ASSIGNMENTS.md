# Attributions multi-groupes des missions

Une mission peut être attribuée simultanément à plusieurs groupes. Chaque
participation active est une ligne `MissionAssignment` ; les anciennes colonnes
`Mission.assignedFactionId` et `Mission.assignedGroupId` restent synchronisées
avec le groupe principal pour la compatibilité des lectures historiques.

## Revendication par un chef

Un chef choisit l'un de ses groupes puis sélectionne nominativement les agents
engagés. L'effectif est toujours déduit de cette sélection :

- au moins un agent actif est obligatoire ;
- chaque identifiant est revérifié côté serveur comme membre actuel du groupe ;
- le niveau minimal est vérifié séparément pour chaque agent sélectionné ;
- un niveau absent est un écart distinct d'un niveau insuffisant ;
- reste modifiable, avec le message, tant que la revendication est `PENDING`
  ou `INFO_REQUESTED` ;
- est conservée dans `MissionClaimParticipant`, puis copiée dans
  `MissionParticipant` lors de l'acceptation ;
- reste invisible aux autres joueurs par défaut. Le chef peut décocher la case
  d'invisibilité ; ce consentement est alors copié dans
  `MissionAssignment.publicRoster` lors de l'attribution.

Une revendication n'accorde aucun accès confidentiel. Seule une attribution
active le fait.

Les rôles sont cumulatifs. Un même compte peut être `moderator` et diriger un
ou plusieurs groupes : il conserve alors les outils de création/attribution de
la modération **et** peut revendiquer au nom de chacun de ses groupes actifs.
L'autorité de revendication vient de `GroupMember.isLeader`, relu dans la
transaction ; le simple rôle de modérateur ne permet jamais de représenter un
groupe que l'utilisateur ne dirige pas.

Une mission reste revendicable lorsqu'elle est `ASSIGNED` : un autre groupe
peut proposer sa contribution tant que la mission n'a pas commencé. Un groupe
déjà attribué ne peut pas déposer une seconde revendication, mais un même chef
peut candidater avec un autre groupe qu'il dirige.

## Critères d'éligibilité

Les critères d'une mission décrivent l'**équipe finale**, et non la taille
totale de chaque groupe d'origine :

- `groupSizeMin` et `groupSizeMax` encadrent le nombre total d'agents qui
  participeront, tous les groupes collaborateurs réunis ;
- `minRecommendedLevelId` est comparé au grade de **chaque** agent engagé ;
- seuls les agents nommément sélectionnés entrent dans le calcul ; les autres
  membres de leurs groupes sont ignorés ;
- un agent sans grade produit l'écart `missing_level`, distinct de
  `below_level`.

Le chef voit le bilan évoluer pendant sa sélection : contribution proposée,
fourchette finale, grade minimal et état individuel de chaque agent. Cette
prévisualisation n'est jamais l'autorité finale ; le serveur recalcule tout à
partir des données vivantes.

### Les trois modes

| Mode | Dépôt d'une revendication | Signalement |
|---|---|---|
| **Recommandation** | Toujours possible. | Les écarts restent visibles dans l'interface, mais ne sont ni retournés au chef ni enregistrés sur la revendication. |
| **Avertissement** | Toujours possible. | Les écarts sont montrés au chef et enregistrés pour la modération. |
| **Blocage strict** | Refusé si un agent est sous le grade minimal, si son grade manque ou si la contribution dépasse le maximum. | Les motifs exacts sont renvoyés. |

Le minimum d'effectif est volontairement non bloquant au dépôt, y compris en
mode strict : une petite contribution doit pouvoir être complétée par un autre
groupe. Lors du passage à `IN_PROGRESS`, le calcul est refait sur l'équipe
finale multi-groupes. En mode strict, le démarrage est alors refusé si le total
reste sous le minimum, dépasse le maximum ou contient un agent sans le grade
requis. Dans les deux autres modes, la politique choisie reste non bloquante.

L'ancien mode `MANUAL_REVIEW` n'est plus proposé à la création. La migration
`20260814150000_enhanced_eligibility_review` convertit ces missions en
`WARNING` et active le contrôle renforcé décrit ci-dessous ; la valeur enum est
conservée seulement pour la lecture d'éventuelles données historiques.

### Contrôle renforcé

`Mission.requiresEnhancedReview` est indépendant des trois modes automatiques.
Lorsqu'il est activé, il ne transforme pas un avertissement en blocage de
critères. Il impose une action humaine traçable :

- pour accepter directement une revendication, le modérateur confirme le
  contrôle et fournit une note ;
- toute attribution manuelle, même préparée sans démarrer, exige immédiatement
  la même confirmation et une note ;
- une modification ultérieure de l'équipe déjà en cours réimpose le minimum
  strict et, le cas échéant, un nouveau contrôle renforcé traçable ;
- la note est conservée avec la décision ; confirmation et justification
  figurent aussi dans l'audit d'attribution.

## Attribution par la modération

La modération peut ouvrir la modale depuis le détail d'une mission ou en
déplaçant sa carte vers « En cours ». La modale :

- pré-liste les revendications en attente ;
- permet d'ajouter d'autres groupes depuis le catalogue ;
- affiche les agents proposés par chaque revendication ;
- permet de sélectionner nominativement les agents d'un groupe ajouté manuellement ;
- affiche l'effectif total ;
- permet de désigner au plus un groupe principal ;
- permet d'ajouter une note ;
- n'actualise la carte qu'après le succès serveur.

Le serveur exige `mission.assign` et `mission.move`, vérifie l'existence et
l'activité de chaque groupe, l'appartenance active de chaque agent et son grade
actuel. L'action peut attribuer sans démarrer (`ASSIGNED`) ou attribuer et
démarrer (`IN_PROGRESS`). Une mission ne peut pas passer « En cours » sans au
moins une attribution. Le bilan d'éligibilité porte alors sur l'union des
agents sélectionnés dans toutes les attributions.

Une matrice de transitions est aussi imposée côté serveur : `COMPLETED` et
`FAILED` ne sont accessibles que depuis `IN_PROGRESS`. Un appel direct ne peut
donc ni sauter la validation de l'équipe finale, ni déclencher les points et
ryōs depuis une mission seulement disponible ou attribuée.

## Transaction et concurrence

Le dépôt, l'acceptation d'une revendication et l'attribution manuelle ne font
jamais confiance au bilan précédemment affiché. Dans leur transaction, les
actions relisent :

- le statut et les critères actuels de la mission ;
- le mode d'éligibilité et le contrôle renforcé ;
- l'activité des groupes et l'appartenance de chaque agent ;
- le grade actuel de chaque agent sélectionné.

Elles rappellent ensuite la fonction pure centrale `evaluateTeamEligibility`
avant toute écriture. Ainsi, une revendication restée ouverte ne peut pas être
acceptée sur la base d'un ancien grade ou de critères modifiés. En mode strict,
elle est refusée si les données vivantes comportent désormais un écart
bloquant.

La clôture relit elle aussi, dans une transaction `Serializable`, le statut,
les attributions, les participants et la fourchette de ryōs. Points et ryōs
sont donc calculés sur l'équipe effectivement verrouillée par la clôture, pas
sur un instantané chargé avant une réattribution concurrente.

`claimMissionAction`, `decideClaimAction` et `assignMissionAction` emploient des
transactions `Serializable`. Pour l'attribution, la mise à jour finale inclut
également le statut relu dans sa clause `WHERE` ; si une action concurrente a
modifié la mission, l'opération échoue avec une demande de rechargement.

La base ajoute trois protections :

- une seule attribution active par paire mission/groupe ;
- un seul groupe principal actif par mission ;
- `assignedHeadcount >= 1`.

Une réattribution désactive les groupes retirés sans supprimer leur historique.
Les revendications en attente des groupes retenus passent à `ACCEPTED`.

## Autorité sur les grades

Le grade qui intervient dans l'éligibilité est toujours
`User.playerLevelId` tel qu'il existe en base au moment de la transaction. Un
chef ne transmet jamais lui-même un ordre de grade dans sa revendication et ne
peut pas modifier le grade d'un agent pour rendre son équipe conforme.

Après l'activation du compte, le formulaire personnel exclut le grade. Seule
la gestion des utilisateurs protégée par `user.manage` peut le modifier ; le
nouveau grade doit exister dans `PlayerLevel` et le changement est audité sous
`user.level_updated`. Une correction par la modération peut donc modifier le
bilan d'une revendication encore en attente, ce qui explique la revalidation à
l'acceptation.

## Retour vers « À prendre »

Si une mission attribuée revient à `AVAILABLE`, la modération doit choisir :

- conserver les attributions actives ;
- les retirer, en renseignant `releasedAt` et `releasedReason`.

Le choix n'est jamais implicite. Il est consigné dans l'historique de statut et
le journal d'audit.

## Accès confidentiel et affichage de l'équipe

Ont accès aux détails confidentiels :

- la modération ;
- un membre de l'un des groupes attribués activement ;
- un participant explicite à la mission.

Cet accès général au briefing ne donne pas les mêmes champs à tous :

- avant acceptation, un chef candidat reste en vue `public` et ne reçoit ni le
  nom des cibles, ni leur faction, ni le commanditaire ;
- un agent ou membre d'un groupe attribué reçoit la vue `assigned`, sans ces
  trois champs ;
- le chef d'un groupe attribué reçoit la vue `leader` : noms de la ou des
  cibles et faction cible, mais aucun commanditaire — plus un bloc
  « **Dossiers des cibles** » en lecture seule, avec l'état d'ouverture et le
  lien vers chaque dossier ;
- seule la modération reçoit `clientName`, le commanditaire.

Depuis la refonte de l'éditeur, cibles et commanditaires sont des **dossiers**
(`MISSION_PROFILE_LINKS.md`) : la vue `leader` affiche des cartes portant le
grade, la classe et l'origine **figés à la publication**, jamais l'état actuel
du dossier. Le commanditaire reste réservé à la modération.

**Dossiers des cibles pendant la mission** : dès qu'une attribution est active
(mission `ASSIGNED` / `IN_PROGRESS`), tous les membres du groupe lisent les
dossiers de renseignement des cibles (`MissionTarget.profileId`) — accès
calculé `MISSION_TARGET`, retiré avec l'attribution, transformé en octroi
`MISSION_GRANTED` à la clôture. Voir `PROFILE_VISIBILITY.md`. Conséquence
assumée : l'identité d'une cible fichée est donc visible de tout le groupe via
la liste des dossiers, même si la vue `assigned` du briefing ne nomme pas les
cibles — c'est l'engagement du groupe qui ouvre le renseignement.

`Mission.targetFactionId` désigne la faction RP de la cible. Elle est distincte
de `assignedFactionId`, qui reste une colonne historique liée au groupe
participant.

Le partage d'une faction n'accorde aucune visibilité supplémentaire, même sur
le résumé d'attribution. Les candidats non retenus restent au niveau public.

La visibilité du roster est indépendante pour chaque groupe participant :

- la modération voit toujours tous les groupes et tous les agents ;
- un membre voit toujours le roster de son propre groupe ;
- les autres ne voient rien si le chef a conservé « Équipe invisible » ;
- si le chef a décoché cette case, la vue publique contient uniquement le nom
  du groupe et les `displayName` publics des agents. Niveau, récompenses,
  faction, identité réelle et contenu confidentiel ne sont pas exposés.

## Accomplissement, points et ryō

Au passage à `COMPLETED`, le tisseur choisit le montant exact de ryō dans la
fourchette publique du contrat. La transaction :

- partage les points totaux et les ryō à parts égales entre tous les agents
  engagés, sans perte d'unité lors des arrondis ;
- enregistre chaque part dans `MissionParticipant.pointsAwarded` et
  `MissionParticipant.ryoAwarded` ;
- partage chaque ligne de `MissionScore` entre les groupes proportionnellement
  au nombre de leurs agents engagés ;
- garantit que la somme des parts individuelles et collectives reste exactement
  égale au montant initial.

Le registre reste ajustable par la modération. Un score d'accomplissement
existant empêche tout double crédit.

## Migration des anciennes missions

La migration `20260803150000_identity_groups_multiassign` reconstruit une
attribution principale active pour toute mission encore liée par l'ancienne
colonne `assignedGroupId` et dépourvue d'attribution active. L'effectif repris
est au moins 1 et correspond au minimum de groupe de la mission. Aucune mission
ne perd son groupe historique.

## Audits et notifications

L'audit `mission.assigned` contient les identifiants de groupe, effectifs,
groupe principal et total. Les notifications sont émises après la transaction
et ne sont envoyées qu'aux agents engagés (plus le chef concerné lors de
l'acceptation). Elles ne contiennent que les champs publics de la mission, le
nombre de groupes et l'effectif total.
