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

- [x] **Server setup script** — `deploy/server-setup.sh`: OS updates, SSH key only, 2 GB swap file, host firewall open only 22, 80, 443, Docker.
- [x] **Server base** — open TCP 80/443 and UDP 443 in the Oracle security list, then run the script on the server (`deploy/RUNBOOK.md`).
- [x] **DuckDNS subdomain** — `nzmpi.duckdns.org` points at the server's public IP.
- [x] **Backend Dockerfile** — multi-stage build of `dist/`, pinned Foundry image. The container only starts the server; migrations are a separate step (`docker compose run --rm backend node dist/migrate.js`).
- [x] **Build image off the server** — build in GitHub Actions and push to GHCR (or build locally). `npm ci` + `tsc` can run out of memory on 1 GB.
- [x] **Docker Compose** — services `backend` and `caddy`. Caddy gets the HTTPS certificate for the DuckDNS name automatically.
- [x] **Neon database** — create a project in the region nearest the Oracle server. Use the direct (non-pooled) connection string with `sslmode=require` for `DATABASE_URL` and migrations. Free-tier compute sleeps when idle, so the first query after a pause is slower.
- [x] **Migration runbook** — how to run `node dist/migrate.js` on a fresh DB, and the rule for future migrations once a DB holds funds: `pg_dump` first, then migrate, then pull and restart. Deploy by the `:<sha>` image tag, not `:latest`.
- [x] **Env and secrets** — a server-only `.env` with every variable from `Backend/.env.example`: `APP_ENV=prod`, `SESSION_SECRET`, `BOT_TOKEN`, `TELEGRAM_CLIENT_SECRET`, `TREASURY_ADDRESSES`, `RPC_URL_84532`, `RPC_URL_421614`, `FACTORY_ADDRESS`, `VAULT_CREATION_CODE_HASH`, `TRUST_PROXY_HOPS=1`. Clear the unused `RPC_URL_137/8453/56`.
- [ ] **Bot mode** — `BOT_MODE=polling` is simplest on one server; `webhook` also works on the DuckDNS HTTPS URL.
- [x] **Backup script** — `deploy/backup.sh` does a daily `pg_dump` to Oracle Object Storage.
- [x] **Backups on the server** — bucket, write-only PAR, cron, and one test restore (`deploy/RUNBOOK.md`).
- [x] **Health endpoint** — `GET /health/ready` returns 503 when the DB is down or the scanner/outbox stalls.
- [x] **Uptime monitor** — point an external uptime monitor at `/health/ready` (`deploy/RUNBOOK.md`).

## 4. Vercel setup (Admin + Miniapp)

- [x] **Miniapp project** — build `Miniapp/`, set `VITE_API_URL=https://nzmpi.duckdns.org`. It authenticates with a header, so cross-site is fine.
- [x] **Admin rewrites** — `Admin/middleware.ts` (Vercel Routing Middleware) proxies `/admin/*` (all API calls and the OIDC callback) to the backend, so the browser sees one site and the `SameSite=Lax` cookie works. It replaced the `vercel.json` rewrite.
- [x] **Admin project** — `Admin/vercel.json` points at `nzmpi.duckdns.org` (done). Create the Vercel project with root `Admin/` and `VITE_API_URL` unset.
- [x] **Admin callback** — set `ADMIN_ORIGIN` and `ADMIN_CALLBACK_URL` to the Admin Vercel URL, so the OIDC callback also goes through the rewrite.
- [x] **CORS** — set `CORS_ORIGINS` on the backend to the Miniapp Vercel URL.

## 5. Telegram setup

- [x] **BotFather** — set the Mini App URL (Miniapp Vercel URL) and the Login domain and callback (Admin Vercel URL).

## 6. Testnet contracts

- [x] **Create Safes** — a factory-owner Safe and a separate proxy-admin Safe on Base Sepolia and Arbitrum Sepolia.
- [x] **Check current owners** — read the Factory owner and proxy admin on both testnets. Transfer both to the Safes, or redeploy with the Safes as owners.
- [x] **Confirm vault addresses** — one user's vault address matches on both chains.
- [x] **Configure chains and USDC** — add both chains and the test USDC contract address per chain in Admin.
- [x] **Treasury address** — set `TREASURY_ADDRESSES` to the testnet sweep destination.

## 7. Testnet end-to-end (owner first)

- [x] **Deposit flow** — intent, USDC transfer, scanner match, vault deploy via Safe, sweep, activation, Telegram notification.
- [x] **Verify `verifySweepTx` on a real RPC** — this check has never run against a real chain.
- [x] **Scan on demand** — the timed chain scan hit RPC rate limits. Admin **Check vaults** reads vault balances (Multicall3) and scans logs only for funded vaults.
- [x] **Manager deposits** — admins see a Manager pool option in the Mini App deposit form (`/me` returns `isAdmin`).
- [x] **Manager withdrawals** — the Mini App shows manager funds to admins and counts them as fee-free in the withdraw form.
- [x] **Yearly lot caps** — profit is split by NAV with the manager, then by value × APY across user lots; each lot earns in full up to a yearly cap (value × tier APY), then 1/10.
- [x] **Weekly cap release** — the yearly cap opens 7/365 per started week of the lot-year; unused cap carries over until the yearly reset.
- [x] **Week-long admin session** — sliding session: 3 days idle, 10 days max, bound to the login IP and browser. `/admin` on the API host needs the proxy secret that only the Vercel middleware sends.
- [ ] **Admin proxy secret** — set the same random `ADMIN_PROXY_SECRET` in the Admin Vercel project and in the server `.env`, then deploy both (`deploy/RUNBOOK.md`).
- [ ] **Accounting flow** — settlement (incl. large-move guard), maturity, relock, bonus.
- [x] **Withdrawal lock** — the admin locks a pending withdrawal before sending funds, so the user cannot cancel between payout and "mark paid". Admin shows "Mark paid" only after the lock.
- [ ] **Withdrawal flow** — quote with early fee, reserve, cancel, reject, pay, notification.
- [x] **Admin login** — Telegram Login through the Vercel rewrite; logout revokes the session.
- [ ] **Mini App on real clients** — Telegram iOS, Android and Desktop.

## 8. Testnet launch with test users

- [ ] **Operator runbook** — how often to settle, how to process withdrawals, what to do on a wrong token or an incident.
- [ ] **Risk notice** — users see that returns are projected, not guaranteed, before the first deposit.
- [x] **Access requests (backend and bot)** — people without access can ask for approval from the bot (/start button) or the Mini App. API: `GET /me/access`, `POST /me/access-request` (Mini App auth, no access needed); `GET /admin/access-requests?status=pending`, `POST /admin/access-requests/:telegramId/approve|reject`. Approve adds the ID to the allowlist; the user gets a bot message either way; re-request after 30 days.
- [x] **Access requests UI** — Admin: "Access requests" screen (People) with Approve / Reject and a pending badge. Mini App: when `/me/access` is not `approved`, the app runs on sample data (`lib/demo.ts`), sends nothing except the access request, and Home shows the request status with a "Request access" button.
- [ ] **Invite test users** — add their Telegram IDs to the allowlist; send them test USDC.
- [ ] **Collect feedback** — list bugs and UX issues from test users.

## 9. After testnet

- [ ] **Payout tx-hash check** — one payout hash must not mark several withdrawals paid; optionally verify the payout onchain.
- [ ] **Contract hardening** — sweep events and recipient-address checks in `Factory.sol` / `Vault.sol`.
- [ ] **External contract review** — before real funds.
- [ ] **Real domain** — buy one before mainnet; move Admin and API to subdomains of it.
- [ ] **Mainnet** — mainnet Safes, Factory on Polygon, Base and BNB Chain at one address, fresh prod DB, owner dry run with a small real amount.
- [ ] **Donation and vault-sharing features** — out of current scope.
