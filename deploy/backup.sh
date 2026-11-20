#!/bin/sh
# Daily pg_dump to Oracle Object Storage. Cron (UTC):
#   15 3 * * * /path/to/deploy/backup.sh >> /path/to/deploy/backup.log 2>&1
# BACKUP_PAR_URL: bucket pre-authenticated request, "Permit object writes" only,
# ending in /o/. Write-only, so this server cannot read or delete old backups.
set -eu
cd "$(dirname "$0")"
set -a
. ./.env
set +a
: "${BACKUP_PAR_URL:?set BACKUP_PAR_URL in .env}"

f="nar-$(date -u +%F-%H%M).dump"
trap 'rm -f "$f"' EXIT
docker run --rm postgres:18 pg_dump "$DATABASE_URL" -Fc > "$f"
curl -fsS --retry 3 -T "$f" "$BACKUP_PAR_URL$f"
echo "$(date -u +%FT%TZ) uploaded $f ($(wc -c < "$f") bytes)"
