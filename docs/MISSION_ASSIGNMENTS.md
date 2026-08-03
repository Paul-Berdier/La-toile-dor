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
- le niveau minimal est calculé uniquement sur les agents sélectionnés ;
- reste modifiable, avec le message, tant que la revendication est `PENDING`
  ou `INFO_REQUESTED` ;
- est conservée dans `MissionClaimParticipant`, puis copiée dans
  `MissionParticipant` lors de l'acceptation.
- reste invisible aux autres joueurs par défaut. Le chef peut décocher la case
  d'invisibilité ; ce consentement est alors copié dans
  `MissionAssignment.publicRoster` lors de l'attribution.

Une revendication n'accorde aucun accès confidentiel. Seule une attribution
active le fait.

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
l'activité de chaque groupe et l'appartenance active de chaque agent. L'action
peut attribuer sans démarrer (`ASSIGNED`) ou attribuer et
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
