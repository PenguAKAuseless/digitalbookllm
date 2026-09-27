# NEXT_PUBLIC_* variables are inlined into the client bundle at build time,
# so the API URL must be known before `next build` runs, not just at
# container start.
FROM node:20-bookworm-slim AS builder

ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Standalone output (next.config.ts) — only the server bundle + traced deps.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Next.js standalone mode binds to os.hostname() unless told otherwise, which
# is unreachable at "localhost" from inside the container — breaks the
# healthcheck below (and anything else probing localhost:3000 in-container).
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:3000 || exit 1

CMD ["node", "server.js"]
