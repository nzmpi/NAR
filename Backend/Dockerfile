# Build from the repo root: docker build -f Backend/Dockerfile .
# Root context is needed to compile the Vault artifact from Foundry/.

FROM ghcr.io/foundry-rs/foundry:stable AS contracts
USER root
WORKDIR /contracts
COPY Foundry/ .
RUN forge build --skip test --skip script

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY Backend/package.json Backend/package-lock.json ./
RUN npm ci
COPY Backend/tsconfig.json ./
COPY Backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    VAULT_ARTIFACT_PATH=/app/Vault.json
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY Backend/package.json ./
COPY Backend/drizzle ./drizzle
COPY --from=contracts /contracts/out/Vault.sol/Vault.json ./Vault.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]
