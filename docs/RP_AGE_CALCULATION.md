# Âge des personnages et temps RP

## Règle du serveur

```
1 jour réel   = 1 mois RP
1 semaine réelle = 1 année RP   →  une année RP compte 7 mois
```

Ces deux règles sont **simultanément vraies** : c'est pourquoi
`rpMonthsPerYear` vaut **7** (et non 12). Le ratio est configurable dans
Administration → Configuration (`AppSetting.rp_time`).

Service central : `packages/shared/src/rp-time.ts`. **Ne jamais dupliquer ce
calcul** dans un composant.

## L'âge n'est pas une valeur figée

Un âge saisi à la main deviendrait faux le lendemain. On stocke donc des
**instants réels UTC de référence** et l'âge est dérivé à chaque lecture
(`packages/shared/src/character-age.ts`).

| Mode | Données stockées | Calcul |
|---|---|---|
| `UNKNOWN` | — | « Inconnu » |
| `BIRTH_DATE_RP` | `birthRealAt` | années RP écoulées depuis la naissance |
| `AGE_AT_REFERENCE` | `ageYearsAtRef` + `ageReferenceRealAt` | âge observé + années RP écoulées depuis |
| `AGE_RANGE_AT_REFERENCE` | `ageMinAtRef`, `ageMaxAtRef` + `ageReferenceRealAt` | la fourchette progresse identiquement |

Quand le modérateur saisit « 24 ans », le serveur enregistre 24 **et l'instant
présent** comme référence. Une semaine réelle plus tard, le dossier affiche
automatiquement « 25 ans ».

## États vitaux

- **Mort avec date connue** (`lifeStatus = DEAD` + `deathRealAt`) : l'âge est
  **figé** à la date du décès, affiché « 33 ans (figé au décès) ».
- **Mort sans date** : l'âge continue de progresser (on ne sait pas quand
  l'arrêter) — comportement documenté et testé.
- **Disparu** : continue de vieillir tant que la mort n'est pas confirmée.

## Tests

`packages/shared/src/character-age.test.ts` couvre : chaque mode, la
progression avec le temps RP, le gel au décès, le disparu qui vieillit, le
mort sans date, et le changement de ratio (`rpMonthsPerYear` configurable).
