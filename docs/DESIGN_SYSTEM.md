# La Toile d'Or — Design System « Réseau d'Obsidienne »

> Système d'information d'une organisation clandestine de shinobis. Noir
> obsidienne, fils d'or, dossiers de parchemin, sceaux rouges. Tout le contenu
> est fictif et limité au cadre du jeu de rôle.

## 1. Identité du produit

- **Nom** : La Toile d'Or.
- **Métaphore centrale** : une toile d'araignée en fils d'or. Chaque mission est
  un *fil* ; réclamer = *saisir le fil* ; annuler = *rompre le fil* ; le réseau
  relie factions et contrats.
- **Ton** : prestigieux, dangereux, confidentiel. Jamais cartoon, jamais SaaS.
- **Emblème** : toile octogonale en fils d'or + araignée stylisée
  (`components/ui/logo.tsx`). Création originale — aucun asset officiel.

## 2. Tokens

Source unique : [`packages/ui/tokens.css`](../packages/ui/tokens.css), exposée
aux utilitaires Tailwind 4 via `@theme inline` dans `apps/web/app/globals.css`.
**Aucune couleur importante ne doit être écrite en dur dans un composant.**

### Palette

| Token | Valeur | Usage |
|---|---|---|
| `--toile-bg` | `#0b0a08` | Fond de page (obsidienne) |
| `--toile-bg-raised` | `#14120d` | Panneaux, colonnes Kanban |
| `--toile-bg-elevated` | `#1c1812` | Cartes, modales |
| `--toile-bg-hover` | `#241f16` | Survol |
| `--toile-bg-wood` | `#1a140c` | Panneaux « bois sombre » |
| `--toile-gold` | `#b8963e` | Or vieilli — valeur, réseau, interactions, priorité |
| `--toile-gold-bright` | `#d8b45a` | Survol, focus, éléments actifs |
| `--toile-gold-dim` | `#6e5a26` | Fils, bordures discrètes |
| `--toile-gold-faint` | `#362c14` | Trames de toile en arrière-plan |
| `--toile-copper` | `#8c5a2b` | États secondaires |
| `--toile-ink` | `#e8dcc0` | Texte principal (ivoire) |
| `--toile-ink-muted` | `#a89f8a` | Texte secondaire |
| `--toile-ink-faint` | `#6f6a5c` | Légendes, méta |
| `--toile-parchment` | `#ece1c4` | Fond des dossiers confidentiels ouverts |
| `--toile-parchment-text` | `#241e12` | Encre sur parchemin |
| `--toile-blood` | `#6e1423` | Sceaux, rang S/SS — **rare** |
| `--toile-blood-bright` | `#94202f` | Alertes, échecs |
| `--toile-smoke` | `#7a7568` | Gris fumée |

**Règle du rouge** : accent rare. Uniquement sceaux, rangs S/SS, échecs,
interdictions, révocations. Jamais décoratif.

### Couleurs sémantiques

| Token | Usage |
|---|---|
| `--toile-success` `#5a7a4a` | Accompli (vert mousse éteint) |
| `--toile-warning` `#a67c2e` | Avertissements d'éligibilité, attente |
| `--toile-danger` | = blood-bright |
| `--toile-info` | = copper |

### Rangs de mission

| Rang | Token | Style |
|---|---|---|
| D | `--toile-rank-d` (gris fumée) | Sceau octogonal simple |
| C | `--toile-rank-c` (bronze) | idem |
| B | `--toile-rank-b` (argent sombre) | idem |
| A | `--toile-rank-a` (or) | idem |
| S | `--toile-rank-s` (rouge sombre) | + liseré or intérieur |
| SS | `--toile-rank-ss` (or vif) | double liseré + sceau rouge intérieur |

Composant : `components/missions/rank-seal.tsx` (octogone SVG + symbole).

## 3. Typographies

| Rôle | Police | Usage |
|---|---|---|
| Display | **Cinzel** (`--toile-font-display`) | Titres, wordmark, numéros de rang — gravure lapidaire |
| Corps | **Inter** (`--toile-font-body`) | Texte courant |
| Données | **JetBrains Mono** (`--toile-font-mono`) | Codes de mission, ryōs, horodatages, filigrane |

Tailles : échelle Tailwind par défaut ; titres de page `text-xl` +
`tracking-[0.15em]` + uppercase ; en-têtes de sections `text-sm`
`tracking-widest` uppercase ; méta `text-[0.65rem]` uppercase.

## 4. Espacements, rayons, bordures, ombres

- **Espacements** : échelle 4 px (`--toile-space-*`). Panneaux `p-4`/`p-5`,
  cartes `p-3`.
- **Rayons** : angles droits dominants. `--toile-radius-sm: 2px` maximum sur
  les boutons. **Pas de cartes arrondies, pas de pilules.**
- **Bordures** : 1 px. Hiérarchie : `--toile-border` (discret) →
  `--toile-border-gold` (encadrement notable) → `--toile-gold` (actif/survol).
- **Ombres** : `--toile-shadow-card`, `--toile-shadow-modal`,
  `--toile-shadow-gold` (halo doré réservé au survol des cartes et éléments
  prioritaires).

## 5. Grille, largeurs, breakpoints

- Largeurs de contenu : `--toile-content-narrow` 42 rem (formulaires),
  `default` 72 rem (pages), `wide` 96 rem (Kanban plein écran).
- Breakpoints Tailwind standard ; cibles réelles testées : 1440×900, 1280×800,
  1024×768, 768×1024, 390×844, 360×800.
- Coquille : barre latérale 14 rem (≥ md), navigation par onglets en bas
  d'écran (< md).
- La barre latérale est **ancrée** (`sticky top-0 h-dvh self-start`) : elle ne
  défile pas avec le contenu. `self-start` n'est pas décoratif — sans lui, le
  flex étire l'aside à la hauteur de tout le contenu et `sticky` n'a plus rien
  contre quoi coller. Sa liste de liens défile pour elle-même (`overflow-y-auto`)
  afin que l'identité et la déconnexion restent atteignables sur un écran peu
  haut. Vérifié par `e2e/shell.spec.ts`.

## 6. Animations

Discrètes, thématiques, jamais bloquantes. `--toile-ease`
`cubic-bezier(0.22,0.61,0.36,1)` ; durées 120/200/420 ms.

- Fil d'or vertical qui marque l'élément de navigation actif.
- Halo doré au survol des cartes (`shadow-gold`).
- Carte en cours de glissement : légère rotation + bordure or.
- Sceau apposé lors d'une confirmation critique (modale « Sceller le destin »).
- `prefers-reduced-motion` : toutes les animations sont neutralisées
  (règle globale dans `globals.css`).

## 7. Règles par composant

### Tableaux
Fond `raised`, en-tête mono uppercase `text-[0.65rem]` sous bordure or,
lignes séparées par `--toile-border`, survol `bg-hover-bg`. Toujours dans un
conteneur `overflow-x-auto` avec `min-w` explicite.

### Cartes de mission
Sceau de rang à gauche, code mono + araignée rouge si volet confidentiel,
titre, catégorie, puis grille `dl` : récompense (or, mono), délai réel +
équivalent RP en italique, niveau cible, candidatures, attribution.
Ne JAMAIS afficher de champ confidentiel — la carte reçoit une vue
`public` sérialisée côté serveur.

### Formulaires
Libellés uppercase `text-xs text-ink-faint` au-dessus du champ. Champs
`bg-elevated`, bordure `--toile-border`, focus bordure or. Erreurs en
`text-blood-bright` sous le champ, jamais uniquement par la couleur
(icône/texte). Formulaire long = assistant par étapes avec fil d'avancement.

### Boutons
Variantes (`components/ui/button.tsx`) : `gold` (action principale, fond or,
texte obsidienne), `outline` (secondaire), `ghost` (tertiaire), `danger`
(contour rouge), `seal` (fond rouge — actions destructives confirmées).
Focus visible : anneau `--toile-gold-bright` 2 px.

### Modales
Fond de page assombri `bg-obsidian/80`, panneau `bg-raised` bordure or,
titre display uppercase. Confirmation critique = vocabulaire du sceau
(« Apposer le sceau », « Renoncer ») + justification journalisée.

### Informations confidentielles
- Le dossier ouvert est un **panneau parchemin** (`bg-parchment`, texte encre)
  qui contraste volontairement avec le reste — on « ouvre un document ».
- Filigrane local (`PanelWatermark`) posé DANS le panneau, en plus du filigrane
  de coquille.
- Niveau non autorisé : notice « Dossier scellé » avec sceau 封 — jamais un
  champ flouté (le contenu n'est pas envoyé du tout).
- Interdictions en rouge. Objectifs secrets marqués ◈ (modérateurs).

## 8. Confidentialité visuelle

- **Filigrane** : pseudo, ID partiel, groupes, horodatage, ID de session,
  répété en diagonale, opacité ~0,05, deux couches indépendantes.
- **Mode Streamer** (`Ctrl+Shift+S`) : les valeurs sensibles sont remplacées
  **côté serveur** par des codes (`CIBLE-A3F2`) ; bannière d'état visible.
- **Voile** : bouton permanent + inactivité (5 min) → écran noir/or, heure,
  « Mode confidentiel ».
- Flou du contenu à la perte de focus de la fenêtre.
