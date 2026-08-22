# Fiches membres et évolution de grade

Les fiches de membres décrivent les comptes qui jouent sur la Toile. Elles
sont volontairement distinctes des **dossiers de renseignement**
(`CharacterProfile`) : un dossier peut concerner une cible, un commanditaire
ou un autre personnage qui ne possède aucun compte.

## Pages

- `/membres` liste les membres actifs dont l'onboarding est terminé ;
- `/membres/[id]` affiche la fiche d'un membre ;
- `/compte` reste l'espace où le membre modifie ses propres informations ;
- `/profils/[id]` reste un dossier de renseignement et ne devient jamais une
  fiche de compte ;
- `/grades` rassemble les demandes d'évolution et, pour les autorités
  habilitées, leur traitement.

Les listes de groupes, missions, revendications et classements renvoient vers
la fiche membre lorsque l'identifiant du compte est connu.

## Données visibles

La fiche peut afficher le Titre public, le portrait, le grade, les rôles
cumulés, les groupes actifs et leurs factions éventuelles, les spécialités,
ainsi que les statistiques agrégées de mission (participations, réussites,
points et ryōs attribués).

En mode Streamer, les pages de liste et de détail ne rendent ni portrait ni
présentation publique. La page `/compte` s'arrête avant la requête de fiche :
aucun nom, contenu de présentation ou état du portrait n'est alors transmis au
formulaire client.

Le prénom et le nom ne sont jamais lus directement dans un composant. Ils
passent par `serializeUserIdentity` et `canViewRealIdentity`. Quand le lecteur
n'est pas autorisé, ces propriétés n'existent pas dans le DTO envoyé à la
page. L'identifiant Discord n'est pas une donnée de la fiche publique.

## Édition personnelle

Un membre peut modifier depuis `/compte` :

- son Titre public ;
- son prénom et son nom facultatif ;
- la portée de visibilité de cette identité ;
- sa présentation publique ;
- ses spécialités ;
- son portrait.

Le portrait est stocké en base, car le disque Railway est éphémère. L'entrée
est limitée à 500 Ko puis décodée avec une borne de pixels, redimensionnée à
1 024 × 1 024 maximum et réencodée en WebP : une fausse signature est refusée
et les EXIF/GPS, miniatures et autres métadonnées sont retirés. Le décodage est
aussi limité à 12 essais par compte et par tranche de 10 minutes.

Les octets ne transitent jamais dans les données de page : une route
authentifiée les sert avec `nosniff` et une politique de cache navigateur
privée de 60 secondes. Un `ETag` de contenu permet ensuite une revalidation
`304`; `Vary: Cookie` sépare les sessions et les réponses 404 restent non
stockables.

## Évolution de grade

Le grade effectif participe aux critères d'éligibilité des missions. Il n'est
donc pas modifiable directement par le navigateur du membre.

- un membre peut demander son propre changement ;
- un chef peut proposer le changement d'un membre actif d'un groupe qu'il
  dirige réellement ;
- une seule demande peut rester en attente par membre ;
- la demande contient le grade visé et un motif ;
- une personne disposant de `user.level.manage` accepte ou refuse avec une
  note de décision ;
- personne ne peut traiter une demande qui concerne son grade ou qu'elle a
  elle-même déposée comme chef ;
- seule une acceptation modifie `User.playerLevelId` ;
- la décision est transactionnelle, auditée et notifiée.

La permission étroite `user.level.manage` appartient par défaut aux rôles
`moderator` et `super_admin`. Elle évite de donner aux modérateurs le droit
beaucoup plus large `user.manage`.

La table `UserLevelChangeRequest` conserve le grade courant au dépôt, le grade
demandé, le groupe au nom duquel un chef agit le cas échéant, le demandeur,
la décision et ses auteurs. Un index partiel PostgreSQL garantit l'unicité de
la demande en attente, y compris en cas de requêtes concurrentes.
