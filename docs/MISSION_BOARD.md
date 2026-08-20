# Le tableau des contrats

`/missions` est la page d'accueil de fait : c'est là qu'un chef cherche du
travail et qu'un tisseur voit ce qui l'attend. Elle répond à trois questions,
dans cet ordre : **qu'est-ce qui presse**, **qu'est-ce qui est disponible**,
**où en sont mes contrats**.

## Résumé : des raccourcis, pas des statistiques

Chaque tuile est un **lien filtré** — « 3 candidatures » sans moyen d'aller
les voir n'aide personne. Les comptes ne suivent pas les filtres actifs :
ils disent ce qui reste à faire, pas ce que l'écran montre.

| Lecteur | Tuiles |
|---|---|
| Modération | À prendre · Expirent sous 48 h · Candidatures à traiter · Sans équipe · À régulariser |
| Chef / agent | À prendre · Expirent sous 48 h · Mes contrats en cours · Mes candidatures |

Une tuile à zéro et sans urgence disparaît : un tableau de bord qui affiche
cinq zéros n'apprend rien. La confidentialité tient par construction — un chef
ne compte que **ses** groupes, jamais l'activité des autres.

## Deux vues, un seul état

- **Tableau** (Kanban) : montre l'ÉTAT. Cinq colonnes, glisser-déposer réservé
  à la modération.
- **Liste** : montre le CONTENU. Lignes denses groupées par colonne, titre en
  entier, métadonnées dessous.

Le choix vit dans l'URL (`?vue=liste` / `?vue=tableau`) : il se partage et
survit au rechargement. **Par défaut** : liste sous 900 px, tableau au-delà —
cinq colonnes qui défilent de côté sur un téléphone sont une punition.

## Colonnes d'archive repliées

« Accomplies », « Échouées » et « Annulées » s'ouvrent en bandes verticales
étroites portant leur compte. Elles occupaient la moitié du tableau pour des
missions déjà réglées ; l'action du jour est « à prendre » et « en cours ».
Une bande repliée **reste une cible de dépôt** : on peut y glisser une carte
sans la déplier d'abord. Un clic la rouvre.

Les colonnes ouvertes se partagent la largeur disponible (`flex-1`) plutôt que
de laisser un désert à droite ; au-delà de quatre, elles retombent à leur
largeur minimale et le tableau défile — **dans son conteneur**.

## Filtres rapides

Sous la recherche, cinq questions d'un clic : ⏳ Expire sous 48 h · Sans équipe
· Avec candidatures · Pour mes groupes · Sans limite de temps. Les filtres fins
(catégorie, niveau de cible, fourchette de ryōs) restent sous « Filtres
avancés ». Tout vit dans l'URL.

Deux filtres ajoutés côté serveur : `unassigned` (aucune attribution active) et
`expiringSoon` (moins de 48 h, non expiré).

## La carte

Titre **en entier** — il porte désormais le type, le rang, le niveau des cibles
et leur origine (`MISSION_PUBLIC_TITLE.md`) ; le tronquer le rendrait muet. Le
reste tient en pastilles : récompense, délai, nombre de cibles, niveau,
candidatures. Un contrat qui expire dans moins de 12 h prend un liseré sang ;
moins de 48 h, une pastille ambre et un sablier.

Aucun nom de cible, jamais : les cartes sont vues par tous les chefs, y compris
ceux qui ne prendront pas la mission.

## Débordement horizontal

Le tableau défile **chez lui**. Le conteneur de contenu du gabarit porte
`min-w-0` : sans lui, un enfant de flexbox refuse de descendre sous la largeur
de son contenu et pousse toute l'application hors de l'écran. Vérifié à 1920,
1440, 1280, 1024, 768, 430 et 360 px : zéro débordement.
