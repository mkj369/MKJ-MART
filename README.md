# MKJ MART

**The e-commerce platform for MKJ Store — part of the MKJ Ecosystem.**
A production-oriented, full-stack fashion store built for Bangladesh: Taka pricing, Cash on Delivery
in all 64 districts, SSLCommerz online payments (bKash, Nagad, Rocket, cards), district-based delivery
zones, and a complete back office.

| Storefront | Admin |
| --- | --- |
| Home, shop with search/filters/sort/pagination, collections, product pages (sizes, colours, live stock), bag, checkout, order confirmation & public tracking, accounts (profile, addresses, order history, wishlist, password) | Dashboard (sales, revenue collected, AOV, work queue, low stock, top products), orders workflow, products & variants & images, inventory ledger, categories, collections, sizes & colours, customers & roles, coupons, delivery zones, settings & policies, demo-data removal |

---

## Contents

1. [Tech stack & architecture](#1-tech-stack--architecture)
2. [Run locally](#2-run-locally)
3. [Database configuration](#3-database-configuration)
4. [Environment variables](#4-environment-variables)
5. [Demo data vs real data](#5-demo-data-vs-real-data)
6. [Payments (Cash on Delivery & SSLCommerz)](#6-payments)
7. [Testing](#7-testing)
8. [Deployment](#8-deployment)
9. [Security model](#9-security-model)
10. [MKJ Ecosystem integration](#10-mkj-ecosystem-integration)
11. [Project structure](#11-project-structure)
12. [Known limitations & roadmap](#12-known-limitations--roadmap)

More detail: [`docs/DATABASE.md`](docs/DATABASE.md) (schema) · [`docs/API.md`](docs/API.md) (REST API) · [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (production checklist).

---

## 1. Tech stack & architecture

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript 5.9** | One deployable for storefront, admin and API; server-rendered pages; typed end to end |
| Styling | **Tailwind CSS 4**, self-hosted Cormorant Garamond + Jost (+ a 1 KB ৳ glyph subset) | Fast, consistent design tokens; no runtime font CDN |
| Database | **PostgreSQL 14+** with **Drizzle ORM**, versioned SQL migrations in `drizzle/` | Transactions + row locks for stock safety, CHECK constraints as a last line of defence |
| Validation | **Zod 4** schemas shared by browser and server | Instant client feedback, authoritative server checks |
| Auth | Custom DB sessions (hashed tokens), scrypt passwords, role-based permissions | No third-party dependency, revocable sessions, blocked users rejected per request |
| Payments | **Cash on Delivery** + **SSLCommerz v4** (server-side validation API) | Covers bKash, Nagad, Rocket, cards and internet banking in Bangladesh |
| Tests | **Vitest 5** (unit + integration on real PostgreSQL), **Playwright** E2E | Concurrency and payment edge cases tested against a real database |

**Layering** (each layer only calls the one below):

```
src/app/(store), src/app/admin      → pages (Server Components) + client components (src/components)
src/app/api/v1/**/route.ts          → thin HTTP handlers: auth, CSRF, validation, JSON envelopes (src/server/http)
src/server/services/**              → business logic (checkout, orders, inventory, coupons, payments …)
src/server/db                       → Drizzle schema + connection; drizzle/ holds SQL migrations
src/lib                             → framework-free shared code (money, phone, geography, validation, RBAC)
```

All money is stored and computed as **integer poisha** (1 BDT = 100 poisha) and rendered as `৳1,250`.

## 2. Run locally

Requirements: **Node.js 20.9+** (22 LTS recommended). No Docker or system PostgreSQL needed.

```bash
git clone <repo> && cd MKJ-MART
npm install
cp .env.example .env.local          # defaults work out of the box for local development

# Terminal 1 — a real PostgreSQL server, installed via npm (data in ./.data/postgres)
npm run db:local

# Terminal 2
npm run db:migrate                  # create the schema
npm run db:seed -- --demo           # base settings + clearly flagged demo catalogue/orders
npm run dev                         # http://localhost:3000
```

Demo sign-ins (only exist while demo data is loaded — see §5):

| Role | Email | Password | Where |
| --- | --- | --- | --- |
| Administrator | `admin@mkjmart.demo` | `Admin@12345` | `/admin` |
| Staff | `staff@mkjmart.demo` | `Staff@12345` | `/admin` (no settings/coupons/role changes) |
| Customer | `customer@mkjmart.demo` | `Customer@123` | `/login` |

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build for production, run the production build |
| `npm run db:local` | Run PostgreSQL locally (embedded binaries) using the credentials in `DATABASE_URL` |
| `npm run db:migrate` | Apply pending migrations (safe on every deploy) |
| `npm run db:seed` | Base data only: sizes, colours, delivery zones (safe in production) |
| `npm run db:seed -- --demo` | Also load demo data (refused when `NODE_ENV=production` unless `--force`) |
| `npm run db:reset` | **Dev only** — drop everything, migrate, seed demo data |
| `npm run db:generate` | Generate a new SQL migration after editing `src/server/db/schema.ts` |
| `npm run admin:create -- --email … --password … --name …` | Create or promote a real administrator |
| `npm run jobs:expire-payments` | Cancel unpaid online orders past their payment window (cron) |
| `npm run jobs:dispatch-events` | Deliver domain events to the MKJ Ecosystem webhook (cron) |
| `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:e2e` | Quality gates |

## 3. Database configuration

Set `DATABASE_URL` (PostgreSQL 14 or newer). Three common setups:

| Setup | `DATABASE_URL` |
| --- | --- |
| **npm (no Docker)** — `npm run db:local` | `postgres://mkj:mkj_local_dev@127.0.0.1:5433/mkj_mart` (default in `.env.example`) |
| **Docker** — `docker compose up -d db` | same as above (compose maps the container to `127.0.0.1:5433`) |
| **Managed** (Neon, Supabase, AWS RDS, Railway, DigitalOcean…) | the provider's connection string, usually ending in `?sslmode=require` |

Then run `npm run db:migrate`. Migrations are plain SQL files in `drizzle/` tracked in the
`drizzle.__drizzle_migrations` table; to change the schema edit `src/server/db/schema.ts`, run
`npm run db:generate`, review the generated SQL, and commit it. Optional: `DATABASE_POOL_MAX` (default 10
connections per app instance). The full schema is documented in [`docs/DATABASE.md`](docs/DATABASE.md).

## 4. Environment variables

Every variable is documented in [`.env.example`](.env.example). Summary:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `APP_URL` | ✅ (prod) | Public HTTPS origin, used for payment callbacks and origin checks |
| `COOKIE_SECURE` | – | `auto` (Secure cookies in production) / `true` / `false` |
| `TRUST_PROXY` | – | Number of trusted reverse-proxy hops for client IPs (`true` = 1) |
| `UPLOAD_DIR` | – | Where admin image uploads are stored (persistent volume in production) |
| `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | for online payment | Gateway credentials — online payment stays hidden until set |
| `SSLCOMMERZ_MODE` | – | `sandbox` (default) or `live` |
| `PAYMENT_TIMEOUT_MINUTES` | – | Unpaid online orders are cancelled after this (default 30) |
| `CRON_SECRET` | for HTTP cron | Bearer token for `POST /api/cron/*` |
| `CSP_FRAME_ANCESTORS` | – | Who may embed the site in an iframe (default `'self'`) |
| `ECOSYSTEM_WEBHOOK_URL`, `ECOSYSTEM_WEBHOOK_SECRET` | – | Signed domain-event delivery to other MKJ services |

Secrets are only read on the server (`src/server/env.ts`); none are exposed to the browser and none are
stored in the database. **Never commit `.env.local` / production secrets.**

## 5. Demo data vs real data

* `npm run db:seed` loads only **configuration** every store needs (sizes, colours, three delivery zones).
* `npm run db:seed -- --demo` adds **fictional** products, accounts, coupons and 13 orders. Every demo row
  has `is_demo = true`, demo emails use the non-routable `@mkjmart.demo` domain, and demo orders are placed
  through the real checkout service (so stock ledger, totals and events are consistent).
* While demo data exists the storefront shows a **"Demo store" notice**, admin lists tag records **Demo**,
  and the admin login shows the demo credentials.
* Product photos in `public/images/demo/` are **AI-generated placeholders** — replace them with real
  photography. Six women's/accessory products are seeded as **drafts** because they have no photos yet.
* Before launch: **Admin → Settings → Demo data → Remove demo data** (type-to-confirm). Real records are never
  touched and your current admin account is kept. Then create your real admin with `npm run admin:create`.

## 6. Payments

**Cash on Delivery** works out of the box. Orders start as *Placed / Unpaid*; staff confirm them by phone,
and COD orders are marked *Paid* automatically when set to *Delivered* (or manually via "Record cash
received"). An optional COD order limit can force online payment for large orders.

**SSLCommerz** (integrated, verified with automated tests against a mocked gateway; **not yet exercised
against the live sandbox** — needs your credentials):

1. Register a sandbox store at <https://developer.sslcommerz.com/registration/>.
2. Set `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE=sandbox` and a public HTTPS
   `APP_URL` (SSLCommerz must reach `APP_URL/api/payments/sslcommerz/{success,fail,cancel,ipn}`; for local
   testing use a tunnel such as Cloudflare Tunnel or ngrok).
3. In the SSLCommerz merchant panel set the **IPN URL** to `https://<your-domain>/api/payments/sslcommerz/ipn`.
4. Place a test order with "Pay online". The order is only marked paid after the server calls the
   **Validation API** and verifies status, transaction id, amount and currency — browser redirects alone are
   never trusted. Failed/cancelled payments cancel the order, release stock and let the customer restore
   their bag.
5. Schedule `npm run jobs:expire-payments` (or `POST /api/cron/expire-payments` with
   `Authorization: Bearer $CRON_SECRET`) every 5–10 minutes to release stock from abandoned payments.
6. For production switch to `SSLCOMMERZ_MODE=live` with your live store credentials.

Refunds are made in the SSLCommerz dashboard (or by bKash/bank for COD) and then recorded in the order with
"Record refund issued" — the app does not move money for refunds.

## 7. Testing

```bash
npm test               # 125 unit + integration tests (real PostgreSQL)
npm run build && npm run test:e2e   # 10 Playwright scenarios against the production build
```

* **Unit** (`tests/unit`): money/phone/geo helpers, coupon and delivery rules, order state machine, RBAC,
  password hashing, CSRF/IP helpers, Zod schemas, SSLCommerz client (mocked HTTP) and validation checks.
* **Integration** (`tests/integration`): run against a real PostgreSQL — an embedded server is started
  automatically, or set `TEST_DATABASE_URL` to a role that can `CREATE DATABASE`. Each test file gets its
  own database cloned from a migrated template. Covers checkout totals, idempotency, **parallel checkouts
  that must not oversell**, coupon limits under concurrency, COD limits, guest checkout settings, order
  lifecycle (cancel/return restocks, coupon release), payments (validation, forged callbacks, gateway
  outage, expiry, late payments), auth (lockout, blocked users, session revocation, last-admin guard),
  cart merge, admin catalogue/inventory, and HTTP-level CSRF/RBAC/validation.
* **E2E** (`e2e/`): guest COD checkout → tracking (desktop + mobile), registration → wishlist → checkout →
  order history, admin order workflow, inventory adjustment, customers blocked from admin, staff blocked
  from settings. `scripts/e2e-server.ts` creates a fresh `mkj_e2e` database for each run. If Playwright's
  browsers can't be downloaded, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chromium.

## 8. Deployment

The app is a standard Node.js server (`output: 'standalone'`). Full checklist in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short:

**Docker (single server / VPS)**

```bash
docker compose up -d --build                         # PostgreSQL + migrations + app on :3000
docker compose run --rm tools npm run admin:create -- --email owner@yourstore.com --password '…'
```

Put it behind HTTPS (Caddy, Nginx + Let's Encrypt, or Cloudflare), set `APP_URL` to the public URL,
`COOKIE_SECURE=auto`, `TRUST_PROXY=1`, and keep `pgdata` and `uploads` on persistent volumes with backups.

**Platform hosting** (Railway, Render, Fly.io, DigitalOcean App Platform…): build `npm run build`, start
with `npm start` (the Dockerfile shows how to run the leaner `.next/standalone/server.js`), run `npm run db:migrate` as a release command, attach a
managed PostgreSQL and a persistent disk for `UPLOAD_DIR`. On serverless platforms (e.g. Vercel) use a pooled
Postgres URL and replace local-disk uploads with object storage (see §12).

Schedule the two jobs (`jobs:expire-payments`, `jobs:dispatch-events`) via cron or the HTTP endpoints.

## 9. Security model

* **Passwords**: scrypt (N=2¹⁵, r=8, p=3), per-user salt, transparent rehash on parameter changes.
* **Sessions**: 256-bit random token in an `HttpOnly; SameSite=Lax; Secure` cookie; only its SHA-256 is
  stored. Customers 30 days (sliding), staff 12 hours. Blocking a user or changing roles revokes sessions
  immediately; password changes sign out other devices; login rotates the session (fixation defence).
* **Authorisation**: every admin page and API call checks the role server-side (`src/lib/permissions.ts`);
  `proxy.ts` only adds fast redirects. Staff cannot change settings, coupons, delivery zones or roles.
* **CSRF**: cookie-authenticated mutations require same-origin `Sec-Fetch-Site`/`Origin`; JSON-only bodies.
* **Abuse controls**: PostgreSQL-backed rate limits on login (per IP and per account), registration,
  checkout and order tracking; generic login errors; constant-time path for unknown emails.
* **Checkout integrity**: prices, discounts, delivery fees and stock are recomputed inside one transaction
  with row locks; totals that changed are rejected; idempotency keys stop duplicate orders; DB constraints
  forbid negative stock and inconsistent totals.
* **Data exposure**: guest orders are viewable only with an unguessable token; public tracking requires
  order number + phone and returns a masked, address-free view.
* **Uploads**: images are decoded and re-encoded to WebP by sharp (content sniffing, EXIF stripped, size
  limits); media are served with `nosniff` and path-traversal checks.
* **Headers**: nonce-based Content-Security-Policy in production, HSTS, `nosniff`, strict referrer policy,
  restricted permissions policy, `frame-ancestors` configurable.

## 10. MKJ Ecosystem integration

* **Versioned REST API** under `/api/v1` with a consistent envelope (`{ data }` / `{ error: { code, message, fields } }`) — see [`docs/API.md`](docs/API.md).
* **Transactional outbox** (`domain_events`): `order.placed`, `order.status_changed`, `order.cancelled`,
  `payment.succeeded`, `payment.failed`, `customer.registered`, `inventory.low_stock` are written in the same
  transaction as the change and delivered to `ECOSYSTEM_WEBHOOK_URL` signed with HMAC-SHA256
  (`X-MKJ-Signature: sha256=<hex of "timestamp.body">`, `X-MKJ-Timestamp`, `X-MKJ-Event`).
* UUID primary keys are safe to share across services.

## 11. Project structure

```
drizzle/                 SQL migrations (+ snapshots)
e2e/                     Playwright specs
public/images/demo/      AI-generated demo imagery (replace before launch)
scripts/                 db-local, migrate, seed (+ seed-data), reset, create-admin, jobs, e2e-server
src/app/(store)/         storefront pages
src/app/admin/           admin login + (panel) pages
src/app/api/v1/          REST API route handlers;  src/app/api/payments, src/app/api/cron
src/components/          ui primitives, store components, admin components
src/lib/                 shared, framework-free code (money, phone, bd-geo, order-status, permissions, validation)
src/server/              db, auth, http helpers, services, payments, storage, env
tests/unit, tests/integration, tests/support
```

## 12. Known limitations & roadmap

Implemented and tested: everything listed above. **Not implemented yet** (intentionally not faked):

* Email/SMS notifications (order confirmation, shipping updates) and **customer self-service password
  reset** — both need an email/SMS provider. Signed-in customers can change their password; administrators
  can regain access with `npm run admin:create`.
* Courier API integrations (Pathao, Steadfast, RedX): staff enter the courier and tracking number manually.
* Online refunds through the SSLCommerz API (recorded manually after refunding in the dashboard).
* SSLCommerz has been tested against a mocked gateway only — run the sandbox checklist in §6 before launch.
* Uploads are stored on local disk; multi-instance or serverless deployments need object storage (S3/R2).
* Search uses `ILIKE` across name, description, tags and category — fine for thousands of products; switch
  to PostgreSQL full-text or `pg_trgm` indexes for large catalogues.
* Bengali-language UI, product reviews, multi-image galleries per colour for demo products, and analytics
  exports are future work. Policy texts and home-page copy are templates for the business to review.
