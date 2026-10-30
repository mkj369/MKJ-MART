# Operations runbook

`COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"` in all commands below.

## Backups

* The `backup` service writes `db-YYYYmmdd-HHMMSS.dump` (PostgreSQL custom format, verified with
  `pg_restore --list` before it is kept) and `uploads-YYYYmmdd-HHMMSS.tar.gz` into `BACKUP_DIR` (default
  `./backups`) every `BACKUP_INTERVAL_HOURS` (24) and deletes files older than `BACKUP_RETENTION_DAYS` (14).
* One-off backup (e.g. before a deploy): `$COMPOSE exec -e BACKUP_ONCE=1 backup sh /backup.sh`.
* **Copy backups off the server** (a server failure takes local backups with it), e.g. a nightly
  `rclone copy ./backups remote:mkj-mart-backups` or `restic` cron job on the host. With `STORAGE_DRIVER=s3`,
  enable versioning on the bucket instead of relying on the uploads archive.

## Restore

```bash
sh deploy/restore.sh backups/db-20261030-020000.dump backups/uploads-20261030-020000.tar.gz
```

The script asks for confirmation, stops `app` and `scheduler`, recreates the database from the dump, optionally
replaces the uploads volume, runs migrations (so an older backup is brought up to the current schema) and starts
the app again. **Practise a restore** on a spare server before launch and after major changes.

The backup → restore path was rehearsed with the same scripts against PostgreSQL 18.4 (dump verified,
restored into a new database, row counts and uploads identical).

## Scheduled jobs

| Endpoint (POST, `Authorization: Bearer $CRON_SECRET`) | Frequency | Purpose |
| --- | --- | --- |
| `/api/cron/send-notifications` | 1–5 min | Deliver queued email/SMS, retry failures (backoff 1, 5, 15, 60, 180 min; 6 attempts) |
| `/api/cron/expire-payments` | 5 min | Reconcile unpaid online orders with SSLCommerz, then cancel and release stock |
| `/api/cron/dispatch-events` | 15 min | MKJ Ecosystem webhook (no-op unless configured) |

Heartbeats are visible in Admin → Settings → Scheduled jobs; the launch checklist warns when they stop.
CLI equivalents: `$COMPOSE run --rm migrate npm run jobs:expire-payments` (and `jobs:send-notifications`,
`jobs:dispatch-events`).

## Common tasks

| Task | How |
| --- | --- |
| Reset a staff/admin password | `$COMPOSE run --rm migrate npm run admin:create -- --email person@domain` (prompts; signs them out everywhere) |
| Add staff | They register (or you create them with `admin:create`), then Admin → Customers → change role to Staff |
| Customer forgot password | They use *Forgot password?* (needs SMTP). Staff accounts are excluded by design. |
| Rotate `CRON_SECRET` / SMTP / SSLCommerz secrets | Edit `.env.production`, then `$COMPOSE up -d app scheduler` |
| Check a disputed online payment | Admin → order → *Check payment with gateway* (Transaction Query API), compare with the merchant panel |
| Refund a customer | Pay it in the SSLCommerz merchant panel / bKash / bank first, then *Record refund…* with the reference |
| Remove demo data | Admin → Settings → Demo data (from your own admin account) |
| Database shell | `$COMPOSE exec db psql -U mkj -d mkj_mart` |

## Incident checklists

* **Site down**: `$COMPOSE ps`; `$COMPOSE logs --tail 200 app caddy db`; disk space (`df -h`); restart with
  `$COMPOSE up -d`. Certificates: Caddy logs show ACME errors if DNS or port 80/443 changed.
* **Emails not arriving**: Admin → Settings → *Notifications needing attention* shows the provider's error; send a
  test email; check SPF/DKIM and the provider dashboard.
* **Paid but order shows unpaid**: run *Check payment with gateway* on the order. Verify the IPN URL in the merchant
  panel and that `/api/payments/sslcommerz/ipn` is reachable from the internet.
* **Paid after the order expired / duplicate payment / high-risk flag**: the order timeline has an internal note;
  contact the customer, then refund (and record it) or fulfil manually.
