FROM oven/bun:1.3 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.3

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV DATA_ROOT=/data
ENV FRONTEND_DIST=/app/apps/web/dist

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist

EXPOSE 3002
CMD ["bun", "apps/api/src/index.ts"]
