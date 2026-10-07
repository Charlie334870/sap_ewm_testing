# API image. Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Install dependencies first so this layer is reused when only source code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/auth/package.json packages/auth/
COPY packages/audit/package.json packages/audit/
COPY packages/sap-tools/package.json packages/sap-tools/
RUN pnpm install --frozen-lockfile --prod --filter "@ewm/api..."

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api

ENV NODE_ENV=production
USER node
EXPOSE 4000
# Applies pending database migrations, then starts the server.
CMD ["pnpm", "--filter", "@ewm/api", "start"]
