# NAR

A Telegram Mini App and bot for a private group. Users deposit stablecoins into their own deterministic vault contract, earn pooled returns from manual trading, and request manual withdrawals. An admin dashboard handles deposits, settlements and withdrawals.

Full spec: [`project-context.json`](project-context.json). Roadmap: [`NEXT_STEPS.md`](NEXT_STEPS.md).

## Layout

| Folder | What | Stack |
| --- | --- | --- |
| `Backend/` | API, chain scanner, Telegram bot, accounting | Node 22, Fastify, Drizzle, Postgres, viem, grammY |
| `Miniapp/` | Telegram Mini App for users | React, Vite, Tailwind |
| `Admin/` | Admin dashboard (Telegram Login) | React, Vite, Tailwind |
| `Foundry/` | `Factory`, `Vault`, `ProxyBase` contracts | Solidity 0.8.36, Foundry |

## Prerequisites

- Node 22
- Postgres (local or Neon)
- [Foundry](https://getfoundry.sh)
- Submodules: `git submodule update --init --recursive`

## Contracts

```bash
cd Foundry
forge build
forge test
```

The backend derives vault addresses from `Foundry/out/Vault.sol/Vault.json`. Vault addresses depend on the exact creation bytecode, so set `VAULT_CREATION_CODE_HASH` in the backend to pin it.

## Backend

```bash
cd Backend
cp .env.example .env   # fill DATABASE_URL, OWNER_TELEGRAM_ID, BOT_TOKEN, TELEGRAM_CLIENT_SECRET, SESSION_SECRET (32+ chars)
npm ci
npm run db:migrate     # applies drizzle/ migrations, including the pool seed
npm run dev            # http://localhost:3000, health at /health and /health/db
```

- `npm test` runs the accounting and integration checks against in-memory PGlite. No database or `.env` needed.
- `npm run build` compiles to `dist/`; `npm start` runs it.
- `APP_ENV=prod` turns on strict checks: RPC URLs required, `TREASURY_ADDRESSES` required, onchain sweep verification.
- Schema change: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.

### Docker

Build from the repo root. The image compiles the Vault artifact and runs migrations before the server starts.

```bash
docker build -f Backend/Dockerfile -t nar-backend .
docker run --env-file Backend/.env -p 3000:3000 nar-backend
```

## Mini App

```bash
cd Miniapp
cp .env.example .env   # VITE_API_URL; add http://localhost:5173 to the backend's CORS_ORIGINS
npm ci
npm run dev            # http://localhost:5173
```

Outside Telegram, paste a real `WebApp.initData` string into `VITE_DEV_INIT_DATA` to test in a browser. Never commit it.

## Admin

```bash
cd Admin
cp .env.example .env
npm ci
npm run dev            # http://localhost:5174
```

Login uses Telegram Login. The backend's `ADMIN_ORIGIN` must match the Admin URL, and only the owner and added admins can sign in.

## CI

`.github/workflows/ci.yml` runs on every PR and on pushes to `main`:

- format check (`npm run format` must change nothing) in Backend, Admin and Miniapp
- Backend `tsc` and `npm test`
- Admin and Miniapp `npm run build`
- `forge build` and `forge test`
- backend Docker image build; on `main` it is pushed to `ghcr.io/nzmpi/nar-backend`
