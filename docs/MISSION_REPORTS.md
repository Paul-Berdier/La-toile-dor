# Rapport de fin de mission

Le rapport **final** d'une mission se dépose en **trois étapes** depuis la page
de la mission (`MissionReportWizard`, `apps/web/components/missions/report-wizard.tsx`).
Les rapports d'étape (texte + preuves, non finaux) restent possibles à côté
(`ReportForm`).

## Qui rapporte

`resolveReporter` (`apps/web/server/missions/report-actions.ts`) : le **chef**
d'un groupe **attribué** (actif) à la mission, au nom de ce groupe ; s'il
dirige plusieurs groupes attribués, il précise (`?rapportGroupe=`) ; la
modération peut rapporter au nom d'un groupe attribué. Mission en `ASSIGNED`
ou `IN_PROGRESS` seulement — le **dépôt** exige `IN_PROGRESS`. Une fois le
rapport final déposé, la page remplace le wizard par un encart « Rapport final
déposé le … » : pas de wizard vierge au rechargement.

## Les trois étapes

1. **Résultat** — sort de chaque cible (`MISSION_TARGET_OUTCOMES`, précision
   **préremplie** depuis le panneau des cibles), résumé (≥ 10 caractères),
   preuves (PNG/JPG/WEBP, 2 Mo, 5 max — non conservées dans le brouillon).
2. **Renseignements** — chaque dossier est une **carte repliable**
   (`<details>`, repliée quand traitée, résumé « ✓ n informations » /
   « Aucune nouvelle information » / « À traiter »). Par dossier cible :
   « **Aucune nouvelle information** » (un clic) ou « **+ Ajouter un champ** »
   (palette par rubrique — un champ déjà ajouté **disparaît de la palette**,
   le schéma refusant les doublons). Sous chaque champ, la
   « **Valeur actuelle** » (§41) : le libellé courant si le groupe rapporteur
   **voit** le dossier, sinon « Confidentielle » — la valeur réelle n'est
   alors **jamais envoyée** au navigateur. « **+ Ninja découvert** » : prénom
   (obligatoire), nom, sort, renseignements — un dossier sera ouvert **pour le
   groupe**. « **Ninja croisé qui a déjà un dossier ?** » : la recherche
   publique rattache un dossier existant (`linked`) au rapport — ses
   renseignements partent en revue, sauf si le groupe possède le dossier.
3. **Validation** — récapitulatif, contrôles en français (résumé, dossiers non
   traités, ninja sans prénom, **champs ajoutés sans valeur** — vérifiés côté
   client par `isReportEntryComplete` avant tout envoi —, dossier rattaché
   vide, doublons), bouton
   « **Terminer la mission et enregistrer les renseignements** ». La
   résolution (statut, prime, points) reste une action de modération
   distincte. Quand un doublon est signalé pour un ninja découvert, un clic
   « C'est PRF-… » **convertit** le bloc en dossier rattaché sans perdre les
   renseignements saisis.

Chaque dossier cible doit être **traité** (`untreatedDossiers`) : « rien de
neuf » compte. On ne clôt pas en laissant un dossier dans le vague — c'est ce
renseignement que la Toile revend.

## Brouillon

`MissionReportDraft` (un par mission × groupe) : le même objet
(`missionReportPayloadSchema`) est sauvegardé **1,5 s après la dernière frappe**
et effacé à la finalisation. Deux chefs du même groupe reprennent le même
brouillon. Naviguer dans un wizard **vierge** ne crée pas de brouillon. Un
échec de sauvegarde est expliqué (« Brouillon invalide — Dossier n°2,
renseignement n°1 : Valeur manquante »), et un échec au moment du dépôt est
affiché en erreur — le bouton ne « fait » jamais rien en silence.
Migration `20260819130000_rapport_fin_de_mission_brouillon`.

## Finalisation — tout ou rien

`finalizeMissionReportAction`, dans **une** transaction :

1. `MissionReport` final + preuves (validées par signature) ;
2. sort de chaque cible (`MissionTarget.outcome`, `recordedById`) — en
   mission **mono-groupe** seulement : à plusieurs groupes, chaque rapport
   reste une observation et la modération consolide le sort canonique ;
3. contributions `MISSION` par dossier (cibles **et** dossiers rattachés),
   attribuées au **groupe rapporteur** ; écrites directement (`APPLIED`) si le
   groupe peut modifier le dossier (groupe créateur, modération), sinon
   `PENDING_REVIEW` avec conflit calculé côté serveur — jamais révélé au
   contributeur ;
4. ninjas découverts : `createOwnedProfile` (dossier + octroi
   `CREATED_BY_GROUP` + titre), leurs renseignements écrits d'emblée (c'est le
   dossier du groupe) ; ils ne deviennent **pas** des cibles globales de la
   mission (en multi-groupes, cela révélerait le nouveau dossier aux autres
   équipes) ; doublons signalés une première fois, puis confirmés ;
5. brouillon effacé.

À la **clôture** (`COMPLETED`) d'une mission de catégorie `ELIMINATION`, les
cibles dont le sort est resté « inconnu » sont **présumées éliminées** : sort
`ELIMINATED`, dossier `DEAD`, sourcé par la mission. Un sort explicitement
consigné (en fuite, capturée…) n'est jamais écrasé par la présomption.

Un dossier du rapport archivé ou fusionné entre-temps fait **échouer** le
dépôt avec un message explicite — jamais une perte silencieuse d'entrées. Le
statut de la mission est relu **dans** la transaction : une clôture
concurrente annule tout. En cas d'échec, rien n'est écrit et le brouillon
reste. Notifications hors transaction : `FINAL_REPORT_SUBMITTED` (tisseurs),
`PROFILE_CONTRIBUTION_RECEIVED` (modération, s'il reste des contributions à
trancher).

## Multi-groupes

Les contributions sont attribuées au groupe qui rapporte. **Aucun groupe ne
gagne d'accès durable** aux dossiers des autres par le rapport : pendant la
mission, chaque groupe attribué lit les dossiers des **cibles** (accès
provisoire `MISSION_TARGET`, cf. `PROFILE_VISIBILITY.md`), et l'octroi durable
`MISSION_GRANTED` est écrit à la clôture (`applyMissionOutcomeToProfiles`,
groupes ayant réellement engagé des agents). La prime et les points relèvent
aussi de la clôture par la modération, pas du rapport.

## Vérifié par

`apps/web/e2e/dossiers-refonte.spec.ts` — rapport final, sort ESCAPED, « rien de
neuf », ninja découvert créé pour le groupe avec son renseignement `APPLIED`,
pas de cible globale ajoutée, brouillon effacé.
`apps/web/e2e/dossiers-mission-acces.spec.ts` — accès du groupe attribué aux
dossiers des cibles pendant la mission, retiré avec l'attribution.
Contrat : `packages/shared/src/mission-report.test.ts`.
