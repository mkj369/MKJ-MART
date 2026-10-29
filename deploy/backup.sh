#!/bin/sh
# Periodic backups into /backups (a host directory — copy it OFF the server too, see docs/OPERATIONS.md):
#   db-YYYYmmdd-HHMMSS.dump        PostgreSQL custom-format dump (restore with deploy/restore.sh)
#   uploads-YYYYmmdd-HHMMSS.tar.gz product images (UPLOAD_DIR)
# Files older than BACKUP_RETENTION_DAYS are deleted.
# One-off backup (e.g. right before a deploy):
#   docker compose -f docker-compose.prod.yml --env-file .env.production exec -e BACKUP_ONCE=1 backup sh /backup.sh
set -eu
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
DEST="${BACKUP_DEST:-/backups}"
SRC="${UPLOADS_SRC:-/uploads}"
mkdir -p "$DEST"

backup_once() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  status=0
  if pg_dump --format=custom --no-owner --file="${DEST}/db-${stamp}.dump.partial" && pg_restore --list "${DEST}/db-${stamp}.dump.partial" >/dev/null; then
    mv "${DEST}/db-${stamp}.dump.partial" "${DEST}/db-${stamp}.dump"
    echo "$(date -u +%FT%TZ) database backup db-${stamp}.dump ($(du -h "${DEST}/db-${stamp}.dump" | cut -f1))"
  else
    rm -f "${DEST}/db-${stamp}.dump.partial"
    echo "$(date -u +%FT%TZ) DATABASE BACKUP FAILED" >&2
    status=1
  fi
  if tar -czf "${DEST}/uploads-${stamp}.tar.gz.partial" -C "$SRC" .; then
    mv "${DEST}/uploads-${stamp}.tar.gz.partial" "${DEST}/uploads-${stamp}.tar.gz"
  else
    rm -f "${DEST}/uploads-${stamp}.tar.gz.partial"
    echo "$(date -u +%FT%TZ) UPLOADS BACKUP FAILED" >&2
    status=1
  fi
  find "$DEST" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime "+${RETENTION_DAYS}" -delete
  return "$status"
}

if [ "${BACKUP_ONCE:-0}" = "1" ]; then
  backup_once
  exit $?
fi
while true; do
  backup_once || true
  sleep $((INTERVAL_HOURS * 3600))
done
