# Owner Revenue Report API v1

This contract covers the first backend reporting slice for roadmap requirements 1, 2, 4, and 17. It is additive and read-only; it does not change the invoice/payment schema or mutate salon data.

## Routes

`GET /api/v1/dashboard/salons/:salonId/revenue/report`

`GET /api/v1/dashboard/salons/:salonId/revenue/report.csv`

Both routes require an authenticated `SALON_OWNER` or `PLATFORM_ADMIN` session and re-check access to the exact salon. Queries are salon-scoped and read under a repeatable-read transaction.

Query parameters:

```text
from=YYYY-MM-DD       required, inclusive salon-local date
to=YYYY-MM-DD         required, inclusive salon-local date
groupBy=day|week|month optional; defaults to day
source=APP|WEB|WALK_IN|IN_SHOP optional; only existing trusted source values
```

Date ranges are limited to 366 calendar days. Week buckets begin Monday. All date boundaries and payment-event buckets use the salon's configured IANA timezone; ranges without a resolvable timezone fail closed.

## Financial semantics

- Completed visit estimates are separate from cash. Online bookings use immutable `BookingService` price snapshots. Standalone completed Live Queue visits without a historical price snapshot use the current service list price and remain explicitly identified as estimates.
- `grossServiceValue` is the pre-discount value of completed services; it matches the estimate basis when a historical queue price snapshot is unavailable. It is not collected revenue.
- Invoice amounts and discounts come from `ISSUED` invoices only; `VOID` invoices are excluded. Invoice amount is the issued total including invoice tax.
- `recordedCollections` and `refunds` come only from the append-only `InvoicePayment` ledger, including ledger events attached to an invoice later marked `VOID`; voiding an invoice never erases recorded cash or refund history. Collections and refunds are bucketed by `recordedAt`; issued invoice totals, discounts, and visits are bucketed by service date. Those two event clocks are not conflated.
- Service-level portions of invoice amounts and cash events are allocated proportionally by the invoice line total. The invoice/payment records themselves remain authoritative and invoice-level; the response names this allocation explicitly and never presents it as a line-specific payment instruction.
- Existing provider `Payment`/`Refund` rows are not added to the invoice ledger totals. They have no invoice-payment reconciliation key; adding them would risk double counting. A future reconciliation feature must establish that linkage and disclose provider-confirmed cash separately.
- Customer IDs are used only where the source record has an authenticated customer relation. Guest visits remain separate and are never merged by name or phone. Customer phone/email are not exported.
- CSV is Excel-compatible and formula-safe. The CSV export calls the same authorization, validated filters, and repeatable-read report query as JSON.

## Response shape

The JSON response includes salon ID, currency, timezone, inclusive date range, selected grouping/source, period rows, totals, service/staff/customer breakdowns, and `dataSemantics` documenting estimate and cash allocation sources. Money values are decimal currency numbers rounded to two places. Empty periods are represented with zero values; absent previous-period comparisons are not fabricated.

The first version supports only existing source columns. Facebook, Instagram, ChatGPT and other campaign attribution must not be inferred from client input; it needs a separate verified/referral evidence design and persisted provenance before those filters can be certified.

## Error and compatibility behavior

- `400`: invalid local date, reversed date range, range greater than 366 days, invalid grouping or unsupported existing-source filter.
- `403`: caller is not authorized for the requested salon.
- `404`: salon does not exist.
- `413`: a source family exceeds the 25,000-row processing cap; narrow the date range.
- `422`: the salon timezone is unavailable/invalid or invoices in the requested range contain mixed/inconsistent currencies.

No existing endpoint or persisted enum is changed. No database migration is required.
