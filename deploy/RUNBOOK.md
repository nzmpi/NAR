# Migration runbook

All commands run in `deploy/` on the server. `DATABASE_URL` in `.env` is the Neon **direct** (non-pooled) string with `sslmode=require`.

## Server setup (once)

1. Oracle console, the instance's VCN security list: add ingress TCP 80, TCP 443 and UDP 443 from `0.0.0.0/0`. Keep 22.
2. On the server, run the base setup (updates, 2 GB swap, key-only SSH, host firewall, Docker). It is safe to re-run.
   ```bash
   scp deploy/server-setup.sh ubuntu@<DOMAIN>:
   ssh ubuntu@<DOMAIN> 'sudo bash server-setup.sh'
   ```
3. Log out and back in, then `docker ps` works without sudo.

## Admin proxy secret (once)

The Admin site on Vercel proxies `/admin/*` to the API through `Admin/middleware.ts`. The middleware adds a shared secret and the visitor's IP. The API refuses `/admin` requests without the secret (404), and admin sessions only work from the IP and browser that logged in.

1. Make a secret: `openssl rand -hex 32`.
2. Vercel → Admin project → Settings → Environment Variables: add `ADMIN_PROXY_SECRET` with that value and `BACKEND_URL` (the API origin, for example `https://<DOMAIN>`, no trailing slash) (Production). Redeploy the Admin project.
3. Server: add the same `ADMIN_PROXY_SECRET=` line to `deploy/.env`, then deploy the backend as below. With `APP_ENV=prod` the backend does not start without it.

Rotate it the same way. Existing admin sessions stay valid. Admin is down between steps 2 and 3, so do them back to back.

Sessions last 3 days without use and 10 days at most. A new IP (other Wi-Fi, VPN, router restart) or another browser logs you out; log in again.

## Fresh database

1. Set `DATABASE_URL`, `TAG` and `TRUST_PROXY_HOPS=1` (Caddy is the one proxy hop) in `.env`. The backend refuses to start in prod without it.
2. Apply all migrations. They also seed the pools.
   ```bash
   docker compose run --rm backend node dist/migrate.js
   ```
3. Start. The owner admin (`OWNER_TELEGRAM_ID`) is created at startup.
   ```bash
   docker compose up -d
   ```
4. Seed the manager pool: as the owner admin, deposit 1 USD into the manager pool from the Mini App (an all-manager deposit needs only 1 USD). Without manager shares, settlement excess and withdrawal fees have nowhere to go and fail.

## Deploy a new version

1. Check whether the release adds files in `Backend/drizzle/`:
   ```bash
   git diff --stat <old-sha> <new-sha> -- Backend/drizzle
   ```
2. If it does, back up first (see below). Do not skip this once the DB holds funds.
3. Set `TAG=<new-sha>` in `.env`, then:
   ```bash
   docker compose pull backend
   docker compose run --rm backend node dist/migrate.js
   docker compose up -d
   ```
   `migrate.js` skips migrations already applied, so running it with no new files is safe.

## Backup and restore

The `pg_dump` client must be the same major version as the server or newer. Neon's default is 17.

```bash
set -a; . ./.env; set +a
docker run --rm postgres:18 pg_dump "$DATABASE_URL" -Fc > "nar-$(date +%F-%H%M).dump"
```

Restore (overwrites the tables in the target DB):

```bash
docker run --rm -i postgres:18 pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" < nar-YYYY-MM-DD-HHMM.dump
```

### Daily backup

Neon's free-tier restore window is short, so `backup.sh` keeps our own copies.

1. In Oracle Object Storage, create a private bucket. Add a lifecycle rule that deletes objects after 30 days.
2. Create a pre-authenticated request on the bucket: "Permit object writes", no listing, long expiry. Put its URL (ends in `/o/`) in `.env` as `BACKUP_PAR_URL`. Note the expiry date; renew it before then.
3. Run `./backup.sh` once by hand and check the object in the bucket.
4. Add the cron line from the top of `backup.sh`.
5. Create a free daily check at a dead-man's-switch service (for example healthchecks.io: period 1 day, grace 2 hours). Put its ping URL in `.env` as `BACKUP_PING_URL`. `backup.sh` pings it only after a successful upload, so you get an alert when backups stop, for example when the PAR expires.
6. Test a restore: download one dump from the console and restore it into a scratch Neon branch with the command above.

## Rules once the DB holds funds

- The old container keeps serving while `migrate.js` runs, so every migration must work with the previous code: add tables and nullable columns only.
- Drop or rename a column in a later release, after no deployed code uses it.
- Never edit or delete a migration file that has been applied anywhere. Fix forward with a new one.
- Rollback: set `TAG` back to the previous sha and `docker compose up -d`. This works only because migrations are additive. Otherwise restore the dump.

## Monitoring

`GET /health/ready` returns 200 when all is well. It returns 503 when the DB is unreachable, or when the intent-expiry loop (`scanner`) or the notification outbox has had no good run for 5 intervals (at least 10 minutes). Chains are no longer scanned on a timer: press **Check vaults** on the Admin Deposits screen. It reads every vault's token balance and fetches transfer logs only for vaults that hold tokens. The JSON body says which part failed. Loops turned off (interval `0`) show `off` and do not fail the check.

Point the uptime monitor at `GET /health`, not `/health/ready`. `/health` answers without touching the database. `/health/ready` runs a query, and polling it every few minutes keeps the free Neon compute awake, which uses up the monthly compute hours. Open `/health/ready` by hand when you need the details.

Set up a free external uptime monitor (for example UptimeRobot):

1. HTTP(S) monitor on `https://<DOMAIN>/health`, every 5 minutes.
2. Alert contact: email, or Telegram if the service supports it.
3. Stop the backend container once and confirm the alert arrives.

On an alert, check `docker compose logs --tail 200 backend`.
