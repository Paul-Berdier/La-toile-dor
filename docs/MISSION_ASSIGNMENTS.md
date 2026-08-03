# Attributions multi-groupes des missions

Une mission peut être attribuée simultanément à plusieurs groupes. Chaque
participation active est une ligne `MissionAssignment` ; les anciennes colonnes
`Mission.assignedFactionId` et `Mission.assignedGroupId` restent synchronisées
avec le groupe principal pour la compatibilité des lectures historiques.

## Revendication par un chef

Un chef choisit l'un de ses groupes et propose un effectif avec sa
revendication. L'effectif :

- est un entier d'au moins 1 ;
- ne peut pas dépasser l'effectif réel du groupe ;
- reste modifiable, avec le message, tant que la revendication est `PENDING`
  ou `INFO_REQUESTED` ;
- est repris comme effectif attribué lors de l'acceptation.

Une revendication n'accorde aucun accès confidentiel. Seule une attribution
active le fait.

## Attribution par la modération

La modération peut ouvrir la modale depuis le détail d'une mission ou en
déplaçant sa carte vers « En cours ». La modale :

- pré-liste les revendications en attente ;
- permet d'ajouter d'autres groupes depuis le catalogue ;
- demande un effectif par groupe ;
- affiche l'effectif total ;
- permet de désigner au plus un groupe principal ;
- permet d'ajouter une note ;
- n'actualise la carte qu'après le succès serveur.

Le serveur exige `mission.assign` et `mission.move`, vérifie l'existence et
l'activité de chaque groupe, puis borne chaque effectif à son nombre réel de
membres. L'action peut attribuer sans démarrer (`ASSIGNED`) ou attribuer et
démarrer (`IN_PROGRESS`). Une mission ne peut pas passer « En cours » sans au
moins une attribution.

## Transaction et concurrence

`assignMissionAction` relit le statut dans la transaction. La mise à jour finale
inclut le statut lu dans sa clause `WHERE` ; si un autre modérateur a modifié la
mission entre-temps, l'opération échoue avec une demande de rechargement.

La base ajoute trois protections :

- une seule attribution active par paire mission/groupe ;
- un seul groupe principal actif par mission ;
- `assignedHeadcount >= 1`.

Une réattribution désactive les groupes retirés sans supprimer leur historique.
Les revendications en attente des groupes retenus passent à `ACCEPTED`.

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

Les membres d'une faction concernée peuvent voir le résumé d'attribution prévu
par l'interface, sans obtenir pour autant le DTO confidentiel. Les candidats
non retenus restent au niveau public.

## Accomplissement et points

Au premier passage à `COMPLETED`, chaque groupe participant reçoit ses propres
lignes de `MissionScore` pour le barème automatique. Le registre reste
ajustable ensuite par la modération. La présence d'un score d'accomplissement
existant empêche un double crédit lors d'un nouveau déplacement de statut.

## Migration des anciennes missions

La migration `20260803150000_identity_groups_multiassign` reconstruit une
attribution principale active pour toute mission encore liée par l'ancienne
colonne `assignedGroupId` et dépourvue d'attribution active. L'effectif repris
est au moins 1 et correspond au minimum de groupe de la mission. Aucune mission
ne perd son groupe historique.

## Audits et notifications

L'audit `mission.assigned` contient les identifiants de groupe, effectifs,
groupe principal et total. Les notifications sont émises après la transaction
et ne contiennent que les champs publics de la mission, le nombre de groupes et
l'effectif total.
