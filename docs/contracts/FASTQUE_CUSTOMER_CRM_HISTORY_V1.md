# FastQue Owner Customer CRM and Visit History API v1

Status: Implemented base history contract. The additive secure directory and per-service history are specified in `FASTQUE_CUSTOMER_CRM_DIRECTORY_V1.md`; neither contract is production release authorization.

## Scope

Requirement #5: salon-scoped owner customer search/detail and unified history for authenticated customer accounts. This API reads existing `Booking`, `QueueEntry`, invoice, and shop-recorded invoice-payment records. It creates no synthetic rows and does not merge accounts by name or phone.

## Authorization and privacy

- Requires an authenticated `SALON_OWNER` or `PLATFORM_ADMIN` session.
- Every operation re-checks that the actor may access the requested `salonId`.
- `customerId` is an existing authenticated user id. A guest queue entry with no `customerId` is never claimed through a name or phone match.
- Search may match account id, recorded phone/email, or names/service/staff snapshots only within visits already linked to that account at this salon. Search never links accounts.
- Responses use `Cache-Control: private, no-store`.

## Routes

Base: `/api/v1/dashboard/salons/:salonId/customers`

### `GET /` (legacy-compatible offset list)

List account-linked customers with summary and visit roll-up. Its numeric `nextCursor` behavior is preserved for existing clients.

Query: `offset` (integer, default 0), `limit` (1–50, default 20), and either `q` or legacy `search` (1–120 characters; not both). Existing offset pagination remains compatible. List-level `segment`, `sort`, and cursor pagination are not part of this slice and remain follow-up work.

### `GET /:customerId`

Read one account's salon-scoped customer summary, recorded contact fields, existing booking aggregates, and additive Live Queue visit counts. Existing booking-only summary fields keep their legacy meanings.

### `GET /:customerId/history`

Read a unified, stable, descending visit page over existing source records. Query:

```text
cursor?         opaque continuation cursor, scope/filter-bound
limit?          integer 1–50, default 20
source?         ONLINE_BOOKING | IN_SHOP_APPOINTMENT | LIVE_QUEUE
status?         PENDING_PAYMENT | CONFIRMED | WAITING | CALLED | IN_SERVICE |
                COMPLETED | CANCELLED | EXPIRED | NO_SHOW
from?, to?      inclusive YYYY-MM-DD dates in the salon's configured timezone
```

`from` must not be after `to`; the maximum closed date range is 366 calendar days. Cursor continuation is valid only for the same authenticated actor, salon, customer, and filters. The opaque cursor is HMAC-signed with a domain-separated key derived from the server access-token secret; tampering or cross-scope replay is rejected. If the signing secret is missing or too short, a page that needs a cursor fails closed with `503 CUSTOMER_HISTORY_CURSOR_UNAVAILABLE`. Ordering uses event instant descending and deterministic source/id tie-breakers.

Response shape:

```json
{
  "salonId": "uuid",
  "customerId": "uuid",
  "salonTimezone": "Asia/Kolkata",
  "items": [
    {
      "id": "source-record-id",
      "source": "ONLINE_BOOKING",
      "occurredAt": "ISO-8601",
      "createdAt": "ISO-8601",
      "status": "COMPLETED",
      "recordedName": null,
      "serviceNames": ["Haircut"],
      "staffName": null,
      "startedAt": null,
      "completedAt": null,
      "invoices": []
    }
  ],
  "nextCursor": null
}
```

Source mapping: `Booking.source = IN_SHOP` becomes `IN_SHOP_APPOINTMENT`; other booking sources are displayed as `ONLINE_BOOKING`; an authenticated standalone queue row (`bookingId = null`, non-null `customerId`) becomes `LIVE_QUEUE`. Booking-linked queue rows are represented through the booking and are not emitted as a second visit. Guest queue rows remain outside customer-account history.

Invoice amounts, discounts, and payments/refunds are serialized as decimal strings with the invoice currency. They describe FastQue shop-recorded invoice ledger events only; provider settlement, external refunds, and cash not recorded in this ledger are not inferred.

## Errors

- `400 INVALID_FILTER`: invalid query/date/cursor, cursor scope mismatch, or invalid pagination values.
- `403 SALON_ACCESS_DENIED`: actor is not authorized for the salon/customer CRM route.
- `404 BOOKING_NOT_FOUND`: no visits exist for that account at this salon.
- `422 SALON_TIMEZONE_REQUIRED`: the salon has no usable timezone for local-date filtering.
- `503 CUSTOMER_HISTORY_CURSOR_UNAVAILABLE`: secure cursor signing or verification cannot be performed because server signing configuration is unavailable.

No mutation is performed by these routes; idempotency keys are not applicable. There is no feature flag or external provider dependency.

## Explicit limitations / follow-up

- The User model has no canonical display-name field, so the API does not invent one from a guest label. The UI may show a factual per-visit recorded label and indicate that the account name is not on file.
- Customer account self-history remains served by the existing customer booking API; this owner CRM endpoint must not be reused as customer authorization.
- Owner list `segment`, `sort`, secure cursor pagination, actual recorded-collection/repeat metrics and per-service history are specified in `FASTQUE_CUSTOMER_CRM_DIRECTORY_V1.md`.
- Verified display-name persistence and guest-identity claim remain unimplemented. Guest identity claim requires a separately verified ownership flow; names and phone numbers alone are insufficient.
- Backend implementation completion SHA and exact-head disposable-PostgreSQL CI result are recorded in the linked implementation PR after publication. Runtime/production and physical-device certification remain separate.
