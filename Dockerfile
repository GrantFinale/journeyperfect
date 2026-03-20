# Stage 1: Install ALL dependencies (incl. devDeps for building)
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
# Override any injected NODE_ENV=production so devDependencies are installed
ENV NODE_ENV=development
RUN npm ci

# Stage 2: Build
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=development
ENV DATABASE_URL=postgresql://build:build@localhost:5432/journeyperfect
ENV NEXTAUTH_URL=http://localhost:3000
ENV NEXTAUTH_SECRET=build-time-secret
ENV GOOGLE_CLIENT_ID=build-placeholder
ENV GOOGLE_CLIENT_SECRET=build-placeholder
ENV NEXT_PUBLIC_GOOGLE_PLACES_KEY=build-placeholder
ENV GOOGLE_PLACES_KEY=build-placeholder
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
RUN npx prisma generate
ENV NODE_OPTIONS="--max-old-space-size=1536"
ENV NODE_ENV=production
RUN npm run build
# Prune to production-only deps for runner stage
RUN npm prune --production

# Stage 3: Minimal production runner
FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy all production node_modules (includes prisma CLI and its full dep tree)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
