#!/bin/sh
# Calls the app's cron endpoints from inside the Docker network (Caddy blocks them publicly).
#   every 1 min  → send-notifications (email/SMS outbox, retries)
#   every 5 min  → expire-payments (reconcile with SSLCommerz, then release unpaid reservations)
#   every 15 min → dispatch-events (MKJ Ecosystem webhook; a no-op unless configured)
set -u
: "${CRON_SECRET:?CRON_SECRET is required}"
BASE="${APP_INTERNAL_URL:-http://app:3000}"

call() {
  if ! curl -fsS -m 120 -X POST -H "Authorization: Bearer ${CRON_SECRET}" "${BASE}/api/cron/$1" -o /dev/null; then
    echo "$(date -u +%FT%TZ) cron $1 failed" >&2
  fi
}

minute=0
while true; do
  call send-notifications
  if [ $((minute % 5)) -eq 0 ]; then call expire-payments; fi
  if [ $((minute % 15)) -eq 0 ]; then call dispatch-events; fi
  minute=$(((minute + 1) % 60))
  sleep 60
done
