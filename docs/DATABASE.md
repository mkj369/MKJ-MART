# Database schema

PostgreSQL 14+, managed with Drizzle ORM. Source of truth: [`src/server/db/schema.ts`](../src/server/db/schema.ts);
generated SQL migrations: [`drizzle/`](../drizzle).

## Conventions

* **Primary keys**: UUID v4 (`gen_random_uuid()`), safe to expose and to share with other MKJ services.
* **Money**: every amount is an **integer in poisha** (1 BDT = 100 poisha). Columns: `price`, `compare_at_price`,
  `subtotal`, `discount_total`, `shipping_fee`, `total`, `unit_price`, `line_total`, `fee`, `amount`, coupon `value`
  (when fixed) and limits.
* **Time**: `timestamptz`; the UI renders Asia/Dhaka time.
* **Demo data**: `is_demo` on users, categories, collections, products, coupons and orders.
* **Snapshots**: orders copy customer, address, product name, SKU, variant label, image and unit price, so order
  history never changes when the catalogue does.
* **Integrity in the database**, not only in code: CHECK constraints (non-negative stock and prices,
  `compare_at_price > price`, `total = subtotal − discount + shipping`, `line_total = unit_price × quantity`,
  percentage coupons ≤ 100), unique constraints (emails, slugs, SKUs, order numbers, idempotency keys, one variant
  per size/colour per product, one default delivery zone) and foreign keys.

## Entity overview

```
users ─┬─< sessions            categories (self-referencing parent_id, 2 levels)
       ├─< addresses                │
       ├─< carts ─< cart_items >─ product_variants >─┬─ products >── categories
       ├─< wishlist_items >──────────────────────────┤      │
       └─< orders ─┬─< order_items                   │      ├─< product_images (optional colour)
                   ├─< order_events                  │      └─< collection_products >── collections
                   ├─< payment_transactions          ├── sizes
                   └─< coupon_redemptions >── coupons└── colors
product_variants ─< stock_movements (ledger; optional order_id, actor_id)
shipping_zones · settings (key/value JSON) · rate_limits · domain_events (outbox)
```

## Tables

### Identity
| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `email` (unique, lower-case), `password_hash` (scrypt), `name`, `phone`, `role` (`customer`/`staff`/`admin`), `status` (`active`/`blocked`), `last_login_at` | Staff and customers share one table; permissions derive from `role` |
| `sessions` | `id` = SHA-256 of the cookie token, `user_id`, `expires_at`, `user_agent`, `ip_address` | Raw tokens are never stored |
| `addresses` | `label`, `recipient_name`, `phone`, `address_line`, `area`, `district`, `division`, `postal_code`, `is_default` | Up to 10 per user |

### Catalogue
| Table | Key columns | Notes |
| --- | --- | --- |
| `categories` | `name`, `slug` (unique), `parent_id`, `sort_order`, `is_active` | Two-level tree (e.g. Men › Panjabi) |
| `collections` | `name`, `slug`, `image_url`, `is_featured`, `is_active` | Curated edits |
| `collection_products` | (`collection_id`, `product_id`) PK, `sort_order` | Many-to-many |
| `sizes`, `colors` | `label` / `name` + `hex` (validated `#RRGGBB`) | Shared option lists |
| `products` | `name`, `slug`, `description`, `material`, `care_instructions`, `category_id`, `price`, `compare_at_price`, `status` (`draft`/`active`/`archived`), `is_featured`, `tags[]`, `sold_count` | Only `active` products are visible or purchasable |
| `product_variants` | `sku` (unique), `size_id`, `color_id`, `stock` (CHECK ≥ 0), `is_active` | Unique (product, size, colour) with NULLS NOT DISTINCT |
| `product_images` | `url`, `alt`, `color_id`, `sort_order` | Colour-specific images drive the gallery |
| `stock_movements` | `variant_id`, `delta`, `stock_after`, `reason` (`initial`/`restock`/`adjustment`/`order`/`order_cancelled`/`return`/`correction`), `order_id`, `actor_id`, `note` | Append-only ledger; `SUM(delta)` always equals current stock |

### Shopping & configuration
| Table | Key columns | Notes |
| --- | --- | --- |
| `carts` | `user_id` (unique, nullable) | Guest carts are identified by an httpOnly cookie; merged on sign-in |
| `cart_items` | `cart_id`, `variant_id` (unique pair), `quantity` (> 0) | Prices are never stored in the cart |
| `wishlist_items` | (`user_id`, `product_id`) PK | Signed-in customers only |
| `shipping_zones` | `name`, `fee`, `estimated_days`, `districts[]`, `is_default`, `is_active` | A district belongs to at most one zone; the default zone covers the rest |
| `coupons` | `code` (unique, upper-case), `type` (`percentage`/`fixed`), `value`, `min_order_amount`, `max_discount_amount`, `starts_at`, `ends_at`, `usage_limit`, `usage_limit_per_customer`, `used_count` | Discounts apply to merchandise only |
| `settings` | `key` (`store`, `checkout`, `policies`, `announcement`), `value` JSON | Validated by Zod on write; defaults in code |

### Orders & payments
| Table | Key columns | Notes |
| --- | --- | --- |
| `orders` | `order_number` (`MKJ-YYMMDD-XXXXX`), `user_id` (null for guests), contact + address snapshot, `shipping_zone_name`, `status`, `payment_method` (`cod`/`sslcommerz`), `payment_status`, totals, `coupon_code`, `courier_name`, `tracking_number`, `idempotency_key` (unique), `access_token_hash`, `stock_released`, lifecycle timestamps, `payment_expires_at` | See state machine below |
| `order_items` | product/variant ids (nullable after deletion) + name, SKU, variant label, image, `unit_price`, `quantity`, `line_total` | Immutable snapshot |
| `order_events` | `status`, `payment_status`, `message`, `visible_to_customer`, `actor_id` | Customer timeline + internal audit trail |
| `payment_transactions` | `tran_id` (unique, sent to the gateway), `amount`, `status`, `gateway_session_key`, `val_id`, `bank_tran_id`, `card_type`, `failure_reason`, `gateway_response` (credentials redacted) | One per payment attempt |
| `coupon_redemptions` | `coupon_id`, `order_id` (unique), `user_id`, `phone`, `amount` | Per-customer limits match account **or** phone |

### Platform
| Table | Purpose |
| --- | --- |
| `rate_limits` | Fixed-window counters (`key`, `count`, `reset_at`) shared by all app instances |
| `domain_events` | Transactional outbox for MKJ Ecosystem webhooks (`type`, `aggregate_id`, `payload`, `attempts`, `dispatched_at`) |

## Order state machine

```
pending ──► confirmed ──► processing ──► shipped ──► delivered
   │            │              │            │            │
   └────────────┴──────────────┴─► cancelled └─► returned ◄┘
```

* Online (SSLCommerz) orders cannot move past `pending` until `payment_status = paid`; they can be cancelled.
* `cancelled` and `returned` restock items exactly once (`stock_released`) and write ledger entries; cancellation
  also releases the coupon redemption.
* COD orders become `paid` when delivered. Refunds are recorded (`refunded`) after money is returned outside the app.

Payment statuses: `unpaid` (COD), `pending` (awaiting gateway), `paid`, `failed`, `cancelled`, `refunded`.

## Checkout transaction (summary)

1. Short-circuit if the idempotency key already produced an order.
2. `SELECT … FOR UPDATE OF product_variants` for the cart lines (ordered by id to avoid deadlocks).
3. Re-check product/variant availability and stock; recompute subtotal from current prices.
4. Lock and evaluate the coupon; resolve the delivery zone; apply the free-delivery threshold.
5. Reject if the total differs from the customer's `expectedTotal`, or exceeds the COD limit.
6. Insert order + items; decrement stock with `WHERE stock >= qty`; write ledger, coupon redemption, timeline
   and outbox events; empty the cart; create the payment transaction for online payment.
7. After commit, create the SSLCommerz session; on failure cancel the order, release stock and restore the bag.

## Hardening additions (migration `0001_hardening`)

| Table / column | Purpose |
| --- | --- |
| `user_tokens` | Password-reset tokens: only the SHA-256 is stored, `expires_at`, single use (`used_at`). |
| `notifications` | Email/SMS outbox: template, recipient, payload, `secret_payload` (erased after delivery), `status` pending/sent/failed/skipped, attempts, `next_attempt_at`, provider message id, `last_error`. |
| `return_requests`, `return_request_items` | Return workflow (requested → approved → received → refunded, or rejected/cancelled) and the order items/quantities being returned. |
| `refunds` | Ledger of refunds paid outside the platform (amount, method, reference, actor), optionally linked to a return. |
| `support_requests` | Contact-form tickets (`SR-…`), status open/in_progress/resolved, internal notes. Requires an email or phone. |
| `job_runs` | Heartbeat per scheduled job (last start/success/failure, last result). |
| `orders.tracking_url` | Courier tracking link shown to customers and in shipping emails. |
| `orders.refunded_total` | Sum of recorded refunds; CHECK `0 ≤ refunded_total ≤ total`. |
| `payment_status` += `partially_refunded` | Set when recorded refunds are below the order total. |

All changes are additive; the migration was applied both on top of `0000_init` and from scratch on an empty
database.
