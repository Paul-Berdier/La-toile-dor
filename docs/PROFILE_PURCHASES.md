# Achat d'un dossier par un groupe

## Parcours

1. Un **chef de groupe** ouvre un dossier qu'il ne possède pas et clique
   « Demander l'accès pour mon groupe ». S'il dirige plusieurs groupes, il
   choisit lequel. Un **agent** ne peut pas créer de demande. **Aucun bouton
   d'achat** n'apparaît — et le serveur refuse la demande — si le groupe a
   **créé** le dossier (`createdByGroupId`) ou le possède déjà (octroi actif).
   La page `/profils/mes-demandes` montre à un groupe ses demandes (avec la
   réponse du tisseur et le prix), ses accès et leur origine, ses révocations
   et le motif.
2. La demande (`ProfilePurchaseRequest`) part en `PENDING`. Un index partiel
   `(profileId, groupId) WHERE status = 'PENDING'` interdit les doublons.
3. Les modérateurs voient la demande sur `/profils/demandes` : dossier, groupe,
   chef demandeur (pseudonyme public), date, message, effectif du groupe,
   points au classement, nombre de dossiers déjà détenus.
4. Le modérateur **approuve** (avec un prix en Ryōs) ou **refuse** (avec une
   réponse). L'opération est transactionnelle : décision + octroi, ou rien.
5. À l'approbation, un `ProfileAccessGrant` est créé. Index partiel
   `(profileId, groupId) WHERE revokedAt IS NULL` : **un seul accès actif**,
   donc pas de double octroi même en cas de double clic.

## Origine d'un accès (`sourceType`)

| `sourceType` | Qui l'obtient | Affiché |
|---|---|---|
| `CREATED_BY_GROUP` | le groupe qui a ouvert le dossier | « ✓ Créé par votre groupe » |
| `PURCHASED` | demande d'achat approuvée (`sourceId` = demande, `priceRyos`) | « ✓ Dossier acquis » |
| `MODERATOR_GRANTED` | offert ou restauré par la modération | « ✓ Accès accordé » |
| `MISSION_GRANTED` | groupes ayant engagé des agents, à la clôture (`sourceId` = mission) | « ✓ Gagné en mission » |

S'y ajoute une origine **calculée**, jamais stockée : `MISSION_TARGET`
(« ⟡ Mission en cours ») — le dossier est la cible d'une mission en cours
attribuée à l'un des groupes du lecteur. Cet accès vit et meurt avec
l'attribution ; il n'apparaît pas dans la table des octrois et n'a donc rien à
révoquer. Un dossier ainsi ouvert n'affiche **pas** de bouton d'achat tant que
la mission court : le chef peut toutefois déposer une demande pour le garder
après la mission (avant elle, ou une fois l'accès retombé).

Les accès antérieurs à la colonne ont été **backfillés** (`PURCHASED` s'ils
portent une demande, migration `20260819100000`). La modération distingue ainsi
un accès payé d'un accès gagné au prix du sang avant de révoquer.

**Fusion de dossiers** : les octrois actifs du doublon sont transférés vers le
dossier conservé — un groupe qui avait payé pour « ce personnage » garde son
accès, même si le doublon était maigre. Ce transfert est un élargissement
d'accès décidé par la modération au moment de fusionner.

## Ryōs — limite assumée

**Aucun portefeuille de groupe n'existe** dans l'application : `MissionScore`
gère des points de classement, pas une monnaie. Plutôt que de simuler un débit
opaque, le prix convenu est **enregistré** (`priceRyos` sur la demande et sur
l'octroi) et le règlement se fait **en RP**. L'interface l'indique
explicitement au modérateur.

Si un vrai portefeuille est ajouté plus tard, le point d'insertion est la
transaction de `decidePurchaseAction` (vérification du solde → écriture
comptable → octroi), sans changer le reste.

## Portée de l'accès

- Tous les membres **actifs** du groupe autorisé voient les informations
  connues du dossier.
- Un membre **ajouté plus tard** obtient l'accès automatiquement (l'accès est
  porté par le groupe, pas par la personne).
- Un membre **retiré** du groupe perd l'accès **immédiatement** (testé en e2e).
- Plusieurs groupes peuvent acheter le même dossier.
- Un modérateur peut **révoquer** un accès payé ou accordé — avec un **motif
  obligatoire** et une confirmation (`revokedAt`, `revokedReason`) ; le groupe
  est prévenu avec le motif. Un accès `CREATED_BY_GROUP` **ne se révoque pas**
  (archiver le dossier si besoin).
- Un groupe acquéreur lit le dossier et peut **proposer** des renseignements
  (contributions soumises à revue) ; il ne modifie pas le dossier lui-même.

## Jamais compris dans l'achat

Notes internes de modération, journal d'audit technique, sources détaillées de
renseignement, historique des révisions, commentaires administratifs. Ces
éléments ne sont lus que dans la branche `internal` du service, réservée à
`profile.intel.view`.

## Notifications

Écrites dans la file `NotificationDelivery` **après** validation de la
transaction, et affichées dans les « Échos » de l'application (mode sans bot) :

| Événement | Destinataires | Contenu |
|---|---|---|
| `PROFILE_REQUEST_CREATED` | modérateurs | code, prénom, groupe, demandeur (pseudonyme public) |
| `PROFILE_REQUEST_APPROVED` | chef demandeur | code, prénom, prix |
| `PROFILE_REQUEST_REFUSED` | chef demandeur | code, prénom, motif |
| `PROFILE_UPDATED` | groupes détenteurs (créateur et acquéreurs) | code, **champ** modifié — jamais la nouvelle information |
| `PROFILE_CONTRIBUTION_RECEIVED` | modération | code, champ proposé |
| `PROFILE_CONTRIBUTION_REVIEWED` | contributeur | code, champ, décision, note — jamais la valeur en place |

Aucune information protégée ne transite par une notification. Le **prix
conseillé** (barème `DEFAULT_PROFILE_PRICING`, réglable) n'est détaillé
(nombre de renseignements, grade, multiplicateur) qu'aux lecteurs qui voient
déjà le dossier ; un acheteur potentiel ne reçoit que le montant.
