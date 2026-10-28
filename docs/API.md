# REST API (v1)

Base path: `/api/v1`. JSON in, JSON out. Used by the storefront and admin UI, and available to other MKJ Ecosystem
services.

## Conventions

* **Success**: `200 { "data": … }`
* **Error**: `{ "error": { "code": "STOCK_UNAVAILABLE", "message": "Human readable", "fields": { "contact.phone": "…" }, "details": … } }`
* Status codes: `400` bad request · `401` not signed in · `403` forbidden / CSRF · `404` not found · `409` conflict
  (stock, price change, invalid transition) · `413/415` body problems · `422` validation · `429` rate limited
  (`Retry-After`) · `502` payment gateway unavailable.
* **Money** is integer poisha. **Phones** are normalised to `01XXXXXXXXX`.
* **Auth**: `mkj_session` httpOnly cookie (set by the login/register endpoints). Mutations from browsers must be
  same-origin (`Sec-Fetch-Site`/`Origin` are checked); bodies must be `application/json`.
* Responses are `Cache-Control: no-store`.

## Public & customer endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | – | `{ status, database, latencyMs }` |
| POST | `/auth/register` | – | `{ name, email, phone?, password }` → creates customer, signs in, merges guest bag |
| POST | `/auth/login` | – | `{ email, password }` → signs in (rate limited), merges guest bag |
| POST | `/auth/logout` | – | Ends the session |
| GET | `/auth/me` | – | `{ user, cartCount, wishlistIds }` |
| GET | `/products` | – | Query: `q, category, collection, size (repeatable), color (repeatable), minPrice, maxPrice (taka), inStock=1, onSale=1, sort (featured\|newest\|price-asc\|price-desc\|bestselling), page, pageSize ≤ 48` |
| GET | `/products/:slug` | – | `{ product, related }` (active products only) |
| GET | `/categories` | – | `{ categories (tree with counts), collections, facets }` |
| GET | `/cart` | – | Current bag with live prices, stock and issues |
| POST | `/cart/items` | – | `{ variantId, quantity }` (stock and per-item limit enforced) |
| PATCH / DELETE | `/cart/items/:itemId` | – | `{ quantity }` (0 removes) / remove |
| POST | `/checkout/quote` | – | `{ district?, couponCode?, phone? }` → totals, delivery zone, coupon result, payment methods |
| POST | `/checkout` | – | Place order (see below) |
| GET | `/orders` | customer | Order history (`?page=`) |
| GET | `/orders/:orderNumber` | owner or `?token=` | Order detail |
| POST | `/orders/:orderNumber/cancel` | owner or `{ token }` | Cancel while pending & unpaid |
| POST | `/orders/:orderNumber/restore-cart` | owner or `{ token }` | Re-add items of a cancelled online order |
| POST | `/orders/track` | – | `{ orderNumber, phone }` → limited status view (rate limited) |
| GET / POST | `/wishlist` | customer | List / `{ productId }` add |
| DELETE | `/wishlist/:productId` | customer | Remove |
| GET / PATCH | `/account/profile` | customer | `{ name, phone? }` |
| POST | `/account/password` | customer | `{ currentPassword, newPassword }` (signs out other sessions) |
| GET / POST | `/account/addresses` | customer | List / create |
| PATCH / DELETE | `/account/addresses/:id` | customer | Update / delete |

### `POST /checkout`

```json
{
  "idempotencyKey": "client-generated-random-16-80-chars",
  "contact": { "name": "Rahim Uddin", "phone": "01712345678", "email": "optional@example.com" },
  "address": { "addressLine": "House 12, Road 5", "area": "Dhanmondi", "division": "Dhaka", "district": "Dhaka", "postalCode": "1205" },
  "saveAddress": false,
  "paymentMethod": "cod",
  "couponCode": "WELCOME10",
  "note": "Call before delivery",
  "expectedTotal": 218000
}
```

Response `data`: `{ orderId, orderNumber, accessToken, reused, next: { type: "confirmation" } | { type: "redirect", url } }`.
Retrying with the same `idempotencyKey` returns the same order (`reused: true`). Errors: `CART_EMPTY`,
`STOCK_UNAVAILABLE` (`details.problems[]`), `PRICE_CHANGED` (`details.total`), `COUPON_INVALID`, `NO_DELIVERY_ZONE`,
`COD_LIMIT_EXCEEDED`, `PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_INIT_FAILED`, `UNAUTHENTICATED` (guest checkout disabled).

## Admin endpoints (`/api/v1/admin/...`, staff session required)

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/admin/auth/login` | staff/admin credentials (customers get `403 NOT_STAFF`) |
| GET | `/admin/dashboard?days=7\|30\|90` | `dashboard:view` |
| GET, POST | `/admin/products` (`?q&status&categoryId&page`) | `catalog:manage` |
| GET, PUT, DELETE | `/admin/products/:id` | `catalog:manage` |
| POST | `/admin/uploads` (multipart `file`, ≤ 8 MB) | `catalog:manage` |
| GET, POST · PUT, DELETE | `/admin/categories` · `/admin/categories/:id` | `catalog:manage` |
| GET, POST · PUT, DELETE | `/admin/collections` · `/admin/collections/:id` | `catalog:manage` |
| GET, POST · PUT, DELETE | `/admin/sizes` · `/admin/sizes/:id`, `/admin/colors` · `/admin/colors/:id` | `catalog:manage` |
| GET | `/admin/inventory` (`?q&filter=all\|low\|out&page`) | `inventory:manage` |
| POST | `/admin/inventory/adjust` `{ variantId, mode: delta\|set, value, reason, note }` | `inventory:manage` |
| GET | `/admin/inventory/:variantId/movements` | `inventory:manage` |
| GET | `/admin/orders` (`?q&status&payment&page`), `/admin/orders/:id` | `orders:manage` |
| POST | `/admin/orders/:id/status` `{ status, note?, courierName?, trackingNumber? }` | `orders:manage` |
| POST | `/admin/orders/:id/payment` `{ action: mark_paid\|mark_refunded, note? }` | `orders:manage` |
| PUT | `/admin/orders/:id/note` `{ adminNote }` | `orders:manage` |
| GET | `/admin/customers` (`?q&role&status&page`), `/admin/customers/:id` | `customers:view` |
| PATCH | `/admin/customers/:id` `{ status?, role? }` | `customers:manage` (admin) |
| GET, POST · PUT, DELETE | `/admin/coupons` · `/admin/coupons/:id` | `coupons:manage` (admin) |
| GET, POST · PUT, DELETE | `/admin/shipping-zones` · `/admin/shipping-zones/:id` | `shipping:manage` (admin) |
| GET, PUT | `/admin/settings/:key` (`store`, `checkout`, `policies`, `announcement`) | `settings:manage` (admin) |
| GET, DELETE | `/admin/demo-data` | `settings:manage` (admin) |

## Payment gateway & jobs

| Method | Path | Notes |
| --- | --- | --- |
| POST/GET | `/api/payments/sslcommerz/{success,fail,cancel}` | Browser return URLs; redirect to the order page |
| POST | `/api/payments/sslcommerz/ipn` | Server-to-server notification; responds `{ received: true }` |
| POST | `/api/cron/expire-payments` | `Authorization: Bearer $CRON_SECRET` |
| POST | `/api/cron/dispatch-events` | `Authorization: Bearer $CRON_SECRET` |

Gateway callbacks are cross-site by design and skip the CSRF check, but they are never trusted: an order is marked paid
only after the SSLCommerz Validation API confirms status, `tran_id`, amount and currency.

## Webhooks to the MKJ Ecosystem

`POST $ECOSYSTEM_WEBHOOK_URL` with body `{ id, type, aggregateId, occurredAt, source: "mkj-mart", data }` and headers
`X-MKJ-Event`, `X-MKJ-Timestamp`, `X-MKJ-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<body>")`. Deliveries are
ordered and retried (up to 10 attempts) by `npm run jobs:dispatch-events`.
