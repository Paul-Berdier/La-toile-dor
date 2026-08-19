# Rapport de fin de mission

Le rapport **final** d'une mission se dépose en **trois étapes** depuis la page
de la mission (`MissionReportWizard`, `apps/web/components/missions/report-wizard.tsx`).
Les rapports d'étape (texte + preuves, non finaux) restent possibles à côté
(`ReportForm`).

## Qui rapporte

`resolveReporter` (`apps/web/server/missions/report-actions.ts`) : un membre d'un
groupe **attribué** (actif) à la mission, au nom de ce groupe ; s'il est
participant nommé, son groupe de participation ; s'il appartient à plusieurs
groupes attribués, il précise ; la modération peut rapporter au nom de l'unique
groupe attribué. Mission en `ASSIGNED` ou `IN_PROGRESS` seulement.

## Les trois étapes

1. **Résultat** — sort de chaque cible (`MISSION_TARGET_OUTCOMES`, avec
   précision), résumé (≥ 10 caractères), preuves (PNG/JPG/WEBP, 2 Mo, 5 max —
   non conservées dans le brouillon).
2. **Renseignements** — par dossier cible : « **Aucune nouvelle information** »
   (un clic) ou « **+ Ajouter un champ** » (palette par rubrique, éditeur de
   valeur partagé `IntelValueEditor`, « vérifié : il n'y en a pas », confiance,
   précision). « **+ Ninja découvert** » : prénom (obligatoire), nom, sort, et
   ses renseignements — un dossier sera ouvert **pour le groupe**.
   Le wizard ne reçoit que prénom et code des cibles : **aucune valeur en place**
   n'est affichée ; l'équipe dit ce qu'elle a vu, la modération compare.
3. **Validation** — récapitulatif, contrôles (résumé, dossiers non traités,
   ninja sans prénom, doublons), bouton
   « **Terminer la mission et enregistrer les renseignements** ».

Chaque dossier cible doit être **traité** (`untreatedDossiers`) : « rien de
neuf » compte. On ne clôt pas en laissant un dossier dans le vague — c'est ce
renseignement que la Toile revend.

## Brouillon

`MissionReportDraft` (un par mission × groupe) : le même objet
(`missionReportPayloadSchema`) est sauvegardé **1,5 s après la dernière frappe**
et effacé à la finalisation. Deux membres du même groupe reprennent le même
brouillon. Migration `20260819130000_rapport_fin_de_mission_brouillon`.

## Finalisation — tout ou rien

`finalizeMissionReportAction`, dans **une** transaction :

1. `MissionReport` final + preuves (validées par signature) ;
2. sort de chaque cible (`MissionTarget.outcome`, `recordedById`) ;
3. contributions `MISSION` par dossier, attribuées au **groupe rapporteur** ;
   écrites directement (`APPLIED`) si le groupe peut modifier le dossier (groupe
   créateur, modération), sinon `PENDING_REVIEW` avec conflit côté modération ;
4. ninjas découverts : `createOwnedProfile` (dossier + octroi
   `CREATED_BY_GROUP` + titre), rattachés comme cibles de la mission, leurs
   renseignements écrits d'emblée (c'est le dossier du groupe) ; doublons
   signalés une première fois, puis confirmés ;
5. brouillon effacé.

Le statut de la mission est relu **dans** la transaction : une clôture
concurrente annule tout. En cas d'échec, rien n'est écrit et le brouillon reste.
Notifications hors transaction : `FINAL_REPORT_SUBMITTED` (tisseurs),
`PROFILE_CONTRIBUTION_RECEIVED` (modération, s'il reste des contributions à
trancher).

## Multi-groupes

Les contributions sont attribuées au groupe qui rapporte. **Aucun groupe ne
gagne d'accès** aux dossiers des autres par le rapport : l'accès
`MISSION_GRANTED` aux dossiers des cibles reste décidé par la modération à la
clôture (`applyMissionOutcomeToProfiles`, groupes ayant réellement engagé des
agents). La prime et les points relèvent aussi de la clôture par la modération,
pas du rapport.

## Vérifié par

`apps/web/e2e/dossiers-refonte.spec.ts` — rapport final, sort ESCAPED, « rien de
neuf », ninja découvert créé pour le groupe avec son renseignement `APPLIED`,
nouvelle cible rattachée, brouillon effacé. Contrat : `packages/shared/src/mission-report.test.ts`.
