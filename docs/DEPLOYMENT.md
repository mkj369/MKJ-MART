# Production deployment

Target: **one Linux server (VPS) with Docker Engine + Docker Compose v2**, e.g. 2 vCPU / 4 GB RAM / 40 GB SSD
(DigitalOcean, Vultr, Hetzner, AWS Lightsail, a Bangladeshi provider…). Everything runs from
[`docker-compose.prod.yml`](../docker-compose.prod.yml):

| Service | Role |
| --- | --- |
| `caddy` | Public entry point on ports 80/443. Automatic Let's Encrypt certificates, HTTP→HTTPS redirect, HTTP/2+3, blocks `/api/cron/*` publicly. Config: [`deploy/Caddyfile`](../deploy/Caddyfile). |
| `app` | The Next.js server (standalone build, non-root, health check on `/api/v1/health`). |
| `migrate` | One-shot: applies pending migrations, then exits; `app` starts only after it succeeds. Same image is used for admin tasks. |
| `db` | PostgreSQL 17 (data in the `pgdata` volume, not exposed to the internet). |
| `scheduler` | Calls the cron endpoints internally: notifications every minute, payment expiry every 5 min, ecosystem events every 15 min ([`deploy/scheduler.sh`](../deploy/scheduler.sh)). |
| `backup` | Daily `pg_dump` + uploads archive into `BACKUP_DIR`, 14-day retention ([`deploy/backup.sh`](../deploy/backup.sh)). |

## 1. Prepare the server and DNS

1. Create the server (Ubuntu 24.04 LTS or Debian 12). Install Docker: <https://docs.docker.com/engine/install/>.
2. Firewall: allow **22, 80, 443 (TCP) and 443 (UDP)** only. Do not expose PostgreSQL.
3. DNS at your registrar/Cloudflare: `A` (and `AAAA` if you have IPv6) records for `shop.example.com` and
   `www.shop.example.com` → the server IP. If you use Cloudflare's proxy, set SSL mode to **Full (strict)**.
4. Wait until `dig +short shop.example.com` returns the server IP — Caddy needs it to obtain certificates.

## 2. Configure

```bash
git clone <your-repo> mkj-mart && cd mkj-mart
cp .env.production.example .env.production && chmod 600 .env.production
openssl rand -hex 32    # run twice: one value for POSTGRES_PASSWORD, one for CRON_SECRET
nano .env.production
```

Required: `DOMAIN`, `ACME_EMAIL`, `APP_URL=https://<DOMAIN>`, `POSTGRES_PASSWORD`, `CRON_SECRET`.
Strongly recommended: `SMTP_*` (order emails and password reset do not work without it). Optional:
`SSLCOMMERZ_*` (online payment is hidden until set), `SMS_*`, `STORAGE_DRIVER=s3` + `S3_*`. Every variable is
documented in [`.env.example`](../.env.example). `TRUST_PROXY=1` and `UPLOAD_DIR` are set by the compose file.

### Email (SMTP)
Use any transactional provider (Amazon SES, Brevo, Mailgun, Postmark, Zoho, Google Workspace). Typical:
`SMTP_HOST=smtp.example.com`, `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS is enforced), `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM="MKJ Store <orders@yourdomain.com>"`. Add the provider's **SPF/DKIM** DNS records
for your domain, otherwise mail lands in spam. After deploying: Admin → Settings → Notifications → *Send test email*.

### SMS (optional)
`SMS_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (or
`TWILIO_MESSAGING_SERVICE_SID`), **or** `SMS_PROVIDER=http` for a Bangladeshi gateway, described by
`SMS_HTTP_URL`, `SMS_HTTP_METHOD`, `SMS_HTTP_FORMAT`, `SMS_HTTP_PARAMS` (JSON template with `{{to}}`,
`{{message}}`, `{{api_key}}`, `{{sender_id}}`…), `SMS_HTTP_API_KEY`, `SMS_SENDER_ID` and — important —
`SMS_HTTP_SUCCESS_PATTERN` (a regex the provider's success response must match; many gateways return HTTP 200
for errors). Use the gateway's documentation for the exact parameter names, then *Send test SMS* in the admin.

### Payments (SSLCommerz)
Start with **sandbox** credentials and complete [SSLCOMMERZ.md](SSLCOMMERZ.md) before switching to
`SSLCOMMERZ_MODE=live`. In the merchant panel set the **IPN URL** to `https://<DOMAIN>/api/payments/sslcommerz/ipn`.

## 3. First deployment

```bash
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
$COMPOSE up -d --build                      # builds images, migrates, starts everything
$COMPOSE ps                                 # all services "running"/"healthy"; migrate "exited (0)"
$COMPOSE run --rm migrate npm run db:seed   # base data: sizes, colours, 3 delivery zones (no demo data)
$COMPOSE run --rm migrate npm run admin:create -- --email you@yourdomain.com --name "Your Name"
                                            # prompts twice for a 12+ character password (never on the command line)
curl -fsS https://<DOMAIN>/api/v1/health    # {"data":{"status":"ok","database":"up",…}}
```

Then sign in at `https://<DOMAIN>/admin`, open **Settings → Launch readiness** and work through every red item
(see [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md)). Do **not** load demo data on a real store.

## 4. Updating (deploy a new version)

```bash
$COMPOSE exec -e BACKUP_ONCE=1 backup sh /backup.sh     # fresh backup first
git fetch && git checkout <release-tag-or-commit>
$COMPOSE build app migrate
$COMPOSE up -d                                          # runs migrate, then replaces app (brief restart)
$COMPOSE ps && curl -fsS https://<DOMAIN>/api/v1/health
```

Migrations are additive and are applied automatically by `migrate` before the new app starts.

## 5. Rollback

* **Code only** (no new migration in the release): `git checkout <previous-tag>`, `$COMPOSE build app`,
  `$COMPOSE up -d app`.
* **Release included a migration**: migrations are forward-only. Roll back the code as above only if the new
  migration was purely additive (all migrations so far are: new tables, columns with defaults, enum values) — the
  old code ignores the extra columns. Otherwise restore the pre-deploy backup with
  `sh deploy/restore.sh backups/db-<timestamp>.dump` (see [OPERATIONS.md](OPERATIONS.md)) and redeploy the old tag.

## 6. Logs and monitoring

* `$COMPOSE logs -f app` — one JSON object per line (`level`, `event`, …); secrets are redacted. Unexpected API
  errors log `api.unhandled_error` with an `errorId` that customers see as "Ref xxxxxxxx".
* `$COMPOSE logs -f caddy` — access logs (cookies redacted) and certificate renewals.
* Point an uptime monitor (UptimeRobot, Better Stack…) at `https://<DOMAIN>/api/v1/health`.
* Admin → Settings shows scheduled-job heartbeats and notifications that failed or were not sent.

## 7. Other hosting options

The app is a standard Node.js server and also runs on platforms such as Railway, Render, Fly.io or DigitalOcean
App Platform: build with `npm run build`, start with `npm start` (or the Dockerfile), run `npm run db:migrate` as
the release command, use a managed PostgreSQL, set `STORAGE_DRIVER=s3` (or attach a persistent disk for
`UPLOAD_DIR`), set `TRUST_PROXY` to the number of proxies in front of the app, and call the three
`POST /api/cron/*` endpoints from the platform's scheduler with `Authorization: Bearer $CRON_SECRET`.
These platform variants have not been tested.
