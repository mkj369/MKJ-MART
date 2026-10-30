#!/bin/sh
# Restores a backup made by deploy/backup.sh. Run from the project directory ON THE SERVER:
#
#   sh deploy/restore.sh backups/db-20261030-020000.dump [backups/uploads-20261030-020000.tar.gz]
#
# The app is stopped during the restore and started again afterwards. THIS REPLACES ALL CURRENT DATA.
set -eu
DUMP="${1:?usage: restore.sh <db-dump> [uploads-archive]}"
UPLOADS="${2:-}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
[ -f "$DUMP" ] || { echo "No such file: $DUMP" >&2; exit 1; }

printf 'This will REPLACE the production database%s. Type "restore" to continue: ' "${UPLOADS:+ and uploads}"
read -r answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }

$COMPOSE stop app scheduler
$COMPOSE exec -T db sh -c 'dropdb -U mkj --if-exists --force mkj_mart && createdb -U mkj mkj_mart'
$COMPOSE exec -T db pg_restore -U mkj -d mkj_mart --no-owner --exit-on-error < "$DUMP"
if [ -n "$UPLOADS" ]; then
  $COMPOSE run --rm --no-deps -T --entrypoint sh -v "$(cd "$(dirname "$UPLOADS")" && pwd)":/restore:ro app \
    -c "find /app/uploads -mindepth 1 -delete && tar -xzf /restore/$(basename "$UPLOADS") -C /app/uploads"
fi
$COMPOSE run --rm migrate   # brings an older backup up to the current schema
$COMPOSE up -d app scheduler
echo "Restore complete. Check https://\$DOMAIN/api/v1/health and the admin dashboard."
