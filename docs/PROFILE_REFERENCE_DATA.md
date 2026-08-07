# Référentiels des dossiers

## Pourquoi

Sans référentiel, la base se remplit de variantes : `Uchiha`, `uchiha`,
`Clan Uchiha`, `UCHIWA`, `Uchïha`. Les champs structurés n'utilisent donc
**jamais de texte libre**.

`ProfileReferenceOption` porte : `type`, `code` (stable), `label`,
`normalizedLabel` (minuscules sans accents — **unique par type**), `aliases`,
`kanji`, `romaji`, `category`, `colorHex`, `descriptionShort`, `sourceUrl`,
`sourceScope`, `sortOrder`, `isUnique`, `isActive`.

`type` est une **chaîne**, pas un enum SQL : ajouter un type ne demande aucune
migration. Les enums sont réservés aux états réellement stables.

Types : `HAIR_COLOR`, `SKIN_TONE`, `CLAN_FAMILY`, `CHAKRA_NATURE`,
`KEKKEI_GENKAI`, `CLAN_TECHNIQUE`, `JUTSU_TYPE`, `SIGNATURE_TECHNIQUE`,
`COMBAT_STYLE`, `KENJUTSU_STYLE`, `LEGENDARY_ARTIFACT`.

## Nature, lignée, technique : trois choses distinctes

| Référentiel | Ce qu'il contient | Exemples |
|---|---|---|
| `CHAKRA_NATURE` | **les cinq éléments primaires, et rien d'autre** | Katon, Suiton, Fûton, Raiton, Doton |
| `KEKKEI_GENKAI` | les capacités **héritées**, dont tous les dérivés élémentaires | Mokuton, Hyôton, Yôton (lave), Ranton, Sakin, Shôton, Sharingan, Byakugan |
| `CLAN_TECHNIQUE` | les **techniques** nées dans un clan | Susanoo, Amaterasu, Kamui, Jûken, Kaiten, Marque maudite |

Le référentiel des natures mélangeait auparavant les trois : un dérivé comme
le Mokuton pouvait être saisi comme « nature » chez un personnage sans aucune
lignée, et la distinction qui fonde le Kekkei Genkai disparaissait. Les entrées
déclassées sont **désactivées, jamais supprimées** — un dossier qui portait
« Mokuton » en nature continue de l'afficher, car effacer un renseignement déjà
recueilli serait pire que de laisser une entrée dépréciée.

### Pourquoi les techniques de clan ne sont pas des Kekkei Genkai

Un Kekkei Genkai s'hérite ; une technique de clan **se transmet, s'apprend ou
se vole**. Un Sharingan implanté, un Susanoo observé chez qui n'est pas Uchiha :
c'est précisément le genre de renseignement que la Toile monnaye. Les deux
notions ont donc leur propre champ dans le dossier, et un porteur hors clan se
lit d'un coup d'œil.

### Subjutsu répertoriés (`SIGNATURE_TECHNIQUE`)

Les techniques notoires du serveur — Multi clonage, Rasengan, Chidori,
Hiraishin, Marque maudite, paliers « Rang X » élémentaires, voies de l'Ermite
(Senju, Hôki, Sabaku) — forment un référentiel contrôlé : le champ **Subjutsu**
de l'étape Capacités, un trait comme les Kekkei Genkai. Mêmes libellés partout,
pas de variantes. Les techniques **propres** au personnage (jutsu originaux,
avec rang et description) restent du texte libre, saisies séparément sur la
page du dossier. Sur les entrées du catalogue, `category` porte le **code du
type de jutsu** (`NINJUTSU`, `JUINJUTSU`, `SENJUTSU`…).

## Provenance des données (`sourceScope`)

`MANGA_CANON` · `ANIME` · `FILM` · `GAME` · `SERVER_CUSTOM`. Les contenus ne
sont **jamais mélangés silencieusement** : la provenance est affichée dans les
sélecteurs et dans l'administration.

Exemples de distinctions retenues : le Shôton et le clan Kurama viennent de
l'anime ; Hakumei, Sabaku et Shirogame sont des créations du serveur ; le
Ketsuryûgan vient de contenus dérivés.

### Homonymie surveillée

`Yôton` désigne **deux** choses différentes : la nature Yang (陽遁) et la Lave
(熔遁). Elles portent deux codes distincts (`YOTON_YANG`, `YOTON_LAVA`) —
raison pour laquelle le libellé n'est jamais un identifiant.

## Sources et indépendance

Le seed (`packages/database/prisma/seed-profile-references.ts`) est **local,
versionné et vérifié**. Il conserve un lien `sourceUrl` vers le Naruto Wiki
mais **aucun texte ni image n'en est copié** — seulement des descriptions
courtes originales. L'application ne contacte jamais Fandom : aucun scraping,
aucune dépendance réseau. Le site fonctionne si le wiki est indisponible.

Point de départ documentaire : catégories Natures Chakra, Types de Jutsu,
Kekkei Genkai, Clans et Rangs du wiki francophone.

## Contenu initial (105 entrées)

- **15** couleurs de cheveux, **8** teintes de peau (échelle neutre numérotée
  avec aperçu — aucune valeur morale ou raciale associée à une teinte) ;
- **18** clans et familles ;
- **19** natures de chakra (5 élémentaires, Yin/Yang, combinées, Kekkei Tôta) ;
- **18** Kekkei Genkai typés (`DOJUTSU`, `ELEMENTAL`, `PHYSICAL`,
  `CLAN_ABILITY`, `KEKKEI_TOTA`) ;
- **9** types de jutsu, **9** styles de combat, **3** sous-styles de Kenjutsu ;
- **7** artefacts : les Sept Épées de la Brume (Kubikiribôchô, Samehada,
  Hiramekarei, Kiba, Nuibari, Kabutowari, Shibuki), toutes `isUnique`.

Le seed est **idempotent** (upsert par `type + code`) : il s'exécute sans
risque en production et met à jour les libellés sans dupliquer.

## Artefacts uniques

Quand un artefact `isUnique` est attribué à un personnage alors qu'un **autre
personnage vivant** le porte déjà, le serveur **avertit sans bloquer** (copie,
faux, possession incertaine…) et le modérateur peut marquer l'information
comme contradictoire.

## Proposer une valeur absente

Un modérateur ne crée jamais directement une option officielle : il soumet une
`ProfileReferenceSuggestion` (type, libellé, description, source, provenance,
motif). Un **super-modérateur** l'approuve (création, avec refus des doublons
normalisés), la refuse, ou la **fusionne** — la proposition devient alors un
alias de l'option existante. Les super-modérateurs peuvent aussi désactiver une
entrée (`isActive: false` : plus sélectionnable, mais les dossiers existants la
conservent).

Administration : `/admin/referentiels`.

### Saisie directe depuis un dossier

Détenir `profile.reference.manage` permet d'ajouter une entrée **sans quitter
le dossier** : le sélecteur affiche « Ajouter « X » au référentiel » en pied de
liste, et pour `HAIR_COLOR` / `SKIN_TONE` un nuancier accompagne la saisie.
L'entrée créée est immédiatement sélectionnée et apparaît dans la liste sans
rechargement. Sans cette permission, le pied de liste propose la voie normale :
soumettre une proposition.

Deux actions serveur cohabitent volontairement :

| Action | Origine | Doublon | Retour |
|---|---|---|---|
| `createReferenceOptionAction` | `/admin/referentiels` | **refusé** (erreur explicite) | — |
| `createInlineReferenceOptionAction` | formulaire de dossier | **idempotent** : l'entrée existante est renvoyée, une entrée désactivée est réactivée | l'option, pour l'afficher aussitôt |

La seconde est incidente — on complète un dossier, pas un référentiel — d'où
l'idempotence : deux modérateurs saisissant la même valeur en même temps ne
doivent pas voir d'erreur. Le `code` est dérivé du libellé normalisé et suffixé
s'il est déjà pris ; `normalizedLabel` reste l'unique garde-fou anti-variantes.
