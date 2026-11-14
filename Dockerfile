FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/start.mjs /app/scripts/migrate.mjs /app/scripts/initial-owner.mjs ./scripts/
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
COPY --from=build --chown=node:node /app/src/server/env.ts ./src/server/env.ts
COPY --from=build --chown=node:node /app/src/server/auth/initial-owner.ts ./src/server/auth/initial-owner.ts

USER node
# The migration CLI uses pg too; fail the image build if tracing omitted it.
RUN node --input-type=module -e "await import('pg')"
RUN node scripts/initial-owner.mjs --help
CMD ["node", "scripts/start.mjs"]
