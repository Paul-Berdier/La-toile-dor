# La Toile d'Or — service web (Next.js). Contexte de build : racine du monorepo.
FROM node:22-alpine AS base
WORKDIR /app

# ── Dépendances ──
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/auth/package.json packages/auth/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
RUN npm ci --no-audit --no-fund

# Dépendances réellement nécessaires à l'exécution. Prisma est volontairement
# une dépendance de production car les migrations tournent au démarrage.
FROM deps AS runtime-deps
RUN npm prune --omit=dev

# ── Build ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=apps/web

# ── Exécution ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S toile && adduser -S toile -G toile

# Le CLI Prisma charge plusieurs dépendances transitives (@prisma/config,
# effect, c12, etc.) qui ne font pas partie du traçage standalone de Next.
COPY --from=runtime-deps --chown=toile:toile /app/node_modules ./node_modules

# Sortie standalone de Next (inclut les node_modules tracés)
COPY --from=build --chown=toile:toile /app/apps/web/.next/standalone ./
COPY --from=build --chown=toile:toile /app/apps/web/.next/static ./apps/web/.next/static
# Client Prisma généré (moteur natif) + schéma pour les migrations
COPY --from=build --chown=toile:toile /app/packages/database/generated ./packages/database/generated
COPY --from=build --chown=toile:toile /app/packages/database/prisma ./packages/database/prisma

USER toile
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Applique les migrations puis démarre le serveur
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema packages/database/prisma/schema.prisma && node apps/web/server.js"]
