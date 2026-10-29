# MKJ MART

**The e-commerce platform for MKJ Store — part of the MKJ Ecosystem.**
A production-oriented, full-stack fashion store built for Bangladesh: Taka pricing, Cash on Delivery
in all 64 districts, SSLCommerz online payments (bKash, Nagad, Rocket, cards), district-based delivery
zones, returns & refunds, email/SMS notifications and a complete back office.

| Storefront | Admin |
| --- | --- |
| Home, shop with search/filters/sort/pagination, collections, product pages (sizes, colours, live stock), bag, checkout (COD / online), order page with "Pay now" retry, public tracking with courier links, accounts (profile, addresses, history, wishlist, password, **forgot-password by email**), **return requests**, **Help & contact** page with FAQ and contact form | Dashboard, orders workflow (tracking links, notifications log, gateway reconciliation, refund ledger), **returns**, **support inbox**, products & variants & images, inventory ledger, categories, collections, sizes & colours, customers & roles, coupons, delivery zones, settings (business details, notifications with test send, returns, policies with review flags), **launch-readiness checklist**, scheduled-job heartbeats, safe demo-data removal |

> **Status (honest):** builds, migrates on an empty database and passes 213 unit/integration tests and
> 24 browser E2E tests. The full production stack (standalone build behind Caddy HTTPS, migrations,
> first-admin procedure, scheduler, backups and a restore) was rehearsed end-to-end. **Not verified:**
> SSLCommerz against the real sandbox (needs credentials; see [docs/SSLCOMMERZ.md](docs/SSLCOMMERZ.md)),
> real SMTP/SMS providers (tested with a local SMTP server and a local HTTP SMS gateway), and the Docker
> images themselves (Docker is unavailable in the build sandbox — CI builds and boots them). Nothing is
> deployed publicly yet.

---

## Contents

1. [Tech stack & architecture](#1-tech-stack--architecture)
2. [Run locally](#2-run-locally)
3. [Configuration](#3-configuration)
4. [Demo data vs real data](#4-demo-data-vs-real-data)
5. [Payments](#5-payments)
6. [Notifications, password reset, returns & support](#6-notifications-password-reset-returns--support)
7. [Testing](#7-testing)
8. [Deployment](#8-deployment)
9. [Security model](#9-security-model)
10. [MKJ Ecosystem integration](#10-mkj-ecosystem-integration)
11. [Project structure](#11-project-structure)
12. [Known limitations](#12-known-limitations)

Detailed docs: [DEPLOYMENT](docs/DEPLOYMENT.md) · [OPERATIONS](docs/OPERATIONS.md) (backups, restore, rollback, runbooks) ·
[LAUNCH_CHECKLIST](docs/LAUNCH_CHECKLIST.md) · [SSLCOMMERZ](docs/SSLCOMMERZ.md) · [SECURITY](docs/SECURITY.md) (audit) ·
[CATALOG](docs/CATALOG.md) (replacing demo products/photos) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md)

---

## 1. Tech stack & architecture

* **Next.js 16** (App Router, React 19, TypeScript, Tailwind CSS 4) — one Node.js service serving the storefront,
  the admin and a versioned REST API (`/api/v1`).
* **PostgreSQL 14+** with **Drizzle ORM** and SQL migrations (`drizzle/`).
* Layers: `src/app` (routes/UI) → `src/server/services` (business rules, transactions) → `src/server/db`.
  Shared, framework-free rules live in `src/lib` (money, phone, order/return state machines, validation).
* Outboxes: `domain_events` (MKJ Ecosystem webhooks) and `notifications` (email/SMS) are written in the same
  transaction as the business change and delivered by background jobs with retries.
* Integrations behind small adapters: SSLCommerz (`src/server/payments`), SMTP via nodemailer, Twilio or any
  HTTP SMS gateway (`src/server/notifications`), local disk or S3-compatible image storage (`src/server/storage.ts`).

## 2. Run locally

Requirements: **Node.js 20.9+** (22 LTS recommended). No Docker or system PostgreSQL needed.

```bash
git clone <repo> && cd MKJ-MART
npm install
cp .env.example .env.local          # defaults work for local development

# Terminal 1 — a real PostgreSQL server installed via npm (data in ./.data/postgres)
npm run db:local
# Terminal 2 (optional) — catch outgoing email locally: SMTP 127.0.0.1:1025, inbox http://127.0.0.1:1080
npm run mail:dev                    # then set SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_REQUIRE_TLS=false in .env.local
# Terminal 3
npm run db:migrate                  # create the schema
npm run db:seed -- --demo           # base settings + clearly flagged, fictional demo data
npm run dev                         # http://localhost:3000
```

**Demo sign-ins** — the seed creates `admin@mkjmart.demo`, `staff@mkjmart.demo` and `customer@mkjmart.demo`
(plus three more customers) with **random passwords printed once in the terminal**. No password is stored in
the repository or shown in the UI. For a stable local password set `DEMO_ACCOUNT_PASSWORD` in `.env.local`
(ignored in production). In a production build, demo accounts cannot sign in unless `DEMO_MODE=true`.

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build for production, run the production build |
| `npm run db:local` | Run PostgreSQL locally (embedded binaries) using `DATABASE_URL` |
| `npm run db:migrate` | Apply pending migrations (safe on every deploy) |
| `npm run db:seed` | Base data only: sizes, colours, delivery zones (safe in production) |
| `npm run db:seed -- --demo` | Also load demo data (refused in production unless `DEMO_MODE=true`) |
| `npm run db:reset` | **Dev only** — drop everything, migrate, seed demo data |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run admin:create -- --email … --name …` | Create/promote/reset a real administrator (prompts for the password; `--password-stdin` for automation) |
| `npm run jobs:expire-payments` · `jobs:send-notifications` · `jobs:dispatch-events` | Background jobs (also available as `POST /api/cron/*`) |
| `npm run payments:sandbox-check` | Check SSLCommerz sandbox credentials/connectivity from your server |
| `npm run mail:dev` | Local mail catcher (development/E2E only) |
| `npm run lint` · `typecheck` · `test` · `test:e2e` | Quality gates |

## 3. Configuration

All configuration is environment variables — documented in [`.env.example`](.env.example) (development) and
[`.env.production.example`](.env.production.example) (production stack). Secrets (database, SSLCommerz, SMTP,
SMS, S3, cron) never go into the database or the repository. **Business values are settings** edited in
Admin → Settings: store and legal business details (legal name, trade licence, VAT/BIN, address, support
contacts, hours), checkout rules (COD, COD limit, guest checkout, free-delivery threshold), delivery zones and
fees, return window and instructions, which notifications are sent, help-page FAQ and the four policies.
Policies ship as **templates** and are shown to shoppers as *Draft policy* until each one is marked reviewed.

## 4. Demo data vs real data

* `npm run db:seed` loads only configuration every store needs (sizes, colours, three delivery zones —
  Inside Dhaka ৳70, Dhaka Suburbs ৳110, Outside Dhaka ৳140, free over ৳5,000; adjust in Admin → Delivery zones).
* `npm run db:seed -- --demo` adds **fictional** products (15, with AI-generated photos), accounts, coupons and
  13 orders placed through the real checkout. Every demo row has `is_demo = true`; demo emails use the
  non-routable `@mkjmart.demo` domain; demo records never receive email/SMS.
* While demo data exists the storefront shows a **"Demo store"** notice, admin lists tag records **Demo**, and
  the launch checklist fails.
* **Admin → Settings → Demo data → Remove demo data** deletes demo records without ever deleting or altering
  real ones: demo products sold in real orders are kept (archived), demo coupons used by real orders are
  disabled, curated collections/categories that real products need are kept, and real coupon usage counters are
  corrected. It must be run from your real admin account. See [docs/CATALOG.md](docs/CATALOG.md) for replacing
  the demo catalogue and photos.

## 5. Payments

**Cash on Delivery** works out of the box (optional COD order limit). COD orders become *Paid* on delivery or via
"Record cash received".

**SSLCommerz** (implemented against the official v4 docs and libraries; **sandbox verification pending your
credentials** — run `npm run payments:sandbox-check` and the checklist in [docs/SSLCOMMERZ.md](docs/SSLCOMMERZ.md)):

* Orders are marked paid **only** after the server-to-server **Validation API** confirms status, `tran_id`,
  amount and currency. Browser redirects are never trusted.
* Failure/cancel callbacks are acted on only when their `verify_sign` is valid; unsigned ones are reconciled
  with the **Transaction Query API**. A failed attempt keeps the stock reserved and the customer can **Pay now**
  again (new transaction) until the payment window closes.
* The expiry job asks the gateway before cancelling, so a payment whose IPN was lost is recorded, not cancelled.
  Late payments after cancellation, duplicate payments and SSLCommerz **high-risk** flags are surfaced to staff.
* Gateway limits (৳10 – ৳5,00,000) are enforced; online payment is hidden when credentials are missing.
* Refunds are paid in the SSLCommerz merchant panel (or bKash/Nagad/bank/cash) and **recorded** in the refund
  ledger with their reference — the app never moves money or pretends to.

## 6. Notifications, password reset, returns & support

* **Email** (any SMTP provider; STARTTLS enforced) and optional **SMS** (Twilio or a generic HTTP gateway for
  Bangladeshi providers): order confirmation, payment received, confirmed/shipped (with tracking link)/delivered,
  cancellations, return updates, refunds, welcome, password changed, plus staff alerts. Messages are queued in
  the transaction, sent right after the response and retried with backoff by the scheduler. Each order shows what
  was actually **sent**, **failed** or **not sent** (e.g. SMTP not configured). Admin → Settings has a real
  "Send test" for email and SMS.
* **Password reset**: single-use, 30-minute links (only a SHA-256 hash is stored), no account enumeration, rate
  limits, all sessions revoked on reset. Staff passwords are reset by an administrator or `npm run admin:create`.
* **Returns**: customers request returns for delivered orders within the configurable window; staff approve or
  decline, mark parcels received (optionally restocking with a ledger entry) and an administrator records the
  refund. Orders become *Returned* when every unit is back.
* **Support**: Help & contact page (contact channels from settings, FAQ, contact form with honeypot and rate
  limit) feeding an admin **support inbox** with status and internal notes.

## 7. Testing

```bash
npm test                              # 213 unit + integration tests (real PostgreSQL, real SMTP server)
npm run build && npm run test:e2e     # 24 Playwright scenarios (desktop + mobile) against the production build
```

* **Unit**: money/phone/geo, coupons, delivery, order & return state machines, RBAC, password hashing, CSRF/IP,
  schemas, SSLCommerz signature verification and validation checks, email/SMS templates (escaping, SMS length),
  log redaction, admin password policy.
* **Integration** (embedded PostgreSQL or `TEST_DATABASE_URL`): checkout totals, idempotency, concurrent checkouts
  that must not oversell, coupons under concurrency, payments (validation, signed/unsigned/forged callbacks, retry,
  reconciliation, expiry grace, duplicates, risk flags, amount limits), notifications delivered over real SMTP and
  a local HTTP SMS gateway (retries, failure states, demo suppression), password reset lifecycle, returns/refunds,
  support, demo-purge safety, upload validation and S3 storage (s3rver locally; MinIO with signature checks in CI),
  and an **authorization matrix that discovers every admin API route** and calls it as anonymous, customer, staff
  and admin.
* **E2E**: guest COD checkout → tracking, registration → wishlist → checkout → history, admin order workflow,
  inventory, role restrictions, **password reset via a real emailed link**, **return → approve → receive → refund**,
  **support message → inbox**, launch checklist, and **axe WCAG 2 A/AA scans** of ten key pages.

## 8. Deployment

Production target: one Linux server with Docker Compose — [`docker-compose.prod.yml`](docker-compose.prod.yml)
runs **Caddy** (automatic HTTPS), the app, a one-shot **migration** job, **PostgreSQL**, a **scheduler** for the
cron jobs and a **backup** job. Step-by-step instructions, DNS/HTTPS, first admin, SSLCommerz IPN, SMTP/SMS,
updates and rollback: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Backups, restore drills and runbooks:
[docs/OPERATIONS.md](docs/OPERATIONS.md).

```bash
cp .env.production.example .env.production   # fill in DOMAIN, APP_URL, POSTGRES_PASSWORD, CRON_SECRET, SMTP_…
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate npm run admin:create -- --email you@yourdomain.com
```

## 9. Security model

Summary below; the full audit with findings and fixes is in [docs/SECURITY.md](docs/SECURITY.md).

* **Passwords**: scrypt; admin passwords ≥ 12 characters; no default/demo password is ever published.
* **Sessions**: random token in an `HttpOnly; Secure; SameSite=Lax` cookie, only its SHA-256 stored; staff 12 h,
  customers 30 days sliding; revoked on block, role change, password change or reset.
* **Authorisation**: every admin page and API checks permissions server-side (`src/lib/permissions.ts`), verified
  for every route by the authorization-matrix test. Refunds and settings are administrator-only.
* **CSRF** (`Sec-Fetch-Site`/`Origin`), JSON-only bodies with size limits, Zod validation everywhere, UUID guards.
* **Abuse controls**: PostgreSQL-backed rate limits (login per IP/account, registration, checkout, tracking,
  password reset, returns, support, payment retry); generic errors without account enumeration.
* **Money & stock**: prices, discounts, delivery fees and stock recomputed in one locked transaction; database
  constraints forbid negative stock, inconsistent totals and over-refunding; idempotency keys stop duplicates.
* **Uploads**: re-encoded to WebP (content sniffing, EXIF/GPS stripped, size/dimension limits); served with
  `nosniff` and a restrictive CSP.
* **Headers**: nonce-based CSP, HSTS, COOP, strict referrer and permissions policies (verified through Caddy).
* **Logs**: structured JSON in production with automatic redaction of secret-looking fields; unexpected errors
  return a reference id instead of internals.

## 10. MKJ Ecosystem integration

* Versioned REST API (`/api/v1`) with a consistent envelope — see [docs/API.md](docs/API.md).
* Transactional outbox (`domain_events`) delivered to `ECOSYSTEM_WEBHOOK_URL`, signed with HMAC-SHA256
  (`X-MKJ-Signature: sha256=<hex of "timestamp.body">`, `X-MKJ-Timestamp`, `X-MKJ-Event`): order, payment, refund,
  return, support and customer events.
* UUID primary keys are safe to share across services.

## 11. Project structure

```
deploy/                  Caddyfile, scheduler, backup and restore scripts (production stack)
drizzle/                 SQL migrations (+ snapshots)
e2e/                     Playwright specs
public/images/demo/      AI-generated demo imagery (replace before launch)
scripts/                 db-local, migrate, seed, create-admin, jobs, mail-catcher, sslcommerz-sandbox-check, e2e-server
src/app/(store)/         storefront pages            src/app/admin/   admin login + (panel) pages
src/app/api/v1/          REST API                    src/app/api/payments, src/app/api/cron
src/components/          ui primitives, store components, admin components
src/lib/                 shared rules (money, phone, bd-geo, order-status, returns, permissions, validation)
src/server/              db, auth, http, services, payments, notifications, storage, jobs, logger, env
tests/unit, tests/integration, tests/support
```

## 12. Known limitations

* **Not verified against real providers here:** SSLCommerz sandbox/live, a real SMTP relay and a real SMS gateway
  (the build sandbox cannot reach them and no credentials were provided). Everything up to the provider boundary is
  tested; follow the checklists before launch.
* Courier APIs (Pathao, Steadfast, RedX) are not integrated — staff enter the courier, tracking number and link.
* Refunds are recorded, not executed through the SSLCommerz refund API.
* Support replies happen by email/phone from the inbox (no threaded conversations in the app).
* Search uses `ILIKE`; switch to PostgreSQL full-text or `pg_trgm` indexes for large catalogues.
* Single-server deployment: horizontally scaling needs S3 storage (supported) and a shared scheduler.
* Bengali-language UI, product reviews and analytics exports are future work. Policies and business details are
  templates/blank until the business fills them in and has them reviewed.
