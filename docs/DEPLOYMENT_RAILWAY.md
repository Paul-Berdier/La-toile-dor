# La Toile d'Or — Déploiement Railway

Deux éléments suffisent dans la configuration retenue (« sans bot ») :
**PostgreSQL** (plugin Railway) et le **service web** (Next.js).
Le **service bot** (§4, §9-10) est OPTIONNEL : ne le créez que si vous
décidez un jour d'envoyer des DM Discord — il exige alors que le bot
rejoigne le serveur RP. Sans lui : notifications in-app (« Échos »),
expiration automatique côté web, contrôle des rôles à la connexion.

## 1. Création du projet Railway

1. https://railway.app → **New Project** → **Empty Project**.
2. Nommer le projet (ex. `la-toile-dor`).
3. Lier le dépôt GitHub du monorepo (Settings → Connect Repo), ou utiliser
   `railway up` avec la CLI.

## 2. Ajout de PostgreSQL

1. **+ New** → **Database** → **PostgreSQL**.
2. Railway expose `DATABASE_URL` ; on la référencera dans les deux services
   via `${{Postgres.DATABASE_URL}}` (adapter le nom du service Postgres).

## 3. Service web

1. **+ New** → **GitHub Repo** → sélectionner le dépôt.
2. Settings du service :
   - **Config-as-code file** : `/railway.json` (chemin absolu depuis la racine) — build Dockerfile
     `apps/web/Dockerfile`, healthcheck `/connexion`.
   - **Root Directory** : `/` (le Dockerfile a besoin du monorepo entier).
3. **Networking** → **Generate Domain** → noter l'URL publique
   (ex. `https://toile-web-production.up.railway.app`).

## 4. Service bot

1. **+ New** → **GitHub Repo** → même dépôt (second service).
2. **Config-as-code file** : `/apps/bot/railway.json` (chemin absolu ; Dockerfile
   `apps/bot/Dockerfile`). Root Directory `/`.
3. Aucun domaine public nécessaire (le bot sort vers Discord).

## 5. Variables d'environnement

Sur **les deux services** (Variables → RAW Editor) :

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_REQUIRED_ROLE_IDS=idRole1,idRole2
APP_URL=https://<domaine-du-service-web>
```

Sur le **service web** uniquement :

```env
AUTH_SECRET=<openssl rand -base64 32>
INVITE_TOKEN_PEPPER=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
```

Ne JAMAIS mettre `DEV_LOGIN` en production. Secrets de production distincts
de ceux du développement local.

## 5 bis. Dossiers de renseignement — points de déploiement

- **Aucune nouvelle variable d'environnement.** Les portraits sont stockés en
  base (`CharacterProfile.imageData`), comme les emblèmes de groupe : le
  système de fichiers Railway étant éphémère, aucun volume ni service de
  stockage objet n'est requis. Les images **survivent donc aux redéploiements**.
- La migration `20260804090000_character_profiles` est **additive** (nouvelles
  tables, enums, index partiels, contraintes CHECK) : aucune table ni colonne
  existante n'est modifiée ou supprimée.
- Le seed des **référentiels** (105 entrées Naruto vérifiées) est idempotent et
  s'exécute aussi en mode production (`SEED_DEMO=0`) — il ne crée aucune donnée
  fictive de démonstration.
- Les **nouvelles permissions** (`profile.manage`, `profile.intel.view`,
  `profile.purchase.review`, `profile.request.create`,
  `profile.reference.manage`, `profile.merge`) sont créées par le seed et
  rattachées aux rôles. **Sans relancer le seed, les modérateurs n'auront pas
  accès aux dossiers** — voir §6.

Surveillance de la taille : chaque portrait est plafonné à 500 Ko. Pour ~200
dossiers illustrés, compter environ 100 Mo dans PostgreSQL.

## 6. Migrations Prisma

Le conteneur web exécute `prisma migrate deploy` **à chaque démarrage** avant
de lancer le serveur (voir `apps/web/Dockerfile`). Pour le premier
peuplement (rôles, niveaux, rangs, invitation initiale du super admin) :

```bash
railway run --service <service-web> \
  node node_modules/prisma/build/index.js db seed --schema packages/database/prisma/schema.prisma
```

ou depuis un poste local pointant `DATABASE_URL` de production :

```bash
cd packages/database
DATABASE_URL="<url-production>" INVITE_TOKEN_PEPPER="<pepper-production>" APP_URL="<url-web>" npm run seed
```

Le seed affiche **une seule fois** le lien d'invitation du super
administrateur : le consommer immédiatement.

### Empreintes de migration et fins de ligne

Prisma calcule l'empreinte (checksum) de chaque migration au moment où il
l'applique. Si le fichier change ensuite, il considère qu'une migration
appliquée a été modifiée et propose un `migrate reset` — **c'est-à-dire la
destruction de la base**. Ne jamais accepter.

La cause la plus fréquente ne se voit pas dans le SQL : sous Windows,
`core.autocrlf` réécrit les fichiers en CRLF au checkout, ce qui change
l'empreinte sans changer une ligne. Le dépôt fige donc les fins de ligne
(`.gitattributes` : `*.sql text eol=lf`). Le déploiement Railway (Linux) n'est
pas concerné — il a toujours reçu les fichiers en LF.

Si l'écart existe déjà, la voie non destructive est
`packages/database/scripts/repair-migration-checksums.mjs` : il réaligne la
colonne `checksum` de `_prisma_migrations` sur le contenu réel des fichiers,
sans jamais toucher au schéma ni aux données.

```bash
node scripts/repair-migration-checksums.mjs
```

Sans `--apply`, il se contente d'énumérer les écarts. À n'utiliser qu'après
avoir vérifié que le schéma correspond bien au SQL des fichiers
(`prisma migrate status` → « Database schema is up to date »).

### Référentiels après la migration identité/groupes

La migration `20260803150000_identity_groups_multiassign` ajoute trois clés
RBAC qui doivent être affectées aux rôles de production : `group.create`,
`group.edit.any` et `identity.view.real`.

Méthode recommandée : définir temporairement `BOOTSTRAP_SEED=1` sur le service
web puis redéployer. Le `Dockerfile` force `SEED_DEMO=0`, donc seuls les
référentiels sont rejoués. Vérifier `Seed terminé.` dans les logs, retirer
immédiatement `BOOTSTRAP_SEED`, puis redéployer une seconde fois.

Alternative sans seed : exécuter le script idempotent
[`packages/database/prisma/production/20260803_identity_group_permissions.sql`](../packages/database/prisma/production/20260803_identity_group_permissions.sql)
dans l'éditeur SQL Railway ou avec un client `psql` connecté à la base de
production. La requête finale doit renvoyer 6 lignes.

## 7. URL publique

L'URL générée à l'étape 3 EST la valeur d'`APP_URL`. Toute modification de
domaine (custom domain) impose de mettre à jour `APP_URL` **et** le callback
OAuth (étape 8).

## 8. Callback Discord OAuth

Dans https://discord.com/developers/applications → votre application →
**OAuth2** → **Redirects**, ajouter exactement :

```
https://<domaine-du-service-web>/api/auth/callback
```

(et `http://localhost:3000/api/auth/callback` pour le développement).

## 9. Création de l'application Discord

1. https://discord.com/developers/applications → **New Application**.
2. **OAuth2** : copier `CLIENT ID` et `CLIENT SECRET`.
3. **Bot** : créer le bot, copier le **TOKEN**, activer l'intent privilégié
   **SERVER MEMBERS INTENT** (obligatoire pour la synchronisation des rôles).
4. Récupérer l'ID du serveur RP (clic droit sur le serveur → Copier
   l'identifiant, mode développeur activé) → `DISCORD_GUILD_ID`.

## 10. Permissions du bot

URL d'invitation du bot (scopes `bot` + `applications.commands`) :

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands&permissions=0
```

Le bot n'a besoin d'**aucune permission de serveur** : il lit les membres
(intent), envoie des DM et répond aux slash commands. Les commandes `/toile`
sont enregistrées automatiquement au démarrage du conteneur bot.

## 11. Déploiement

- Push sur la branche liée → build + déploiement automatiques des deux
  services.
- Vérifier : service web « Active » + healthcheck vert ; logs du bot montrant
  `connecté en tant que …`, `dispatcher démarré`, `sync démarrée`.

## 12. Logs

Onglet **Deployments → View Logs** de chaque service. À surveiller :
`[dispatcher]` (échecs de DM), `[sync]` (suspensions), `[expiration]`,
et côté web les erreurs Prisma/OAuth. Aucune donnée confidentielle de mission
n'est journalisée.

## 13. Sauvegardes

- Railway PostgreSQL : activer les **backups** du volume (onglet Backups du
  service Postgres — quotidien recommandé).
- Sauvegarde manuelle ponctuelle :

```bash
railway run --service Postgres pg_dump -Fc "$DATABASE_URL" > toile-$(date +%F).dump
```

- Restauration : `pg_restore -d "$DATABASE_URL" --clean toile-YYYY-MM-DD.dump`.

## 14. Mise à jour

1. Merger sur la branche de production ; Railway reconstruit.
2. Les migrations s'appliquent au démarrage (`migrate deploy`, additif).
3. En cas de migration destructive : sauvegarde manuelle (§13) AVANT merge.

## 15. Rollback

- **Code** : Deployments → déploiement précédent → **Redeploy** (les deux
  services si nécessaire).
- **Base** : les migrations Prisma ne se « déroulent » pas automatiquement —
  restaurer la sauvegarde (§13) puis redéployer la version de code
  correspondante.
- **Secrets compromis** : régénérer dans Railway + Discord Developer Portal,
  redéployer ; les sessions actives survivent à tout sauf à la révocation en
  base (admin → utilisateurs) — révoquer les accès douteux depuis
  l'administration.
