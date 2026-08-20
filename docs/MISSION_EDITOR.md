# L'éditeur de mission — une page

Créer un contrat demandait **dix écrans et neuf clics « Suivant »**, dont deux
écrans ne portaient qu'un seul champ. Une mission simple — un type, un rang,
une cible, une récompense — coûtait une douzaine d'interactions et faisait
ressaisir à la main ce que les dossiers savaient déjà.

`MissionEditor` (`apps/web/components/missions/mission-editor.tsx`) remplace le
parcours par **une seule page**, utilisée à l'identique pour créer
(`/missions/nouvelle`) et pour modifier (`/missions/[id]/modifier`).

## Structure

| Section | Contenu | État |
|---|---|---|
| **Essentiel** | type, délai, rang (+ nuance `+` / `-`), récompense, points | ouverte |
| **Personnes** | cibles, commanditaires — des **dossiers** | ouverte |
| **Objectif** | objectif principal, objectifs secondaires (secret / bonus) | ouverte |
| **Informations recherchées** | champs de dossier visés — types « prise d'information » seulement | conditionnelle |
| **Informations opérationnelles** | lieu, instructions, contraintes, interdictions, preuves, résumé public | ouverte |
| **Options avancées** | titre interne, notes, effectifs, éligibilité, visibilité, dérogation de titre | **repliée** |

À droite, collante : l'**aperçu public** (le titre tel que le tableau
l'affichera, rang, niveau de cible, origine, récompense, expiration) et la
**vérification** — chaque ligne cliquable amène au champ concerné.

## Ce qui ne se saisit plus

- **le titre public** : composé du type, du rang et des cibles
  (`MISSION_PUBLIC_TITLE.md`) ;
- **le niveau de cible** : grade le plus élevé des dossiers rattachés ;
- **la faction cible** : origine commune des cibles, s'il n'y en a qu'une ;
- **le nom des cibles et du commanditaire** : ils vivent dans les dossiers.

## Personnes : choisir ou ouvrir un dossier

`ProfilePicker` cherche dans les champs **publics** des dossiers (code, titre,
prénom, nom — la même route que partout). Le dossier choisi affiche son grade,
sa classe et son origine, avec la mention « repris de PRF-000142 ». Si le
ninja n'a pas de fiche : « + Créer le dossier » ouvre une modale à un champ
obligatoire (le prénom), crée le dossier avec les règles habituelles (groupe
propriétaire, code, audit) et le sélectionne — sans quitter la page.

La première personne d'un rôle devient la **principale** ; on peut changer
d'un clic quand il y en a plusieurs.

## Suggestions — informatives, jamais bloquantes

- **Rang** : `suggestMissionRank(targets, category)` propose un rang d'après le
  grade le plus élevé, rehaussé d'un cran pour les catégories de contact direct
  (élimination, enlèvement, traque, guerre). Si le rang choisi paraît faible,
  un avertissement propose « Utiliser A » — il ne l'impose pas. Ce n'est pas
  une règle canonique de l'univers, c'est le barème du serveur.
- **Récompense** : la fourchette de `RankConfig` s'affiche sous les montants,
  avec un bouton « Utiliser ».

## Délai — une intention, quatre formes

`Aucun délai` · `Durée réelle` (heures) · `Durée RP` (années / mois / semaines)
· `Date précise`. L'équivalence s'affiche sous le champ ; la base ne conserve
qu'`expiresAt` en UTC. En modification d'une mission publiée, une durée court
depuis sa **publication**, pas depuis l'instant où l'on corrige une virgule.

## Brouillon, raccourcis, duplication

- **Autosave** 2 s après la dernière frappe — sur les brouillons seulement :
  une mission publiée ne se modifie pas par inadvertance.
- **Ctrl+S** enregistre ; **Ctrl+Entrée** ouvre la confirmation de publication.
  Jamais de publication directe au clavier : publier envoie des notifications.
- **Dupliquer** reprend type, rang, consignes et récompense ; les cibles et les
  commanditaires ne suivent **que sur confirmation** — deux contrats qui se
  ressemblent visent rarement les mêmes gens. Le sort des cibles n'est jamais
  recopié.

## Validation

`checkMissionForPublication` produit toute la liste d'un coup. Une seule
erreur est **bloquante** : une récompense nulle. Le reste est un
avertissement (aucune cible, pas d'objectif, pas de délai) — certaines
missions n'ont légitimement personne à viser.
