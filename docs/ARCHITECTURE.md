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

## Flux bot

- **Dispatcher** (15 s) : lit `NotificationDelivery` PENDING échues, regroupe
  par utilisateur (fenêtre 60 s, digest), respecte préférences/sourdine/heures
  silencieuses, DM, retries ×5 backoff 1 min→4 h.
- **Sync rôles** (10 min) : membres du serveur Discord ; départ ou perte des
  rôles critiques (`DISCORD_REQUIRED_ROLE_IDS`) → SUSPENDED + sessions
  révoquées + audit.
- **Expirations** (1 min) : missions au-delà de `expiresAt` (délai non
  suspendu) → EXPIRED + historique + notifications ; alerte « délai proche »
  à 24 h.
- **Slash commands** `/toile missions|mission|classement|notifications|statut`
  — réponses éphémères, données publiques uniquement.
