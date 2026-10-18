# API image. Host apps/web/dist separately; this image does not serve the UI.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# The official Qloo harness requires Node >=22.19.0. Fail if a cached base is old.
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<19)) process.exit(1)"
RUN npm install --global pnpm@10.18.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/solver/package.json ./packages/solver/package.json
COPY packages/qloo/package.json ./packages/qloo/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm typecheck && pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number); if(a<22||(a===22&&b<19)) process.exit(1)"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 QLOO_TRANSPORT=harness QLOO_BASE_URL=https://hackathon.api.qloo.com
# Keep workspace source and its symlinks: packages intentionally export TS.
# tsx is required at runtime; this small prototype has not pruned dev tooling.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3001') + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
