# FastQue Customer CRM Directory API v1

Status: implemented in a Draft backend/shared-contract milestone stacked on PR #264. This document is an API contract, not production release authorization.

## Authorization and data rules

- All routes require an authenticated `SALON_OWNER` or `PLATFORM_ADMIN` request and re-check access to the requested salon through `SalonAccessService`.
- Responses are `Cache-Control: private, no-store`.
- Customer accounts are derived only from existing account-linked bookings and standalone queue visits. Guest rows with `customerId = null` are never merged by name or phone.
- `displayName` is always `null` and `displayNameSource` is `NOT_ON_FILE` until FastQue has a customer-controlled canonical name field. A visit contact label is not an account name.
- `recordedCollections` and `recordedRefunds` are the immutable shop-recorded `InvoicePayment` `PAYMENT` and `REFUND` sums for invoices linked by the booking or standalone authenticated queue source. `totalSpent = recordedCollections - recordedRefunds`. Provider settlement, unrecorded cash, service-price estimates and guest identity are not inferred. Invoice/payment rows are scoped to the same salon and actual source visit.
- Repeat metrics count completed bookings plus completed standalone authenticated Live Queue visits. Booking-linked queue rows are excluded from the queue side to prevent duplicate visits.

## Legacy list remains unchanged

`GET /api/v1/dashboard/salons/:salonId/customers` continues to accept its existing `offset`, `limit`, `q`/`search` contract and returns the legacy numeric `nextCursor`. Existing clients must not pass that offset token to the new routes.

## Secure directory

`GET /api/v1/dashboard/salons/:salonId/customers/directory`

Query:

```text
cursor?          opaque continuation cursor
limit?           integer 1–50, default 20
q?               1–120 chars; account id, recorded phone/email, or a visit-local name/service label
segment?         new | repeat | frequent
sort?            lastVisit | totalSpent | visits; default lastVisit
minVisits?       integer 0–50000, default 0; completed visits
```

Sort is server-side descending with deterministic `customerId ASC` ties; missing last-visit dates sort last. Segment thresholds use completed visits at this salon only: `new` = 1, `repeat` = 2–4, `frequent` = 5+, and customers with no completed visits have no segment. Search on a visit label is only a filter over rows already linked to that account; it never establishes identity.

`nextCursor` is HMAC-signed using a purpose-separated key derived from `JWT_ACCESS_SECRET`, and binds actor, salon, normalized search/filter/sort values and the last sort key. Tampered, stale-scope, cross-actor or cross-salon cursors return `400 INVALID_FILTER`. If the signing secret is absent/too short, pagination fails closed with `503 CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE`.

Response:

```json
{
  "salonId": "uuid",
  "currency": "INR",
  "items": [
    {
      "customerId": "uuid",
      "displayName": null,
      "displayNameSource": "NOT_ON_FILE",
      "phone": null,
      "email": null,
      "totalBookings": 0,
      "completedCount": 0,
      "cancelledCount": 0,
      "noShowCount": 0,
      "liveQueueVisitCount": 0,
      "completedLiveQueueVisitCount": 0,
      "totalVisitCount": 0,
      "completedVisitCount": 0,
      "repeatVisitCount": 0,
      "segment": null,
      "recordedCollections": 0,
      "recordedRefunds": 0,
      "totalSpent": 0
    }
  ],
  "nextCursor": null
}
```

All money fields are salon-currency amounts with two-decimal precision. `totalSpent` may be negative only if the existing recorded refund ledger itself nets below zero; the API never fabricates a balancing payment.

## Per-customer completed service history

`GET /api/v1/dashboard/salons/:salonId/customers/:customerId/services?cursor=&limit=20`

Returns one row per completed booking service or completed service session from a standalone authenticated Live Queue visit. Booking-linked queue entries are represented only through the booking. Results use a stable descending event-time keyset order with source/visit/service tie-breakers; the signed cursor binds actor, salon and customer. An unknown customer with no visits receives `404 BOOKING_NOT_FOUND`; a known account without completed services receives an empty page.

Each row includes source-qualified `id`, `visitId`, nullable `bookingId`, source, service ID/name, staff name when recorded, service date, actual completion timestamp when available, and `amount`. `amount` is the line total from exactly one matching `ISSUED` invoice; it is `null` when no unambiguous matching invoice line exists and `amountKind` is `INVOICED` or `null`. An invoice line is billed value, not proof of collection; actual recorded collections are exposed separately on the directory row.

## Compatibility and limitations

- No schema/migration or write route is added. No customer account or payment is created or modified.
- Existing booking-only summary fields and the legacy offset API are unchanged.
- Verified customer display-name persistence remains a separate product/data requirement; this API will not infer a name from phone, email, or a visit snapshot.
- Owner UI integration remains owned by the frontend agent. This milestone changes backend/shared/docs only.
