# Built from the repository root: docker compose -f deploy/license-server/compose.yml build
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @inv/license-admin build
RUN pnpm --filter @inv/license-server build
RUN pnpm --filter @inv/license-server deploy --legacy --prod /app
RUN cp -r apps/license-server/dist /app/dist
RUN cp -r apps/license-admin/dist /app/admin

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app .
USER node
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
