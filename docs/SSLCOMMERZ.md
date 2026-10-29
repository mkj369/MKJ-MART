# SSLCommerz integration

Implemented against the official v4 documentation (<https://developer.sslcommerz.com/doc/v4/>) and the official
libraries (`sslcommerz/SSLCommerz-PHP` for the `verify_sign` algorithm, `sslcommerz/SSLCommerz-NodeJS` for
endpoints/parameters).

> **Verification status:** all flows below are covered by automated tests against a mocked gateway that returns
> the documented response shapes. **The real sandbox has NOT been exercised** — no sandbox credentials were
> provided, and the build environment cannot reach `sandbox.sslcommerz.com`. Complete the checklist below on your
> server before enabling online payment for customers.

## How it works

1. **Checkout** creates the order (stock reserved) and a `payment_transactions` row, then calls
   `POST /gwprocess/v4/api.php` and redirects the customer to `GatewayPageURL`. Totals must be ৳10–৳5,00,000.
   If the session cannot be created, the order is cancelled, stock released and the bag restored.
2. **Success / IPN** callbacks with status `VALID`/`VALIDATED` are confirmed with the **Validation API**
   (`/validator/api/validationserverAPI.php`); the order is paid only if status, `tran_id`, amount and currency all
   match our record. Repeated callbacks are idempotent.
3. **Fail / cancel** callbacks change state only when `verify_sign` is valid (md5 over the `verify_key` fields +
   `md5(store password)`). Unsigned notices trigger a **Transaction Query API** lookup
   (`/validator/api/merchantTransIDvalidationAPI.php?tran_id=…`) instead. A failed attempt keeps the order reserved;
   the customer can **Pay now** (new `tran_id`) until `PAYMENT_TIMEOUT_MINUTES` elapses.
4. **Expiry job** (`/api/cron/expire-payments`, every 5 min) queries the gateway for every attempt before
   cancelling; a payment whose IPN was missed is recorded as paid. If the gateway is unreachable it waits up to 2 h.
5. **Edge cases surfaced to staff:** payment after cancellation, duplicate payment (e.g. two tabs), amount/currency
   mismatch, and `risk_level = 1` (SSLCommerz says: hold the service and verify the customer).
6. **Refunds** are issued in the SSLCommerz merchant panel and then recorded in the order (refund ledger).

## Sandbox checklist (run on the deployed server)

1. Register a sandbox store: <https://developer.sslcommerz.com/registration/>. Put the store id/password in
   `.env.production` with `SSLCOMMERZ_MODE=sandbox`; `APP_URL` must be your public `https://` domain.
2. In the sandbox merchant panel set the IPN URL: `https://<DOMAIN>/api/payments/sslcommerz/ipn`.
3. `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate npm run payments:sandbox-check`
   — must report ✔ for TLS, session creation, Transaction Query API and Validation API, and prints a sandbox
   payment link.
4. Manual end-to-end, recording the order number for each:
   - [ ] Card payment (`4111 1111 1111 1111`, future expiry, CVV `111`, OTP `111111`) → order *Paid*, confirmation email.
   - [ ] Mobile-banking payment in the sandbox → order *Paid*.
   - [ ] Failed payment → order still reserved, *Pay now* opens a new session, then succeed.
   - [ ] Cancel on the gateway page → order reserved; customer cancel releases stock.
   - [ ] Close the tab mid-payment → after the window the order is cancelled by the scheduler and stock returns.
   - [ ] IPN only: complete a payment but close the browser before the redirect → order still becomes *Paid* (IPN).
   - [ ] Admin → order → *Check payment with gateway* matches the merchant panel.
   - [ ] The merchant panel's transaction list matches the admin order list for all of the above.
5. Only then switch to live credentials and `SSLCOMMERZ_MODE=live`, set the live IPN URL, and make one small real
   payment and refund before announcing online payment.
