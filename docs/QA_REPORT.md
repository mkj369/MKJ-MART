# QA audit — 2026-10-30

Scope: the whole MKJ MART application as it runs in the Arena preview, for customer, staff and administrator.
Everything marked PASS below was exercised in a real browser (headless Chromium 153 via Playwright) or by the
automated suites listed, on the production build. Nothing is marked PASS on the strength of a successful build.

## How it was tested

| Where | What |
| --- | --- |
| Live preview server (port 3000, preview database) | Scripted journeys for all three roles, run twice: directly, and behind `scripts/cookie-stripping-proxy.ts`, which reproduces the Arena preview path. Console errors and failed requests captured. **113/113 steps passed.** |
| Real Arena preview | The owner signed in, reloaded and placed a guest order in the actual preview. A passive packet monitor and the server log confirmed what reached the app. |
| Isolated databases (`mkj_e2e`, `mkj_e2e_preview`) | Playwright suite: 35 scenarios (desktop, mobile, cookie-stripping proxy). |
| Link crawler | 84 pages and 293 assets reachable from the home page: 0 broken links, 0 server errors. |
| Fresh database | Both migrations applied to an empty database (32 tables), `drizzle-kit check` clean, re-run is a no-op. |

## The login failure — exact cause

Evidence from the preview database and a packet capture on the sandbox interface:

1. Sign-in and registration **succeeded on the server**: sessions were created, passwords verified, CSRF checks passed.
2. The responses carried the session cookie (`Secure; HttpOnly; SameSite=None; Partitioned`) and the browser **stored it**
   (a JavaScript-readable marker cookie set alongside it was visible to the page).
3. **No request from the preview ever carried a `Cookie` header** (0 of 190), nor a `Referer`, while every request
   carried the `e2b-traffic-access-token` header that the preview adds. The preview proxy strips cookies.
4. With no cookie, every request after signing in was anonymous; the form then navigated to `/account`, the middleware
   sent the user back to `/login`, and the form showed no error — the "login does not work" loop. The guest bag
   (`mkj_cart` cookie) was lost on every request for the same reason, so the bag and checkout were broken too.

Fix (see `src/lib/session-transport.ts`): with `SESSION_HEADER_FALLBACK=true` (honoured only with `DEMO_MODE=true`)
the server mirrors the session and bag into `x-mkj-set-*` response headers, and an inline script keeps them in
sessionStorage for the tab and sends them back as `x-mkj-session` / `x-mkj-cart` on same-origin requests. Independently,
sign-in now confirms the session took effect and shows an actionable error instead of looping. Verified by the owner in
the real preview (signed in, stayed signed in after a reload) and by server evidence (127 preview requests carried the
session header; no further `auth.session_check_failed` warnings).

## Issues found

| # | Severity | Issue | Status |
| --- | --- | --- | --- |
| 1 | Critical | Arena preview: sign-in, registration, admin panel, guest bag and checkout unusable — the preview proxy strips the `Cookie` request header. | **Fixed** (opt-in header fallback for demo previews); verified in the real preview + `e2e/preview-proxy.spec.ts`. |
| 2 | High | When the session cookie does not come back (any cause: proxies, blocked cookies), sign-in, registration and password reset silently loop back to the sign-in page. | **Fixed**: post-sign-in session check with a specific message, logged as `auth.session_check_failed`. |
| 3 | Medium | Orders placed by demo accounts through the live checkout were stored as real orders; "Remove demo data" kept them and the demo account. | **Fixed**: orders inherit the buyer's demo flag (integration test; verified live). |
| 4 | Medium | The bag page kept its first copy of the lines, so a server refresh with newer contents still showed "Your bag is empty" (surfaced by full page loads behind the cookie-stripping proxy). | **Fixed**: the bag view remounts when the server-side bag changes; covered by the proxy E2E. |
| 5 | Low | Missing, draft and archived product URLs and unknown order links show the 404 page with HTTP **200** + `noindex` (the loading skeleton starts streaming before the lookup). Content is correctly hidden. | **Open by choice**: the only fix is removing those loading skeletons, which hurts perceived speed on slow connections; `noindex` keeps them out of search. |
| 6 | Low | In the preview, per-IP login/registration limits key on the proxy's address, so several testers share one limit. | **Open** (preview only): per-account limits still apply; production sets `TRUST_PROXY` behind Caddy. |

Observations checked and found correct: checkout keeps "Place order" disabled until a district is chosen (the summary
says "Select district"); products cannot be published without a photo; staff cannot open coupons, delivery zones,
settings or refunds.

## Tests run

| Gate | Result |
| --- | --- |
| TypeScript typecheck · ESLint | pass · pass |
| Vitest unit + integration (real PostgreSQL, local SMTP server, local S3 stand-in) | 244 passed, 1 skipped (S3 wrong-credentials test: needs a signature-checking S3 server; runs in CI against Silo) |
| Migrations on an empty database · drizzle-kit check | pass (32 tables, 2 migrations) · no drift |
| Playwright (production build) | 35/35: desktop 28, mobile 2, preview-proxy 5 |
| Production build | pass |
| Live preview journeys (direct + cookie-stripping proxy) | 113/113 steps |
| Link crawl | 84 pages + 293 assets, 0 errors |

New or improved tests: `tests/unit/session-transport.test.ts`, `tests/integration/header-session.test.ts`, a demo-order
case in `tests/integration/checkout.test.ts`, `e2e/qa-gaps.spec.ts` (failed sign-ins, logout, persistence, bag
quantity/removal, checkout validation, full product lifecycle, staff restrictions) and `e2e/preview-proxy.spec.ts`.
`tests/integration/demo-safety.test.ts` keeps all its assertions; only the order of its setup changed so it still
models a real order linked to a demo account.

## QA checklist

| Feature | Result | Evidence |
| --- | --- | --- |
| Customer sign-in (valid) | PASS | E2E desktop + proxy; live journeys; owner in the real preview |
| Sign-in with wrong password (customer, admin) | PASS | `qa-gaps` E2E; live journeys |
| Sign-out | PASS | `qa-gaps` + proxy E2E; live journeys |
| Session persists after reload | PASS | `qa-gaps` + proxy E2E; live journeys; owner in the real preview |
| Customer registration | PASS | `account` + proxy E2E |
| Forgot / reset password | PASS (local mail) | `hardening` E2E through a local SMTP catcher; real inbox delivery BLOCKED (no SMTP credentials) |
| Admin sign-in and dashboard | PASS | E2E; live journeys (13 admin pages render); proxy E2E |
| Staff permission restrictions | PASS | `admin` + `qa-gaps` + proxy E2E; live journeys (6 allowed, 3 denied) |
| Browsing, search, category filter, sort | PASS | `storefront` E2E; live journeys; crawl |
| Product detail and images | PASS | live journeys (no broken images); crawl (293 assets) |
| Add to bag / change quantity / remove | PASS | `qa-gaps` E2E; live journeys (both modes) |
| Bag persists (reload, sign-in merge) | PASS | E2E; `header-session` integration |
| Checkout validation | PASS | `qa-gaps` E2E; live journeys |
| Cash on Delivery order placement | PASS | `storefront`, `account`, proxy E2E; live order as demo customer; owner's order in the real preview |
| SSLCommerz online payment | BLOCKED | no sandbox credentials; gateway hosts unreachable from the sandbox. Only simulated (integration tests with a fake gateway) |
| Order history | PASS | `account` E2E; live journeys |
| Order tracking | PASS | `storefront` E2E |
| Product create / publish / archive / delete | PASS | `qa-gaps` E2E (draft hidden, photo required, published visible, archived hidden, deleted) |
| Inventory adjustment with ledger | PASS | `admin` E2E |
| Order management (confirm, ship) | PASS | `admin` E2E |
| Returns and refunds workflow | PASS (recorded) | `hardening` E2E: request → approve → receive → refund recorded. Refunds are recorded, never sent to a gateway |
| Support form and admin inbox | PASS | `hardening` E2E |
| Email notifications | PASS (local) / BLOCKED (real) | integration + E2E against local SMTP servers; real provider needs SMTP credentials |
| SMS notifications | Simulated / BLOCKED (real) | integration tests against a local HTTP gateway; real provider needs credentials |
| Mobile layout | PASS | mobile E2E project; no sideways scrolling on 10 pages + admin dashboard (Pixel 7) |
| Accessibility | PASS | axe (WCAG 2 A/AA) on 10 pages: no serious or critical violations |
| CSRF and authorization | PASS | integration (authorization matrix over every admin route); live cross-site request → 403, also with the session header |
| Broken links / server errors | PASS | crawl: 0 errors; live journeys: no failed requests except the deliberate wrong-password 401s |
| Database migrations | PASS | fresh database + drift check |
| Demo-data purge safety | PASS | integration |
| Correct HTTP 404 for missing products | FAIL (Low) | soft 404, see issue 5 |
| Production Docker stack | PASS in CI | `production-stack` job (Silo-based CI fix, earlier run) |

## Still required from outside

- SSLCommerz sandbox credentials (store ID / password) to test online payment end to end (`npm run payments:sandbox-check`).
- SMTP credentials for real email delivery; an SMS provider account (Twilio or an HTTP gateway) for SMS.
- A server and domain for a real deployment (see docs/DEPLOYMENT.md); real business details, reviewed policies and photos.
- Arena: forwarding the `Cookie` header in the preview would make the header fallback unnecessary.
