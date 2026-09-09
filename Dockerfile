# Dockerfile (Phase 6) — multi-stage: deps → build → slim runtime.
# node:22-alpine matches ci.yml's node-version: 22.
#
# Runtime CMD runs `npx prisma migrate deploy` BEFORE `node server.js` so every
# container start (first deploy and every Watchtower-triggered restart alike)
# applies pending migrations before serving traffic. Migrations added in future
# phases must therefore stay additive/backward-compatible with the previously
# deployed image — the deploy is a hard stop/start cutover, not a rolling one.

# ---- deps: full install, cached as its own layer ------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate Prisma client, build standalone output, prune to prod --
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Prisma client is generated, not committed (no postinstall script in
# package.json), so it must exist before `next build` type-checks routes that
# import @prisma/client.
RUN npx prisma generate
# BUILD-TIME ENV STUBS (not the real production secrets — those are supplied at
# CONTAINER RUNTIME via `docker run -e` / compose.yml's ${VAR} interpolation,
# never baked into this image). `next build`'s page-data collection step
# imports every route module to trace it, and several modules read process.env
# at MODULE-EVAL time, not just inside request handlers — most visibly
# lib/totpEncryption.ts's `Buffer.from(process.env.TOTP_ENCRYPTION_KEY!, ...)`,
# which throws synchronously on `undefined` and fails the whole build. The
# values below are the same throwaway CI constants already used in
# .github/workflows/ci.yml — real enough in *shape* (a valid 32-byte base64
# key, a syntactically valid URL) to satisfy build-time module evaluation,
# never used to serve real traffic.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build"
ARG REDIS_URL="redis://localhost:6379"
ARG NEXTAUTH_URL="http://localhost:3000"
ARG NEXTAUTH_SECRET="build-time-placeholder-not-for-production"
ARG TOTP_ENCRYPTION_KEY="dGVzdC1rZXktMzItYnl0ZXMtcGFkZGVkLTEyMzQ1Njc4OQ=="
ARG WEBAUTHN_RP_ID="localhost"
ENV DATABASE_URL=$DATABASE_URL \
    REDIS_URL=$REDIS_URL \
    NEXTAUTH_URL=$NEXTAUTH_URL \
    NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
    TOTP_ENCRYPTION_KEY=$TOTP_ENCRYPTION_KEY \
    WEBAUTHN_RP_ID=$WEBAUTHN_RP_ID
RUN npm run build
# Shrink node_modules to production deps only; the runner stage copies this
# pruned tree wholesale (see note there).
RUN npm prune --omit=dev

# ---- runner: standalone server + migrate entrypoint ---------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# prisma/ (schema + migrations) is needed by `prisma migrate deploy` at boot.
COPY --from=builder /app/prisma ./prisma
# NOTE (deviation from the master plan's runtime-stage excerpt): the plan copied
# only node_modules/{.bin/prisma, prisma, @prisma}, but this repo pins Prisma
# 6.19.x, whose CLI loads @prisma/config at runtime — and @prisma/config depends
# on packages OUTSIDE the @prisma scope (c12, effect, empathic, deepmerge-ts).
# A selective copy therefore breaks `npx prisma migrate deploy` in the runner.
# Copying the pruned production node_modules is the robust equivalent.
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
