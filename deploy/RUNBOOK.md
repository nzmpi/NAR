# Migration runbook

All commands run in `deploy/` on the server. `DATABASE_URL` in `.env` is the Neon **direct** (non-pooled) string with `sslmode=require`.

## Fresh database

1. Set `DATABASE_URL` and `TAG` in `.env`.
2. Apply all migrations. They also seed the pools.
   ```bash
   docker compose run --rm backend node dist/migrate.js
   ```
3. Start. The owner admin (`OWNER_TELEGRAM_ID`) is created at startup.
   ```bash
   docker compose up -d
   ```

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
docker run --rm postgres:17 pg_dump "$DATABASE_URL" -Fc > "nar-$(date +%F-%H%M).dump"
```

Restore (overwrites the tables in the target DB):

```bash
docker run --rm -i postgres:17 pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" < nar-YYYY-MM-DD-HHMM.dump
```

## Rules once the DB holds funds

- The old container keeps serving while `migrate.js` runs, so every migration must work with the previous code: add tables and nullable columns only.
- Drop or rename a column in a later release, after no deployed code uses it.
- Never edit or delete a migration file that has been applied anywhere. Fix forward with a new one.
- Rollback: set `TAG` back to the previous sha and `docker compose up -d`. This works only because migrations are additive. Otherwise restore the dump.
