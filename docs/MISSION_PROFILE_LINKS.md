# Liens mission ↔ dossiers : cibles, commanditaires, snapshots

Une cible n'est plus du texte. C'est un **dossier de renseignement**
(`CharacterProfile`). Un commanditaire aussi. Le lien porte son rôle, et fige
ce que le dossier disait au moment du contrat.

## Le modèle

La table s'appelle historiquement `MissionTarget` ; elle est devenue le lien
mission ↔ dossier, quel que soit le rôle. On ne l'a pas renommée : le
renommage coûterait une migration destructive pour aucun gain.

```prisma
model MissionTarget {
  missionId  String
  profileId  String?              // null = cible historique en texte libre
  label      String?              // le nom d'alors, conservé
  role       MissionProfileRole   // TARGET | CLIENT | CONTACT | SUBJECT | …
  isPrimary  Boolean              // au plus une principale par rôle
  outcome    MissionTargetOutcome // le sort — pour les cibles
  snapshotRankId    String?       // grade    ┐ figés à la publication
  snapshotClassId   String?       // classe   │
  snapshotFactionId String?       // origine  ┘
  snapshotAt        DateTime?
  @@unique([missionId, profileId, role])
}
```

L'unicité porte sur `(mission, dossier, rôle)` : le RP autorise qu'un
commanditaire soit aussi la cible de son propre contrat (trahison, contrat sur
soi-même). On ne l'interdit pas techniquement.

## Rôles et confidentialité

| Rôle | Qui le voit | Effet |
|---|---|---|
| `TARGET` | chef d'un groupe attribué, modération | ouvre le dossier au groupe pendant la mission (`MISSION_TARGET`, cf. `PROFILE_VISIBILITY.md`) ; son sort met le dossier à jour à la clôture |
| `CLIENT` | **modération seule** | trace « a commandité la mission » dans son dossier à la clôture |
| `CONTACT`, `SUBJECT`, `PERSON_OF_INTEREST`, `OTHER` | modération | rattachements de travail |

⚠ **Toute lecture de cibles filtre `role: "TARGET"`.** Sans ce filtre, la
clôture marquerait un commanditaire « éliminé », lui ouvrirait son propre
dossier aux groupes engagés, et le rapport de fin lui demanderait des
renseignements. Les points concernés : `target-intel.ts`, `access.ts`
(`missionTargetProfileIds`), `report-actions.ts`, `target-requirements.ts`,
`contribution-actions.ts`, la page mission, le compteur public `targetCount`.

## Snapshots : pourquoi une mission ne se réécrit pas

Un ninja Chunin au moment du contrat devient Jonin six mois RP plus tard. Si
la mission lisait le dossier **vivant**, un contrat de rang C se retrouverait
un beau matin à viser un Jonin, et son titre public changerait tout seul —
sans que personne ne l'ait décidé, y compris sur des missions closes.

- **Brouillon** : les snapshots suivent le dossier à chaque enregistrement.
- **Publication** : ils gèlent (`snapshotAt`).
- **Après** : `missionSnapshotDiff()` calcule l'écart, la fiche l'affiche
  (« Dossiers mis à jour depuis la publication », avant → après), et
  `syncMissionSnapshotsAction()` l'applique — sur décision, jamais seul.

Le titre public et le niveau de cible affichés viennent des **snapshots**.

## Ce que les cibles décident

`Mission.targetLevelId` et `Mission.targetFactionId` ne se saisissent plus :
ils sont **dérivés** à l'enregistrement (grade le plus élevé des cibles ;
faction commune s'il n'y en a qu'une). Ils restent des colonnes matérialisées
parce que le filtre du tableau (`?level=`) les interroge en SQL — un calcul au
rendu casserait la recherche.

## Migration et données existantes

Migration `20260820100000_missions_liens_dossiers_titre_auto`, additive et
idempotente :

1. enums `MissionProfileRole`, `MissionRankModifier`, `MissionOriginVisibility` ;
2. colonnes de rôle, de principal et de snapshots sur `MissionTarget` ;
3. index unique `(missionId, profileId)` → `(missionId, profileId, role)` ;
4. colonnes `titleAuto`, `titleOverrideReason`, `rankModifier`,
   `originVisibility`, `soughtFieldKeys` sur `Mission` ;
5. **backfill** : `Mission.clientProfileId` → lien `CLIENT` ; snapshots pris
   sur l'état actuel des dossiers (l'historique n'est pas rejouable) ; une
   cible principale par mission ; `EligibilityMode.MANUAL_REVIEW` converti.

**Rien n'est supprimé.** `targetIdentity`, `targetProfileId`,
`targetFactionId`, `clientName`, `clientProfileId` restent en base et
s'affichent en lecture seule (« saisie historique ») tant qu'une mission n'a
pas été régularisée. Voir `MISSION_LEGACY_MIGRATION.md`.
