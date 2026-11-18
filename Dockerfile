# Build the web bundle with dev tools, then ship only what the server reads at runtime.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile --production
COPY apps/api/src apps/api/src
COPY packages/core/src packages/core/src
COPY data data
COPY --from=build /app/apps/web/dist apps/web/dist
USER bun
EXPOSE 3000
CMD ["bun", "apps/api/src/server.ts"]
