# Achat d'un dossier par un groupe

## Parcours

1. Un **chef de groupe** ouvre un dossier qu'il ne possède pas et clique
   « Demander l'accès pour mon groupe ». S'il dirige plusieurs groupes, il
   choisit lequel. Un **agent** ne peut pas créer de demande.
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
- Un modérateur peut **révoquer** un accès à tout moment (`revokedAt`).

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
| `PROFILE_UPDATED` | groupes détenteurs | code, prénom — **jamais la nouvelle information** |

Aucune information protégée ne transite par une notification.
