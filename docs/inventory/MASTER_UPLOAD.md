# Inventory master database + admin Excel/CSV upload

Extends the existing inventory (Global Product Master `global_products`, salon stock
`inventory_products`, immutable ledger `inventory_movements`). No parallel catalog was added.

| Spec concept | Where it lives |
| --- | --- |
| Common product catalog | `global_products` (+ `global_product_barcodes`, `global_product_images`) |
| GLOBAL vs SHOP products | `global_products.visibility` + `ownerSalonId` (DB check keeps them consistent) |
| `shop_inventory` | `inventory_products` (quantity, average cost, selling price, min stock = `reorderThreshold`) |
| `inventory_transactions` | `inventory_movements` (DB trigger: row lock, no negative stock). Spec types map onto ledger kinds: STOCK_IN = OPENING/PURCHASE/TRANSFER_IN, STOCK_OUT = WASTAGE/TRANSFER_OUT, SERVICE_CONSUMPTION = CONSUMPTION, ADJUSTMENT, RETURN, DAMAGE, EXPIRY (`INVENTORY_TRANSACTION_TYPES` in `packages/shared/src/inventory-upload.ts`) |
| `inventory_upload_jobs` / `inventory_upload_errors` | new tables of the same names |
| Owner → admin corrections | `catalog_change_requests` |

Migration: `apps/backend/prisma/migrations/20261118100000_inventory_master_upload` (additive only).

## Importing a file

Admin dashboard → Inventory → **Upload Inventory** → **Upload Product Database** (.xlsx or .csv,
≤ 5 MB, ≤ 5,000 rows). The server finds the header row (first 15 rows), maps columns flexibly
(`EAN`, `Barcode`, `Barcode Number`, `UPC`, `GTIN` → barcode; `Salon Name`, `Shop Name`, `Store` →
shop; `Product ID`/`SKU` → product code; …), validates every row and shows a preview. Nothing is
saved until **Confirm import**. Change any column's mapping in the preview; the file is re-checked.
Download the template from the same page.

Row rules:

- Identity = barcode (normalized GTIN, leading zeros kept) or, without a barcode, the product code.
  Names never overwrite an existing product; a different name is a warning.
- No shop → GLOBAL product (visible to every salon, stocked by none).
- Shop name / ID → that existing salon only. Unknown, ambiguous or mismatched shop → "needs review";
  shops are never created. New barcode + shop → SHOP-only product (unless `Visibility = global`);
  existing global barcode + shop → only that shop's inventory row is added.
- Optional `Opening Quantity` (+ `Cost Price`) on a shop row is recorded once as an OPENING ledger
  entry when the shop row is first created. Re-imports never change stock.
- Rows marked test/fake/sample in a status column (or the "test data" checkbox) are flagged
  `isTestData`; in production (`NODE_ENV=production`) they are held for review unless
  `INVENTORY_ALLOW_TEST_DATA_IMPORT=true`. A test row never attaches to a real product's barcode.
- Embedded barcode pictures are matched to their row and counted, never stored; the typed number is
  the source of truth and FastQue draws barcodes (EAN-13/EAN-8/UPC-A) from it. A row with only a
  picture is an error.

Re-uploading a file is safe (only missing products/shop rows are added). Upload History lists every
job; each has a formula-safe CSV row report.

## API (all under `/api/v1`)

Admin (view: PLATFORM_ADMIN, CO_FOUNDER, PLATFORM_VIEWER; change: PLATFORM_ADMIN, CO_FOUNDER):
`POST admin/inventory-uploads/preview` (multipart `file`, optional `mapping`, `sheetName`,
`sourceReference`, `sourceLicense`, `markAsTestData`) · `POST admin/inventory-uploads/:id/commit` ·
`POST admin/inventory-uploads/:id/cancel` · `GET admin/inventory-uploads` ·
`GET admin/inventory-uploads/:id` · `GET admin/inventory-uploads/:id/issues` ·
`GET admin/inventory-uploads/:id/errors.csv` · `GET admin/inventory-uploads/template.csv` ·
`GET admin/inventory-master/stats` · `GET admin/catalog-change-requests` ·
`PATCH admin/catalog-change-requests/:id` · `GET admin/inventory-catalog` gained
`visibility`, `salonId`, `category`, `missingBarcode`, `testData` filters.

Owner (salon from the URL, checked against the caller's owner role):
`GET dashboard/salons/:salonId/inventory/catalog/browse` ·
`POST dashboard/salons/:salonId/inventory/catalog/add` ·
`GET|POST dashboard/salons/:salonId/inventory/catalog/change-requests` ·
`GET dashboard/salons/:salonId/inventory/summary`.

## Tests

- `packages/shared/src/__tests__/inventory-upload.test.ts`
- `apps/web/components/admin/inventory/__tests__/inventory-upload.test.jsx`
- `apps/backend/test/inventory-upload.e2e-spec.ts` — the 10 acceptance scenarios; runs only against
  a disposable loopback database named `inventory_certification` or `owner_ops_chain`.
