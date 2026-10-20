# FastQue Offers, Promotions and Daily Deals — API V1

Status: backend implementation candidate; no live promotion or payment provider is activated.

This contract covers Issue #221 requirements **#11 Offers**, **#16 Promotions**, and **#24 Daily
Deals**. All routes use `/api/v1`. The backend/shared code is the source of truth for request schemas
and response DTOs (`packages/shared/src/offers.ts`). It does not create invoices, collect payments,
call SMS/email/push providers, or imply a payment has been made.

## Authorization and isolation

Owner routes are scoped to `dashboard/salons/:salonId/...`. The authenticated actor must have
owner access to that exact salon (`SALON_OWNER`; platform administrators follow the existing
salon-access policy). Every offer/service/redemption query includes the salon scope. Public
discovery returns only currently valid offers belonging to active salons and does not return owner
redemption counts or owner-only salon fields. It is `no-store` and contains per-service
illustrative prices; the final amount is recalculated during booking creation.

No offer is visible to a customer unless it is `ACTIVE`, inside its half-open validity interval
`[validFrom, validTo)`, and the salon is active. An offer may target all accounts, accounts without
a completed visit (`NEW`), accounts with a completed visit (`REPEAT`), or accounts whose latest
completed visit is at least `inactiveDays` old (`INACTIVE`). Only authenticated online bookings
(`APP`/`WEB`) may redeem. The eligibility decision is made again server-side when booking is
created; discovery is not authorization.

## Owner endpoints

| Method and route                                                | Purpose                                                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET dashboard/salons/:salonId/offers?limit&cursor&kind&status` | Stable cursor-paginated owner list. Status may be `DRAFT`, `ACTIVE`, `PAUSED`, or computed `EXPIRED`. |
| `GET dashboard/salons/:salonId/offers/:offerId`                 | Get one salon-owned offer.                                                                            |
| `POST dashboard/salons/:salonId/offers`                         | Create a `DRAFT`; requires `Idempotency-Key`.                                                         |
| `PATCH dashboard/salons/:salonId/offers/:offerId`               | Edit a draft or paused offer; active offers must first be paused. Requires `Idempotency-Key`.         |
| `POST dashboard/salons/:salonId/offers/preview`                 | Preview proposed draft pricing without saving it; empty `serviceIds` previews all active services (bounded to 100). |
| `POST dashboard/salons/:salonId/offers/:offerId/preview`        | Preview saved campaign pricing for selected service IDs.                                              |
| `POST dashboard/salons/:salonId/offers/:offerId/publish`        | Validate active services/date range and publish; requires `Idempotency-Key`.                          |
| `POST dashboard/salons/:salonId/offers/:offerId/pause`          | Stop future redemption; existing booking snapshots remain unchanged. Requires `Idempotency-Key`.      |
| `GET dashboard/salons/:salonId/offers/:offerId/stats`           | Redemption, unique-customer, completed/cancelled booking and recorded-discount aggregates.            |

Create/update use `createOfferSchema` / `updateOfferSchema`. Core fields are `kind` (`OFFER`,
`PROMOTION`, `DAILY_DEAL`), title, optional description, `discountType` (`PERCENT`, `FLAT`),
`discountValue`, audience, optional `inactiveDays`, UTC ISO `validFrom`/`validTo`, optional global
redemption cap, per-customer cap, and optional unique `serviceIds`. Empty `serviceIds` means all
currently active salon services. Percent discounts are whole numbers from 1–100; flat discounts
are positive major-currency units. Times are UTC instants; the owner UI should display them in the
salon timezone.

Preview returns `{ offerId, currency, eligibleByRule, eligibilityRule, lines, subtotal, discount,
finalTotal }`. Each line contains `serviceId`, `serviceName`, `basePrice`, `discount`, `finalPrice`,
and `currency`. Owner draft preview has `offerId: null` and `eligibleByRule: null`; it is not a
customer eligibility attestation.

## Public discovery and booking

`GET offers?countryCode=<ISO-3166-1-alpha-2>&citySlug=<canonical-city-slug>&service=<service-uuid>&limit&cursor`
returns `{ items, nextCursor }`. The legacy `city=<city-slug>` filter remains supported. Each item
has the public offer fields, `{ id, name, slug, city, countryCode, citySlug }` salon summary, audience metadata
`{ audience, accountRequired: true }`, and per-active-service price estimates. Restricted offers
are only discoverable for linked active services. Unrestricted offers require that the requested
service belongs to the salon when a service filter is supplied.

`GET offers/:offerId` returns one currently active, in-date offer by ID using the same public DTO
and active-salon/service checks as list discovery. Draft, paused, expired, hidden-salon, and
service-less offers are not exposed.

The existing authenticated `POST bookings` accepts optional `offerId`. If omitted, existing
booking pricing remains unchanged. If present, the backend validates audience/source/date/service
eligibility, redemption limits, and current service prices; the selected offer replaces rather than
stacks with the existing salon-wide online booking discount. It records the offer ID/title and
discount amount as a booking-time snapshot and writes the unique redemption plus audit event in the
same booking transaction. No provider/payment operation occurs. A replay of the same booking
idempotency key returns the original booking/redemption rather than consuming another slot.

Redemption caps are reserved at accepted booking creation. Cancellation does not erase the
redemption or refund its cap in V1; stats distinguish cancelled bookings, while the financial
discount remains a booking snapshot. This conservative policy prevents repeated cancel/rebook cap
abuse and does not represent a payment or refund.

## Errors and audit

Errors use the standard `{ error: { code, message, details } }` format. Stable codes include
`OFFER_NOT_FOUND`, `OFFER_INVALID`, `OFFER_EXPIRED`, `OFFER_NOT_ELIGIBLE`,
`OFFER_REDEMPTION_LIMIT`, `OFFER_SERVICE_MISMATCH`, `OFFER_NOT_PUBLISHABLE`,
`OFFER_MUST_PAUSE_TO_EDIT`, and `OFFER_CHANGED_RETRY`. Cross-salon access follows existing
salon-access denial behavior. A concurrent limit/price/configuration change fails closed; the
customer must refresh and retry rather than receiving a stale discounted booking.

Creation, edits, publish, pause, and redemption are audited in the same transaction as the state
change. The database enforces salon-scoped offer/service/booking references, positive discount and
limit constraints, and at most one redemption per salon booking. Existing bookings and their
service/payment history are not rewritten. The migration is additive and must be rehearsed on
disposable populated PostgreSQL before any production migration; none is authorized by this PR.

## Feature and provider state

The owner capabilities endpoint reports `offers: ENABLED` for this provider-free backend module.
AI, payment, SMS, and other provider-backed features remain governed by their existing configuration
and are not activated by these routes. A future UI must keep publish, pause, preview, eligibility,
expiry and redemption counts distinct and must not describe a displayed offer as a recorded payment.

## Implementation status

This contract describes the branch implementation only. Frontend/mobile clients and production
runtime are separate integration gates. Backend completion SHA and exact-head CI result will be
recorded in the Draft PR after publication.
