# FastQue Marketplace

Public beauty marketplace at `/shop`, built on the inventory master (no second catalog, no second
stock table).

| Concept | Where |
| --- | --- |
| Master product (name, brand, barcode, variant, category, images) | `global_products` (+ barcodes, images) |
| Salon stock (quantity, cost, min stock) | `inventory_products` — the only source of quantities |
| Marketplace listing (seller, price, offer price, per-order limit, pickup, approval status) | `shop_listings` (one per salon inventory row) |
| Orders + line snapshots + status history | `shop_orders`, `shop_order_items`, `shop_order_events` |
| Reservations | open orders' items (PLACED until `acceptBy`, ACCEPTED/PREPARING/READY) — computed, not stored twice |
| Sale leaving stock | `inventory_movements` ADJUSTMENT `-qty`, reason "Sold — Marketplace order FQS-…", on COMPLETED |
| Wishlist | `shop_wishlist_items` (signed-in) / device storage (guests) |

Migration: `apps/backend/prisma/migrations/20261118110000_salon_marketplace` (additive).

## Rules

- A master product is never "for sale" by itself: only APPROVED listings of ACTIVE salons with stock show prices.
- Salon owners list from their own inventory (catalog-linked, counted in pieces/packs/boxes); FastQue admins approve.
- One salon per order (the bag says so and offers to start a new bag). Pickup only; pay at the salon.
  Online payment and delivery are not switched on — the platform never marks an order paid by itself;
  the seller confirms payment at the salon when marking it collected.
- Checkout locks the salon's stock rows, re-prices from the server, refuses if the shopper's total
  differs, and is idempotent (`Idempotency-Key`). Concurrent checkouts cannot oversell.
- Status changes follow `SHOP_ORDER_TRANSITIONS` (packages/shared/src/shop.ts) per actor; a PLACED order
  expires after 24 h (cron every 10 min) and releases its stock; cancelling releases stock.
- Guests get a private order link (`/shop/orders/FQS-…?t=…`); only a hash of the secret is stored.
- Test-data products (e.g. the 100 sample products) show a "Sample product" label, are `noindex`,
  never appear in the sitemap or structured data, and are hidden in production unless `SHOP_SHOW_TEST_DATA=true`.

## Settings (backend env)

- `SHOP_COMMISSION_PERCENT` (default 0, max 50) — used in seller/admin analytics.
- `SHOP_ORDER_TOKEN_SECRET` (falls back to `JWT_ACCESS_SECRET`) — signs guest order links.
- `SHOP_SHOW_TEST_DATA=true` — show test products in production (default off).

## Pages

Public: `/shop`, `/shop/browse` (search/filters/sort, all in the URL), `/shop/p/:id`, `/shop/bag`,
`/shop/checkout`, `/shop/orders`, `/shop/orders/:number`, `/shop/wishlist`.
Owner: `/dashboard/salons/:id/sell` (My products · Orders · Sales). Admin: `/dashboard/admin/marketplace`.
Customer dashboard: `/account/shop`. Entry buttons: landing hero + closing CTA, owner sidebar
("Sell on FastQue", "✨ Marketplace"), customer sidebar ("Marketplace").

## Not built yet

Online payment (Razorpay adapter), delivery, promo codes/bundles/first-order offers, reviews and
ratings, salon-specific product photos, refunds/disputes workflow (pay-at-salon orders are never
charged online), PIN-code location (cities have no coordinates; city filter + device location are used).

## Tests

`apps/backend/test/shop.e2e-spec.ts` (disposable DB), `apps/web/components/shop/__tests__/shop.test.jsx`.
