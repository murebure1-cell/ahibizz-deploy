FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@12.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# Keep the frozen mail package at the root resolution path used by operator commands.
# Next's pnpm trace can otherwise retain only a nested package entry.
RUN node --input-type=module -e "import { cpSync } from 'node:fs'; cpSync('node_modules/nodemailer', '.next/standalone/node_modules/nodemailer', { recursive: true, dereference: true })"

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
# Operator checks need Node-resolvable drivers, not only code bundled in Next.
# Importing the mailer validates packaging without creating a transport or sending mail.
RUN node --input-type=module -e "await import('pg'); const { default: smtp } = await import('nodemailer'); if (typeof smtp.createTransport !== 'function') throw new Error('SMTP runtime unavailable')"
RUN node scripts/initial-owner.mjs --help
CMD ["node", "scripts/start.mjs"]
