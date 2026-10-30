# Controlled-launch checklist

Admin → **Settings → Launch readiness** checks most of this live. Items marked *(manual)* cannot be checked by
the app.

## Must be green before taking real orders
- [ ] Public URL is HTTPS and `APP_URL` matches it; secure cookies on.
- [ ] A real administrator account exists (created with `npm run admin:create`); **demo data removed** (no demo
      staff accounts can sign in).
- [ ] Business details entered (legal name, trade licence, address, support email/phone) — real and verified.
- [ ] Delivery zones and fees reviewed for your courier contracts; free-delivery threshold and COD limit decided.
- [ ] Outgoing email works (*Send test email* arrives, not in spam); password reset tested with a real mailbox.
- [ ] Scheduler running (job heartbeats recent).
- [ ] At least one published product with real photos; all published products have photos and correct stock.
- [ ] Backups running **and copied off the server**; one restore practised *(manual)*.
- [ ] Policies (delivery, returns, privacy, terms) **reviewed by the business / legal adviser** and marked reviewed
      *(manual review)*.

## If you accept online payments
- [ ] SSLCommerz sandbox checklist in [SSLCOMMERZ.md](SSLCOMMERZ.md) completed and recorded.
- [ ] Live credentials + `SSLCOMMERZ_MODE=live`, live IPN URL set, one small real payment and refund done.

## Recommended
- [ ] SMS provider configured and tested (optional).
- [ ] Uptime monitor on `/api/v1/health`; someone watches the support inbox and the "Notifications needing
      attention" panel daily.
- [ ] Staff trained on: confirming COD orders by phone, shipping with tracking links, returns → refund recording,
      high-risk payment handling.
- [ ] A soft launch with friends/family orders (COD and online) before public announcement.
