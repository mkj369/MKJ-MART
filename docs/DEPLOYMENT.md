# Production deployment checklist

## 1. Infrastructure

- [ ] **PostgreSQL 14+** (managed recommended: automatic backups, point-in-time recovery). Note the connection string
      (with `?sslmode=require` if required by the provider).
- [ ] **App host** running Node.js 20.9+ (Docker image from the included `Dockerfile`, a VPS, or a PaaS).
- [ ] **HTTPS** in front of the app (Caddy, Nginx + Let's Encrypt, Cloudflare, or the platform's TLS).
- [ ] **Persistent storage** for `UPLOAD_DIR` (admin product photos). With several app instances, use shared storage
      or move uploads to S3/R2 (`src/server/storage.ts` is the only module to change).

## 2. Configuration (environment variables)

```bash
NODE_ENV=production
APP_URL=https://shop.yourdomain.com.bd        # exact public origin
DATABASE_URL=postgres://…
COOKIE_SECURE=auto
TRUST_PROXY=1                                  # number of reverse proxies in front of the app
UPLOAD_DIR=/app/uploads
SSLCOMMERZ_STORE_ID=…                          # from SSLCommerz (live store for production)
SSLCOMMERZ_STORE_PASSWORD=…
SSLCOMMERZ_MODE=live
PAYMENT_TIMEOUT_MINUTES=30
CRON_SECRET=<openssl rand -hex 32>
CSP_FRAME_ANCESTORS='self'
# optional
ECOSYSTEM_WEBHOOK_URL=https://hub.mkj.example/webhooks/mart
ECOSYSTEM_WEBHOOK_SECRET=<random>
```

Store secrets in the platform's secret manager — never in the repository or the image.

## 3. Release steps

```bash
npm ci
npm run build
npm run db:migrate          # run on every release (idempotent)
npm run db:seed             # first deploy only: sizes, colours, delivery zones (NO demo data)
npm run admin:create -- --email owner@yourdomain.com --name "Owner" --password '<long passphrase>'
npm start                   # (Docker images use the leaner standalone server — see Dockerfile)
```

With Docker Compose: `docker compose up -d --build`, then
`docker compose run --rm tools npm run db:seed` and `docker compose run --rm tools npm run admin:create -- …`.

> If you loaded demo data on a staging database, remove it in **Admin → Settings → Demo data** before going live.

## 4. Scheduled jobs (every 5–10 minutes)

```bash
# Option A — CLI (server cron)
*/5 * * * * cd /srv/mkj-mart && npm run jobs:expire-payments
*/5 * * * * cd /srv/mkj-mart && npm run jobs:dispatch-events

# Option B — HTTP (any scheduler, e.g. GitHub Actions, cron-job.org)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://shop.yourdomain.com.bd/api/cron/expire-payments
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://shop.yourdomain.com.bd/api/cron/dispatch-events
```

## 5. SSLCommerz go-live

- [ ] Complete the sandbox checklist in the README (§6) with real sandbox credentials.
- [ ] Set the IPN URL in the merchant panel: `https://<domain>/api/payments/sslcommerz/ipn`.
- [ ] Switch to live credentials and `SSLCOMMERZ_MODE=live`; place a small real order and refund it.

## 6. Before launch

- [ ] Replace AI-generated demo photography with real product photos; publish draft products.
- [ ] Review policy texts (Admin → Settings → Policies) and home-page copy with the business.
- [ ] Set store contact details (Admin → Settings → Store details).
- [ ] Confirm delivery zones and fees (Admin → Delivery zones).
- [ ] Configure database backups and test a restore. Back up `UPLOAD_DIR` too.
- [ ] Monitor `GET /api/v1/health` (returns 200 when the app and database are up).
- [ ] Run `npm test` and `npm run test:e2e` in CI (see `.github/workflows/ci.yml`).

## 7. Reverse proxy example (Caddy)

```
shop.yourdomain.com.bd {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Caddy sets `X-Forwarded-For`/`X-Forwarded-Proto`; keep `TRUST_PROXY=1`.
