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
   - **Config-as-code file** : `railway.json` (racine) — build Dockerfile
     `apps/web/Dockerfile`, healthcheck `/connexion`.
   - **Root Directory** : `/` (le Dockerfile a besoin du monorepo entier).
3. **Networking** → **Generate Domain** → noter l'URL publique
   (ex. `https://toile-web-production.up.railway.app`).

## 4. Service bot

1. **+ New** → **GitHub Repo** → même dépôt (second service).
2. **Config-as-code file** : `apps/bot/railway.json` (Dockerfile
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
