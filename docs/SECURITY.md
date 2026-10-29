# Security audit (hardening phase)

Scope: every admin page and API route, sessions, CSRF, rate limiting, validation, uploads, payments, demo data,
secrets and logs. Method: code review plus automated tests (authorization matrix over every admin route,
integration and E2E tests) and a production rehearsal behind Caddy over HTTPS.

## Findings and fixes

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | **Critical** | Demo admin/staff/customer passwords were fixed values published in the README and on the admin login page; with `--force` they could exist in production. | Demo passwords are random per seed run (printed once) or `DEMO_ACCOUNT_PASSWORD` (dev only). Credentials removed from README/UI. Demo accounts cannot sign in (and existing sessions are rejected) in production unless `DEMO_MODE=true`; demo seeding in production requires `DEMO_MODE=true`. |
| 2 | **High** | "Remove demo data" cascaded into real records: real orders' stock-ledger rows (via demo variants), real coupon redemptions (via demo coupons), and could re-parent real categories; a demo admin could run it and keep a demo login. | Purge keeps and un-flags anything real data depends on (archived products, disabled coupons, curated collections, needed categories, blocked accounts), corrects real coupon counters, and refuses demo actors. Covered by an integration test that tries to break each rule. |
| 3 | **High** | SSLCommerz fail/cancel callbacks (unauthenticated POSTs) cancelled orders on the strength of a `tran_id` alone. | Failure notices act only with a valid `verify_sign`; unsigned ones are reconciled with the Transaction Query API; failed attempts no longer cancel the order. |
| 4 | **High** | Expiry cancelled unpaid online orders without checking the gateway — a lost IPN meant a paid order was cancelled and its stock resold. | Expiry reconciles each attempt with the gateway first (grace period when unreachable). |
| 5 | Medium | `admin:create` accepted the password as a CLI argument (shell history, `ps`) and only warned below 12 characters; `ADMIN_PASSWORD` in the seed had no policy. | Hidden prompt or `--password-stdin`; CLI argument refused; 12+ characters with letters and digits, not derived from the email — enforced in both places. |
| 6 | Medium | Unexpected errors were logged with `console.error`, unstructured, no correlation id; risk of logging secrets. | Structured JSON logger with recursive redaction of secret-like keys; error reference id returned to clients; gateway network errors never include URLs (they carry the store password). |
| 7 | Medium | No customer password reset (support burden, insecure workarounds). | Hashed single-use 30-min tokens, no enumeration, per-IP and per-email limits, all sessions revoked, staff excluded. |
| 8 | Medium | Demo seed wrote a demo support email into the real (non-demo) store settings. | Removed; business details start blank. |
| 9 | Low | Online payment allowed totals outside SSLCommerz's ৳10–৳5,00,000 range (gateway error after the order was created). | Rejected before order creation and hidden in the quote. |
| 10 | Low | Text colour `text-faint` failed WCAG AA contrast. | Raised to ≥4.5:1 (axe scans now clean on ten pages). |
| 11 | Low | `CSP_FRAME_ANCESTORS='self'` from the env examples reached the header as a bare `self` (env parsers strip the quotes) — a host named "self", so the documented setting did not mean what it said. Sign-out cleared cookies with a bare `Max-Age=0`, without their attributes. | Bare `self`/`none` are re-quoted; cookies are cleared with their full attribute set. Unit-tested. |

## Verified controls

* **Authorization**: `tests/integration/security-authz.test.ts` discovers all admin route files and asserts
  anonymous → 401, customer → 403, staff → 403 on administrator-only routes (settings, coupons, delivery zones,
  demo data, notifications, refunds, role changes) and access elsewhere. Admin pages use the same permission map.
* **Sessions**: SHA-256 stored tokens, `HttpOnly; Secure; SameSite=Lax` (verified over HTTPS), rotation on login,
  revocation on block/role change/password change/reset.
* **CSRF**: cross-site mutations rejected (verified through the proxy); payment callbacks are the only exemption
  and never trust posted data.
* **Embedding**: by default `frame-ancestors 'self'` and `SameSite=Lax` cookies. Serving the store inside a
  cross-site iframe (e.g. a hosted preview panel) needs both `CSP_FRAME_ANCESTORS` listing the embedding origins
  and `COOKIE_SAMESITE=none`, which forces `Secure; Partitioned` so browsers that block third-party cookies keep
  a per-embedder jar. CSRF checks do not rely on SameSite, but keep both defaults on a real store: letting other
  sites frame a signed-in store invites clickjacking.
* **Rate limits**: login, registration, checkout, tracking, password reset, returns, support, payment retry,
  notification tests; behind Caddy (`TRUST_PROXY=1`) spoofed `X-Forwarded-For` does not bypass them (verified).
* **Input validation**: Zod on every body/query; UUID guards on path ids; JSON-only bodies ≤ 256 KB.
* **Money/stock integrity**: locked recomputation in checkout, DB CHECK constraints (stock ≥ 0, totals consistent,
  refunded ≤ total), idempotency keys, refunds only recorded (never executed) with mandatory confirmation.
* **Uploads**: re-encoding to WebP, format allow-list, size/pixel/dimension limits, random names, path-traversal
  safe reads, `nosniff` + restrictive CSP on media.
* **Secrets**: only in environment variables; `.env*` git- and docker-ignored; gateway responses redacted before
  storage; guest order links in the email outbox are erased after delivery; reset links are never stored.

## Residual risks / recommendations

* Real-provider verification (SSLCommerz, SMTP, SMS) is pending — see [SSLCOMMERZ.md](SSLCOMMERZ.md).
* No 2FA for staff yet; use long unique passwords and keep the admin team small.
* No WAF/bot protection beyond rate limits; consider Cloudflare in front of Caddy for a public launch.
* Dependency updates: run `npm audit` and update Next.js/React promptly when security releases appear.
