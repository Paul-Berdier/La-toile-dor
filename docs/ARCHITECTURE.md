# La Toile d'Or — Architecture

## Vue d'ensemble

Monorepo npm workspaces, deux services déployables + PostgreSQL :

```
apps/
  web/          Next.js 15 (App Router) — interface, API, auth, admin
  bot/          discord.js 14 — DM, slash commands, sync rôles, expirations
packages/
  database/     Prisma (schéma, migrations, seed, client généré)
  shared/       Zod, temps RP, points, permissions, sérialiseurs de vues
  auth/         crypto, sessions, invitations, OAuth Discord, autorisation, audit
  ui/           tokens CSS du design system
  config/       tsconfig de base
docs/           DESIGN_SYSTEM, SECURITY, ARCHITECTURE, DEPLOYMENT_RAILWAY
```

## Séparation des responsabilités

| Couche | Où | Règle |
|---|---|---|
| Interface | `apps/web/app`, `components/` | Aucune logique d'autorisation ; reçoit des vues déjà filtrées |
| Règles métier | `apps/web/server/*` | Actions serveur : autorisation → validation Zod → transaction → audit → notifications |
| Authentification | `packages/auth` | Sessions hashées en base, invitations poivrées, RBAC |
| Accès aux données | `packages/database` | Prisma uniquement ; index et contraintes en schéma |
| Bot Discord | `apps/bot` | Seul émetteur de messages Discord ; consomme la file |
| Notifications | table `NotificationDelivery` | Le web écrit, le bot lit — découplage total |

## Décisions structurantes

1. **Confidentialité par construction** — les sérialiseurs
   `public/assigned/moderator` (packages/shared) sont l'unique chemin de
   sortie d'une mission ; un champ confidentiel n'existe pas dans un DTO de
   niveau inférieur. Testé unitairement et en e2e sur build de production.
2. **File de notifications en PostgreSQL, pas de Redis** — volumétrie d'un
   serveur RP (dizaines d'utilisateurs) ; `NotificationDelivery` porte statut,
   retries avec backoff exponentiel, regroupement (`batchKey`), historique.
   Si le bot tombe, rien n'est perdu. Redis ne serait justifié qu'à fort débit.
3. **Auth maison plutôt qu'Auth.js** — le parcours invitation → OAuth →
   approbation → révocation immédiate exige un contrôle fin des sessions en
   base ; Auth.js v5 (beta) aurait été contourné en permanence. ~300 lignes
   auditées, testées.
4. **Server Actions pour les mutations** — CSRF géré par Next, co-localisation
   avec les pages, revalidation ciblée. Les routes API ne servent qu'à OAuth
   et à la santé.
5. **Temps RP centralisé** — `packages/shared/src/rp-time.ts`, ratio
   configurable en base (`AppSetting.rp_time`) ; les dates d'expiration sont
   TOUJOURS stockées en réel UTC, le temps RP n'est qu'une projection.
6. **Mode dev ≠ production** — React dev streame les valeurs awaitées au
   navigateur (débogage) ; toutes les garanties de non-fuite sont validées
   sur build de production (voir SECURITY.md §5).

## Cycle de vie d'une mission

```
DRAFT → AVAILABLE ⇄ CLAIM_PENDING → ASSIGNED → IN_PROGRESS
                     ↓ (refus)         → COMPLETED | FAILED
AVAILABLE/…/IN_PROGRESS → CANCELLED | EXPIRED       → ARCHIVED
```

Colonnes Kanban : À prendre (AVAILABLE, CLAIM_PENDING) · En cours (ASSIGNED,
IN_PROGRESS) · Accomplies · Échouées (FAILED, EXPIRED) · Annulées.
Chaque transition écrit `MissionStatusHistory` + `AuditLog` et déclenche les
notifications ; les transitions critiques exigent confirmation + justification.

## Notifications et automatisations — mode « sans bot » (configuration retenue)

Le serveur a choisi de ne PAS placer le bot sur Discord. Tout est assuré par
le service web :

- **Échos in-app** (`/notifications`) : la file `NotificationDelivery`
  alimente une page d'échos par utilisateur, avec pastille de non-lus dans la
  navigation ; l'affichage marque les échos comme lus.
- **Expirations** : balayage paresseux throttlé (1/min) au chargement du
  tableau (`apps/web/server/expiration.ts`) — EXPIRED + historique + échos ;
  alerte « délai proche » à 24 h.
- **Contrôle des rôles Discord À LA CONNEXION** : perte de tous les rôles
  critiques (`DISCORD_REQUIRED_ROLE_IDS`) → SUSPENDED + sessions révoquées +
  audit. (Le jeton OAuth du joueur suffit ; aucun bot requis.)
  Limite assumée : le contrôle a lieu à la connexion, pas en continu — une
  session déjà ouverte reste valide jusqu'à 7 jours ou révocation manuelle.

## Flux bot (OPTIONNEL — non déployé dans la configuration retenue)

`apps/bot` reste dans le dépôt si un jour les DM Discord sont souhaités —
Discord n'autorise les DM de bot qu'avec un serveur en commun :

- **Dispatcher** (15 s) : DM depuis `NotificationDelivery`, digest, retries.
- **Sync rôles** (10 min) : suspension continue au lieu de « à la connexion ».
- **Slash commands** `/toile …` — réponses éphémères, données publiques.
