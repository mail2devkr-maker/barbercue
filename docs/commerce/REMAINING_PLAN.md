# Plan for the remaining items (nothing here is built yet)

Branch is merged with upstream/master (`a1e982cd`); the backend typecheck passes. The full regression has NOT been
rerun since that merge, so the baseline in TEST_RESULTS.md must be taken again from the new master.

One additive migration, later than `20261125120000_private_files_object_storage`: new `commerce_*` tables only, flat
CHECKs, plus nullable `commerce_orders.promotions` JSON.

| Area | Decision |
| --- | --- |
| Reviews | one per delivered order item (customer or guest link), PENDING until staff publish, seller reply |
| Support | own `commerce_tickets` + messages (`internal` flag). `SupportTicket` is not reused: it needs a staff creator, and guests have none |
| Promotions | one table: BUY_X_GET_Y, BUNDLE, AREA (PIN rules). Pure function in shared; best first, a product is used by one only; coupon applies to the rest; below-cost confirmation |
| Product details | `commerce_listing_details`: ingredients, usage, benefits, warnings, origin, manufacturer, variant group |
| Banners, saved bag, history | banners; signed-in bag sync (also gives abandoned bags); recommendations from own past orders; anonymous daily counters for conversion |
| Return policies | per category; the stricter of category and product applies, snapshotted on the order item |
| Files | return photos and delivery proof in `PrivateObjectStorageService`, checked with `detectImageMimeType` |
| Stock import | `readSpreadsheet`; preview, then apply in one transaction; keyed by file hash and row |
| Audits | blind count, snapshot per batch, approved by another person, difference posted through the ledger |
| COD settlement import | preview and match by order/tracking number; apply through `recordCod` with per-line keys; never signs off |
| Warehouse permissions | `commerce_warehouse_grants`; no rows = all warehouses; enforced on stock, receive, transfer, audits |
| Procurement | purchase requests, quotations, convert to draft PO, supplier returns (ledger + balance credit), PO print |
| Shipping | pickups, proof photo, labels and packing slips as print pages |
| Orders | bulk transition with a result per order, XLSX export (fflate), print-ready invoice |
| Forecast and assistants | weekly demand average with range and minimum history; price, procurement, fraud and reply suggestions; a person always decides |
| Alerts | daily outbox notice to warehouse staff for low stock and near expiry |
| Reports | repeat and cohort retention, lifetime value, per warehouse, conversion, abandoned bags |

Then: e2e for each, browser check with saved screenshots, load measurement, security and accessibility pass, full
regression, README matrix. Mobile apps have no shop screens; out of scope.
