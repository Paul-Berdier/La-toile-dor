# La Toile d'Or — service bot Discord. Contexte de build : racine du monorepo.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/auth/package.json packages/auth/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
# tsx (devDependency) exécute le TypeScript directement — bot léger
RUN npm ci --no-audit --no-fund --include=dev

COPY packages ./packages
COPY apps/bot ./apps/bot
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

RUN addgroup -S toile && adduser -S toile -G toile && chown -R toile:toile /app
USER toile

# Enregistre les commandes /toile puis démarre le bot
CMD ["sh", "-c", "npx tsx apps/bot/src/deploy-commands.ts && npx tsx apps/bot/src/index.ts"]
