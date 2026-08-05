# La Toile d'Or — Sécurité

Application privée d'un serveur de jeu de rôle. Tout le contenu des missions
est fictif ; les mesures ci-dessous protègent les comptes des joueurs et la
confidentialité du RP.

## 1. Modèle de menace

- Accès non invité au site (aucune inscription publique).
- Fuite de données confidentielles de mission vers un joueur non autorisé
  (par l'API, le payload RSC, ou une capture d'écran/stream).
- Vol ou rejeu de session ; invitation devinée ou réutilisée.
- Élévation de privilèges (un membre agissant en modérateur).

## 2. Authentification et sessions

- **Discord OAuth2 uniquement** (`identify`, `guilds.members.read`), aucun mot
  de passe. Les tokens OAuth ne sont **pas persistés** ; seuls id, pseudo et
  avatar sont stockés.
- Flux protégé par un `state` aléatoire (cookie HttpOnly, 10 min).
- L'appartenance au serveur Discord (`DISCORD_GUILD_ID`) est obligatoire.
- **Sessions en base** : le cookie `toile_session` (HttpOnly, `Secure` en
  production, `SameSite=Lax`) contient un jeton de 256 bits ; seul son SHA-256
  est stocké. Durée 7 jours, `lastSeenAt` suivi.
- **Révocation immédiate** : suspendre/révoquer un compte invalide toutes ses
  sessions en une requête (`revokeAllUserSessions`). La validation de session
  vérifie le statut du compte à CHAQUE requête.

## 3. Invitations

- Jeton : 32 octets `crypto.randomBytes`, encodé base64url.
- Stockage : `SHA-256(token + INVITE_TOKEN_PEPPER)` uniquement — une fuite de
  base ne permet pas de forger un lien.
- Usage unique : création du compte, consommation conditionnelle, rôle et
  rattachement au groupe sont dans une même transaction résistante aux courses.
  Expiration obligatoire, révocation et restriction
  possible à un ID Discord précis, approbation manuelle optionnelle.
- Le niveau porté par l'invitation est validé côté serveur et affecté dans
  cette même transaction ; un identifiant de niveau inconnu est refusé.
- Le lien clair n'est affiché **qu'une fois** à sa création.
- Rate-limit : 8 vérifications / 5 min / IP ; messages d'échec génériques
  (« Fil rompu ») ne révélant ni l'existence ni l'état de l'invitation.

## 4. Autorisation (côté serveur, toujours)

- RBAC : `Role` → `RolePermission` → `Permission` (clés atomiques
  `mission.create`, `claim.review`…). Vérifié par `requirePermission` dans
  chaque action serveur et route — masquer un bouton n'est jamais la sécurité.
- Accès confidentiel **par mission** (`viewLevelFor`) :
  modérateur, OU membre de l'un des groupes attribués activement, OU participant
  explicite. Une revendication seule n'accorde aucun accès.
- Les agents choisis sont revalidés côté serveur lors de la revendication,
  lors de son acceptation et lors d'une attribution manuelle : compte actif,
  appartenance actuelle au groupe et groupe actif. Un même agent ne peut
  représenter deux groupes sur la même mission.
- Retirer les attributions supprime dans la même transaction les participants
  et donc leur accès confidentiel. Les décisions concurrentes sur une
  revendication utilisent des écritures gardées et des transactions
  `Serializable`.
- Une mission accomplie et créditée devient immuable : elle ne peut pas être
  rouverte, et la présence d'un score antérieur bloque tout second versement
  de points ou de ryō.
- Le roster d'un groupe attribué est privé par défaut. Seuls la modération,
  les membres de ce groupe ou les joueurs bénéficiant du consentement public
  explicite de son chef le voient. Cette vue publique est construite depuis
  une sélection Prisma limitée à `displayName` : prénom, nom, niveau,
  récompenses et données confidentielles n'y entrent jamais.
- Gestion des groupes : un chef agit uniquement sur un groupe où son
  `GroupMember.isLeader` vaut `true`; `group.edit.any` étend cette portée à la
  modération.
- Une faction est une classification facultative du groupe, jamais un périmètre
  d'autorisation : deux groupes de `Suna` ne partagent ni dossiers, ni identités,
  ni notifications. Aucun rôle de chef de faction n'est utilisé.

## 5. Confidentialité par construction

Les réponses passent par des sérialiseurs à quatre niveaux
(`packages/shared/src/mission-views.ts`) : `public` / `assigned` / `leader` /
`moderator`. **Un champ confidentiel n'existe pas dans le DTO d'un niveau
inférieur** — il n'est ni masqué en CSS, ni vidé, il n'est jamais envoyé.
Vérifié par tests unitaires (clés absentes) et e2e (aucun secret dans le DOM
ni dans aucune réponse réseau, sur build de production).

- `public` : aucune donnée du dossier scellé, y compris pour un chef candidat ;
- `assigned` : briefing opérationnel, mais aucune clé `targetIdentity`,
  `targetFactionId` ou `clientName` ;
- `leader` : noms des cibles et faction des cibles après attribution de l'un
  des groupes effectivement dirigés par l'utilisateur ;
- `moderator` : vue complète, incluant seule le commanditaire (`clientName`).

### Dossiers rattachés à une mission

Une mission peut pointer vers le dossier de sa cible (`targetProfileId`) et
celui de son commanditaire (`clientProfileId`). Ces identifiants suivent
**exactement** la confidentialité du nom correspondant : `targetProfileId` avec
`targetIdentity` (chefs assignés + modération), `clientProfileId` avec
`clientName` (modération seule).

Un identifiant de dossier désigne une personne aussi sûrement que son nom : le
descendre d'un cran dans la hiérarchie des vues reviendrait à publier la cible.
Les clés sont donc listées dans les jeux vérifiés par
`packages/shared/src/mission-views.test.ts`, au même titre que les noms.

⚠ **Le mode développement de React/Next streame des données de débogage
(valeurs des promesses awaitées) vers le navigateur.** Les garanties de
non-fuite valent pour le **build de production** — ne jamais exposer un
serveur `next dev` à de vrais joueurs.

- La recherche ne porte que sur les champs publics (pas d'oracle par la
  recherche de texte confidentiel).
- Les slash commands Discord ne renvoient que des champs publics, en réponse
  éphémère ; les informations sensibles ne transitent que par le site.
- Les payloads de notifications (file `NotificationDelivery`) ne contiennent
  que code, rang, titre public.

### Identités réelles

Le prénom et le nom suivent un second sérialiseur à deux niveaux
(`packages/shared/src/identity.ts`). `canViewRealIdentity` autorise uniquement
la propre identité, un membre d'au moins un même groupe ou un détenteur de
`identity.view.real`. Pour tout autre visiteur, `firstName` et `lastName` sont
absents du DTO et donc du HTML/RSC/réseau.

Les audits et notifications n'enregistrent jamais les prénoms ou noms. La
confirmation de l'encart de confidentialité est horodatée dans
`privacyAcknowledgedAt`.

## 6. Validation et en-têtes

- **Zod côté serveur** sur toutes les entrées (actions et routes).
- Server Actions Next.js : protection CSRF intégrée (vérification d'origine) ;
  mutations par cookies `SameSite=Lax` + POST uniquement.
- En-têtes (voir `next.config.ts`) : CSP (`default-src 'self'`,
  `frame-ancestors 'none'`, images limitées à `cdn.discordapp.com`),
  HSTS en production, isolation COOP/CORP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer`,
  `X-Robots-Tag: noindex`, Permissions-Policy restrictive.
- XSS : React échappe par défaut ; aucun `dangerouslySetInnerHTML`.
- Injections : Prisma paramètre toutes les requêtes.
- Images de groupe : 500 Ko maximum et validation de la signature binaire PNG,
  JPEG ou WEBP avant stockage en base ; le type déclaré par le client n'est pas
  considéré comme une preuve.

## 7. Discrétion

- `robots.txt` interdit toute indexation ; `noindex,nofollow` en méta et
  en-tête ; aucune page publique ne liste membres ou missions.
- Messages d'erreur de connexion génériques (pas d'énumération de comptes).
- Pas de données sensibles dans les URL (identifiants opaques cuid
  uniquement) ni dans les logs.
- Audit : IP **tronquée** (/24, /48), user-agent réduit à la famille.

## 8. Pièces jointes

Clés de stockage opaques, `confidential` par défaut, contrôle d'accès par le
niveau de vue de la mission. Le téléversement (hors périmètre actuel) devra
imposer : liste blanche de types MIME, taille maximale, nettoyage des
métadonnées, service via une route authentifiée (jamais d'URL publique).

## 9. Protection anti-fuite en stream (best effort)

Il est impossible d'empêcher techniquement un utilisateur autorisé de filmer
son écran ; les mesures suivantes limitent les fuites **accidentelles** :
filigrane dynamique multicouche (pseudo, ID partiel, groupes, heure, session),
mode Streamer avec substitution **côté serveur** des valeurs sensibles,
voile de confidentialité (manuel + inactivité), flou à la perte de focus.
La sécurité principale reste le filtrage serveur (§5).

## 10. Secrets et exploitation

- Secrets uniquement dans les variables Railway (`DATABASE_URL`,
  `AUTH_SECRET`, `DISCORD_CLIENT_ID/SECRET`, `DISCORD_BOT_TOKEN`,
  `DISCORD_GUILD_ID`, `INVITE_TOKEN_PEPPER`, `ENCRYPTION_KEY`, `APP_URL`).
  Jamais commités ; `.env*` est ignoré par git ; secrets de dev ≠ prod.
- Rotation : régénérer un secret Railway + redéployer ; la rotation de
  `INVITE_TOKEN_PEPPER` invalide les invitations actives (les recréer).
- `DEV_LOGIN` (connexion de développement) est neutralisée par un double
  verrou (`NODE_ENV`, drapeau) et testée morte en production.
- Sauvegardes PostgreSQL : voir DEPLOYMENT_RAILWAY.md §13.

## 11. Journal d'audit

Événements consignés : connexions (succès/échec/refus), usage et gestion des
invitations, accès accordés/suspendus/révoqués, cycle de vie des missions
(création, revendication, attribution, changements de statut), points,
rapports, erreurs du bot, changements de rôles et de configuration.
Chaque entrée : acteur, action, ressource, date, IP tronquée, UA réduit,
anciennes/nouvelles valeurs utiles, justification. Aucune donnée
confidentielle de mission n'est copiée dans l'audit.
