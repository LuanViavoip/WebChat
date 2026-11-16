FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@12.15.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY infra/seed ./infra/seed

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

ARG GIT_SHA=unknown
ARG BUILT_AT=unknown
ENV GIT_SHA=$GIT_SHA
ENV BUILT_AT=$BUILT_AT

CMD ["pnpm", "--filter", "@viavoip/server", "start"]
