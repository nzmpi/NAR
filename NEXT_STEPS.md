# Next steps

Status 2026-11-19: Backend, Mini App and Admin dashboard are merged to `main`. Backend security review is done; medium findings are fixed. Factory implementation (`0x9593…bafc`) and its ProxyBase (`0x1559…a424`; this proxy is `FACTORY_ADDRESS`) are deployed at the same addresses on Base Sepolia (84532) and Arbitrum Sepolia (421614).

Plan: launch on Base Sepolia and Arbitrum Sepolia with test users and test USDC first. Contracts, fixes and features can change after that. Mainnet comes later.

Mark a step done by changing `[ ]` to `[x]`.

## 0. Housekeeping

- [x] **Commit `project-context.json` and `NEXT_STEPS.md`** — both are uncommitted on `main`.
- [x] **Write `README.md`** — it is empty. Add what the project is, folder layout, and how to run each part locally.
- [x] **Add CI** — GitHub Actions that runs Backend `tsc` + `npm test`, Admin and Miniapp `npm run build`, and `forge test`, on every PR. Also builds the backend Docker image (see section 3).

## 1. Decisions

- [x] **Withdrawal minimum** — 5 USD. The backend already enforces it.
- [x] **Update spec to 5 USD** — change `minimum_withdrawal_usd` in `project-context.json`.
- [x] **Hosting** — backend on the free Oracle AMD server; Admin and Miniapp on Vercel.
- [x] **No paid domain** — the backend gets a free DuckDNS subdomain for HTTPS. Admin and Miniapp stay on `*.vercel.app`.
- [x] **Testnets** — Base Sepolia and Arbitrum Sepolia.
- [x] **Test token** — test USDC only.
- [x] **Test-user access** — run the testnet deploy with `APP_ENV=prod` plus the new user allowlist. This exercises the strict prod checks (RPC required, treasury allowlist, onchain sweep verification). Mainnet later gets a fresh database.
- [x] **Database location** — Neon free Postgres. The 1 GB AMD server runs only the backend.

## 2. Pre-testnet fixes

- [x] **User allowlist** — in prod only allowlisted Telegram IDs can sign up. Admin can add and remove IDs. Applies to the Mini App and the bot.
- [x] **Admin idempotency** — a double-click on settle must not record two settlements. Add idempotency keys to admin state-changing actions.
- [x] **Session revocation** — logout must invalidate the admin session at once, not after 8 hours.

## 3. Oracle server setup (backend)

- [ ] **Server base** — OS updates, SSH key only, 2 GB swap file, firewall (Oracle security list + host firewall) open only 22, 80, 443.
- [ ] **DuckDNS subdomain** — create a free `<name>.duckdns.org` pointing at the server's public IP.
- [x] **Backend Dockerfile** — multi-stage build of `dist/`, pinned Foundry image. The container only starts the server; migrations are a separate step (`docker compose run --rm backend node dist/migrate.js`).
- [x] **Build image off the server** — build in GitHub Actions and push to GHCR (or build locally). `npm ci` + `tsc` can run out of memory on 1 GB.
- [x] **Docker Compose** — services `backend` and `caddy`. Caddy gets the HTTPS certificate for the DuckDNS name automatically.
- [ ] **Neon database** — create a project in the region nearest the Oracle server. Use the direct (non-pooled) connection string with `sslmode=require` for `DATABASE_URL` and migrations. Free-tier compute sleeps when idle, so the first query after a pause is slower.
- [x] **Migration runbook** — how to run `node dist/migrate.js` on a fresh DB, and the rule for future migrations once a DB holds funds: `pg_dump` first, then migrate, then pull and restart. Deploy by the `:<sha>` image tag, not `:latest`.
- [ ] **Env and secrets** — a server-only `.env` with every variable from `Backend/.env.example`: `APP_ENV=prod`, `SESSION_SECRET`, `BOT_TOKEN`, `TELEGRAM_CLIENT_SECRET`, `TREASURY_ADDRESSES`, `RPC_URL_84532`, `RPC_URL_421614`, `FACTORY_ADDRESS`, `VAULT_CREATION_CODE_HASH`, `TRUST_PROXY_HOPS=1`. Clear the unused `RPC_URL_137/8453/56`.
- [ ] **Bot mode** — `BOT_MODE=polling` is simplest on one server; `webhook` also works on the DuckDNS HTTPS URL.
- [ ] **Backups** — `deploy/backup.sh` does a daily `pg_dump` to Oracle Object Storage. Left on the server: bucket, write-only PAR, cron, and one test restore (`deploy/RUNBOOK.md`).
- [ ] **Monitoring** — uptime check on the health endpoint; alert when the scanner or notification outbox stalls.

## 4. Vercel setup (Admin + Miniapp)

- [ ] **Miniapp project** — build `Miniapp/`, set `VITE_API_URL=https://<name>.duckdns.org`. It authenticates with a header, so cross-site is fine.
- [ ] **Admin project** — build `Admin/` with `VITE_API_URL` empty. Add Vercel rewrites that forward the backend's admin API paths to `https://<name>.duckdns.org`. The browser then sees the API on the same `*.vercel.app` site, so the `SameSite=Lax` session cookie works without a domain.
- [ ] **Admin callback** — set `ADMIN_ORIGIN` and `ADMIN_CALLBACK_URL` to the Admin Vercel URL, so the OIDC callback also goes through the rewrite.
- [ ] **CORS** — set `CORS_ORIGINS` on the backend to the Miniapp Vercel URL.

## 5. Telegram setup

- [ ] **BotFather** — set the Mini App URL (Miniapp Vercel URL) and the Login domain and callback (Admin Vercel URL).

## 6. Testnet contracts

- [ ] **Create Safes** — a factory-owner Safe and a separate proxy-admin Safe on Base Sepolia and Arbitrum Sepolia.
- [ ] **Check current owners** — read the Factory owner and proxy admin on both testnets. Transfer both to the Safes, or redeploy with the Safes as owners.
- [ ] **Confirm vault addresses** — one user's vault address matches on both chains.
- [ ] **Configure chains and USDC** — add both chains and the test USDC contract address per chain in Admin.
- [ ] **Treasury address** — set `TREASURY_ADDRESSES` to the testnet sweep destination.

## 7. Testnet end-to-end (owner first)

- [ ] **Deposit flow** — intent, USDC transfer, scanner match, vault deploy via Safe, sweep, activation, Telegram notification.
- [ ] **Verify `verifySweepTx` on a real RPC** — this check has never run against a real chain.
- [ ] **Accounting flow** — settlement (incl. large-move guard), maturity, relock, bonus.
- [ ] **Withdrawal flow** — quote with early fee, reserve, cancel, reject, pay, notification.
- [ ] **Admin login** — Telegram Login through the Vercel rewrite; logout revokes the session.
- [ ] **Mini App on real clients** — Telegram iOS, Android and Desktop.

## 8. Testnet launch with test users

- [ ] **Operator runbook** — how often to settle, how to process withdrawals, what to do on a wrong token or an incident.
- [ ] **Risk notice** — users see that returns are projected, not guaranteed, before the first deposit.
- [ ] **Invite test users** — add their Telegram IDs to the allowlist; send them test USDC.
- [ ] **Collect feedback** — list bugs and UX issues from test users.

## 9. After testnet

- [ ] **Payout tx-hash check** — one payout hash must not mark several withdrawals paid; optionally verify the payout onchain.
- [ ] **Contract hardening** — sweep events and recipient-address checks in `Factory.sol` / `Vault.sol`.
- [ ] **External contract review** — before real funds.
- [ ] **Real domain** — buy one before mainnet; move Admin and API to subdomains of it.
- [ ] **Mainnet** — mainnet Safes, Factory on Polygon, Base and BNB Chain at one address, fresh prod DB, owner dry run with a small real amount.
- [ ] **Donation and vault-sharing features** — out of current scope.
