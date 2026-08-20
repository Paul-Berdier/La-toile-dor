# 🕸️ La Toile d'Or

Plateforme clandestine de contrats pour un serveur de jeu de rôle dans un
univers de shinobis. **Tout le contenu est fictif et limité au cadre du RP.**

Accès strictement privé : invitation à usage unique + Discord OAuth2.
Une invitation valide active immédiatement le compte ; aucune inscription publique.

## Démarrage local

```bash
# 1. Dépendances
npm install

# 2. Base PostgreSQL locale
docker compose up -d

# 3. Environnement (générer les secrets)
cp .env.example .env
# renseigner les valeurs, puis copier le fichier vers chaque workspace :
cp .env apps/web/.env ; cp .env packages/database/.env ; cp .env apps/bot/.env

# 4. Migrations + données de démonstration (100 % fictives)
npm run db:migrate
npm run db:seed   # affiche UNE FOIS le lien d'invitation du super admin

# 5. Lancer
npm run dev       # web sur http://localhost:3000
# (optionnel — non utilisé dans la configuration retenue :)
# npm run dev:bot # bot Discord, exige DISCORD_BOT_TOKEN + bot sur le serveur
```

Notifications : sans bot, les joueurs reçoivent leurs « Échos » directement
dans l&rsquo;application (page 響, pastille de non-lus).

En développement, `DEV_LOGIN="1"` permet d'incarner un utilisateur du seed :
`/api/dev/login?as=demo-admin|demo-mod|demo-chief-0|demo-member-0-0-0`
(neutralisé en production, testé).

## Tests

```bash
npm test                                   # unitaires (Vitest)
npm run build && npm run test:e2e          # e2e Playwright — build de production
```

Les tests e2e vérifient notamment que les données confidentielles de mission
ne quittent JAMAIS le serveur pour un utilisateur non autorisé.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure, décisions, flux
- [docs/MISSION_BOARD.md](docs/MISSION_BOARD.md) — le tableau des contrats (kanban et liste)
- [docs/MISSION_EDITOR.md](docs/MISSION_EDITOR.md) — l'éditeur de mission (une page)
- [docs/MISSION_PUBLIC_TITLE.md](docs/MISSION_PUBLIC_TITLE.md) — titre public généré
- [docs/MISSION_PROFILE_LINKS.md](docs/MISSION_PROFILE_LINKS.md) — cibles, commanditaires, snapshots
- [docs/MISSION_ASSIGNMENTS.md](docs/MISSION_ASSIGNMENTS.md) — revendications et attribution
- [docs/MISSION_REPORTS.md](docs/MISSION_REPORTS.md) — rapport de fin de mission
- [docs/MISSION_LEGACY_MIGRATION.md](docs/MISSION_LEGACY_MIGRATION.md) — missions antérieures à la refonte
- [docs/CHARACTER_PROFILES.md](docs/CHARACTER_PROFILES.md) — dossiers de renseignement
- [docs/PROFILE_VISIBILITY.md](docs/PROFILE_VISIBILITY.md) — « Inconnu » vs « ??? », matrice des droits
- [docs/PROFILE_REFERENCE_DATA.md](docs/PROFILE_REFERENCE_DATA.md) — référentiels Naruto et provenance
- [docs/PROFILE_PURCHASES.md](docs/PROFILE_PURCHASES.md) — achat d'un dossier par un groupe
- [docs/RP_AGE_CALCULATION.md](docs/RP_AGE_CALCULATION.md) — âge suivant le temps RP
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — identité « Réseau d'Obsidienne »
- [docs/SECURITY.md](docs/SECURITY.md) — modèle de menace et mesures
- [docs/DEPLOYMENT_RAILWAY.md](docs/DEPLOYMENT_RAILWAY.md) — guide de déploiement
