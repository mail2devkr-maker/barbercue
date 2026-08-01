# BarberCue — API Design

Status: **V1 decisions finalized.** Backend: NestJS, REST + one WebSocket namespace. Endpoint groups and contracts at implementation-starting depth; full OpenAPI spec generates from NestJS decorators once code exists.

## Conventions

- Base path `/api/v1/...`.
- Auth: `Authorization: Bearer <accessToken>`. Web also uses an httpOnly refresh cookie.
- Every endpoint that creates or changes money/queue/booking state accepts an `Idempotency-Key` header (client UUID v4), checked against the `IdempotencyKey` table before executing.
- Errors: `{ error: { code, message, details? } }`; `code` is the stable machine-readable field clients branch on.
- Pagination: cursor-based for unbounded lists.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/request` | `{ phone }` — customer-only entry point, rate-limited |
| POST | `/auth/otp/verify` | `{ phone, code }` → `{ user, tokens }`; creates `User`+`UserRole(CUSTOMER)` on first verify. Customers are never asked for a password, at signup or ever. |
| POST | `/auth/staff/login` | `{ email, password }` — staff/owner. Response includes `twoFactorRequired: boolean` (false in V1 for staff/owner, reserved field so a future TOTP step slots in without a contract change) |
| POST | `/auth/staff/2fa/verify` | **reserved, not active in V1** — `{ email, totpCode }`, completes login when 2FA is enabled for that account |
| POST | `/auth/admin/login` | `{ email, password, totpCode }` — admin, 2FA mandatory in V1. `totpCode` omitted → `401 TOTP_REQUIRED`; no TOTP secret provisioned → `403 TOTP_SETUP_REQUIRED` |
| POST | `/auth/refresh` | rotates refresh token; reads it from the request body (mobile) or the httpOnly cookie (web), body taking precedence |
| POST | `/auth/logout` | revokes the presented refresh token only (single device/session) |
| POST | `/auth/logout-all` | protected — revokes every refresh token for the caller (all devices/sessions) |
| GET | `/auth/sessions` | protected — lists the caller's active (non-revoked, unexpired) sessions: `{ id, deviceInfo, createdAt, expiresAt, current }[]`. Implements CUSTOMER's "Session Management" requirement (works for any authenticated role, not customer-only). |
| DELETE | `/auth/sessions/:id` | protected — revokes one specific session by id (must belong to the caller); the "sign out this device" action |
| POST | `/auth/forgot-password` | `{ email }` — staff/owner/admin only (customers have no password). Always responds identically regardless of whether the email exists, to avoid account enumeration. Outside `NODE_ENV=production`, the response includes `devResetUrl` since no real email provider is connected yet (see PAYMENTS.md-style external-dependency pattern in [ARCHITECTURE.md](ARCHITECTURE.md) — the `EmailSender` abstraction is real, only the transport is a dev stand-in). |
| POST | `/auth/reset-password` | `{ token, newPassword }` — consumes a one-time reset token (15 min TTL) and revokes all of that user's existing sessions |
| GET | `/auth/me` | protected — returns `{ id, roles, phone, email }` for the caller |

## Discovery (public, unauthenticated, SEO-facing)

| Method | Path | Notes |
|---|---|---|
| GET | `/cities` | only cities with at least one `ACTIVE` salon |
| GET | `/cities/:citySlug` | added during Phase 3A implementation — single city lookup, backs city-page metadata/breadcrumbs |
| GET | `/cities/:citySlug/localities` | |
| GET | `/cities/:citySlug/localities/:localitySlug` | |
| GET | `/salons?city=&locality=&service=&q=` | search/list, cursor-paginated |
| GET | `/salons/:citySlug/:salonSlug` | services, prices, hours, photos, rating summary, embeds the 10 most recent reviews (see note below) |
| GET | `/salons/:salonId/queue/status` | Implemented in Phase 3C (path corrected from the originally-sketched `queue-status` to a 3-segment shape — see Queue section below for why). Public, no auth, no PII: `{ salonId, waitingCount, estimatedWaitMinutes }`. |
| GET | `/salons/:salonId/reviews` | **deferred past Phase 3A** — standalone paginated reviews; Phase 3A's salon profile response embeds the 10 most recent reviews directly instead, which is enough for the page UI and JSON-LD `aggregateRating` |

## Booking (customer, authenticated)

Implemented in Phase 3B. The three `GET /salons/:salonId/booking/...` routes below live under an
extra literal `booking` path segment — **not** the bare `/salons/:salonId/...` shape originally
sketched here. `SalonsController`'s public discovery route (`GET /salons/:citySlug/:salonSlug`) is
also a two-dynamic-segment pattern under the same `/salons` prefix; a request like
`/salons/{uuid}/staff` would structurally match both patterns, and which one wins would depend on
fragile controller-registration order. The extra segment makes the two shapes non-overlapping
regardless of order — same fix philosophy as the `/areas/` locality route in Phase 3A.

| Method | Path | Notes |
|---|---|---|
| GET | `/salons/:salonId/booking/staff?serviceId=` | qualified-staff list for the "choose a barber" step (`ACTIVE` staff, StaffService rule below); "Any Staff" is a client-side option, never returned here |
| GET | `/salons/:salonId/booking/availability?serviceId=&date=&staffId=` | applies the service-level capacity algorithm in [DATABASE.md](DATABASE.md#booking-capacity-model-resolved--service-level-not-salon-wide). `staffId` is optional and, per the soft-staff-preference decision below, only validates that staff's qualification/active status — it never changes which slots come back |
| GET | `/salons/:salonId/booking/cancellation-policy` | the effective policy (salon-specific row, else the platform-default row) — lets clients render an accurate cancellation-charge preview via `packages/shared`'s `computeCancellationCharge` before the customer ever creates a booking |
| POST | `/bookings` | Idempotency-Key required. `{ salonId, serviceId, slotStart, preferredStaffId? }`. `preferredStaffId` is a soft preference only (see `DATABASE.md`'s Booking section) — it never affects capacity. Response status is `CONFIRMED` or `PENDING_PAYMENT` depending on the salon's `SalonPaymentPolicy` — client branches on the returned status, never assumes one or the other. Rejected with `OUTSTANDING_BALANCE` if the customer has a blocking `CustomerLedgerEntry` at that salon. |
| GET | `/bookings/mine` | cursor-paginated |
| GET | `/bookings/:id` | 404s (not 403) if the booking doesn't belong to the caller |
| POST | `/bookings/:id/check-in` | Implemented in Phase 3C. Idempotency-Key required, no body. Allowed from 15 minutes before `slotStart` onward (`EARLY_CHECKIN_WINDOW_MINUTES`, no upper bound — the automatic no-show sweep that would otherwise cap lateness isn't built). Only a `CONFIRMED` booking with no existing `QueueEntry` can check in (`409 ALREADY_CHECKED_IN` on repeat); creates `QueueEntry(source=APPOINTMENT)` linked to the booking. Lives in a separate `BookingCheckInController` (not `BookingsController`) purely to avoid `BookingsModule` importing `QueueModule` while `QueueModule` already imports `BookingsModule` for `AvailabilityService` reuse — same URL prefix, different controller, which Nest allows. |
| POST | `/bookings/:id/cancel` | Idempotency-Key required, no body. Runs the cancellation flow in [STATE_MACHINES.md](STATE_MACHINES.md#cancellation-flow-resolved); response includes `chargeAmount` and `ledgerEntryCreated`. Only the reachable branch is implemented in Phase 3B — no `Payment` can exist yet (Payments module not built), so a charge always becomes a `CustomerLedgerEntry(OUTSTANDING)`, never a refund. |

**Idempotency-Key enforcement**: `POST /bookings` and `POST /bookings/:id/cancel` are the first
endpoints to actually implement the `IdempotencyKey` table (defined since Phase 1, unused until
now) — see `apps/backend/src/common/interceptors/idempotency.interceptor.ts`. A retried
request with the same key+body replays the cached response verbatim; the same key with a
different body is rejected (`IDEMPOTENCY_KEY_REUSED`); a concurrent duplicate still in flight is
rejected (`REQUEST_IN_PROGRESS`).

## Queue (customer view)

Implemented in Phase 3C. `SalonQueueController` is mounted at `/salons/:salonId/queue` — a
3-segment shape deliberately, not a bare `/salons/:salonId/queue-status`, for the same
route-collision reason the booking endpoints above use an extra `booking` segment (`SalonsController`'s
`GET /salons/:citySlug/:salonSlug` is also a two-dynamic-segment pattern under the same prefix).

| Method | Path | Notes |
|---|---|---|
| GET | `/queue-entries/mine/active` | current active token (`WAITING`/`CALLED`/`IN_SERVICE`), or an empty body if none. Includes `position` (1-based rank among `WAITING` entries, `null` once past `WAITING`) and `estimatedWaitMinutes`. |
| POST | `/salons/:salonId/queue/join` | Idempotency-Key required. Walk-in only — creates `QueueEntry(source=WALK_IN, bookingId=null)` immediately. `{ serviceId }` optional. `409 ALREADY_IN_QUEUE` if the customer already holds an active token anywhere (one at a time, across salons). |

A customer can only ever hold one active `QueueEntry` at a time (`ALREADY_IN_QUEUE`/`ALREADY_CHECKED_IN`),
whether from a walk-in join or an appointment check-in — both paths share the same
`assertNotAlreadyInQueue` check in `queue.service.ts`.

## Customer account

| Method | Path | Notes |
|---|---|---|
| GET | `/customers/me/ledger` | outstanding/settled `CustomerLedgerEntry` rows — surfaces exactly what [PAYMENTS.md](PAYMENTS.md#cancellation-charge-collection-resolved--this-was-the-key-open-question) requires exposing to the customer |

## Queue & chair/staff operations (staff/owner dashboard, salon-scoped auth)

The queue rows below are implemented in Phase 3C (`DashboardQueueController`). Salon-scoped
authorization here is checked against `UserRole` (`SalonAccessService.assertAccess`), **not**
`SalonStaff` — an owner has authority over a salon but no roster row (only barbers/managers
assignable to serve customers get a `SalonStaff` row). Staff/chair roster CRUD, hours,
payment-policy, cancellation-policy, and photos (the remaining rows below) are explicitly
**deferred to a salon-management phase** — not requested by Phase 3C's scope and not needed to
exercise the queue engine against the already-seeded roster.

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/salons/:salonId/queue` | Full live queue (`WAITING`/`CALLED`/`IN_SERVICE` entries) plus the salon's **full** staff roster (both `ACTIVE` and `INACTIVE`, so an off-duty staff member can still see themselves and clock back in) and its `ACTIVE` chairs — embedded read-only so the assign UI and clock-in/out toggle both work without the separate CRUD endpoints below. Also pushed over WS (`queue.updated`). |
| POST | `/dashboard/queue-entries/:id/call` | `WAITING`→`CALLED`. `409 INVALID_QUEUE_TRANSITION` if the entry already moved (lost a race with another staff action). |
| POST | `/dashboard/queue-entries/:id/assign` | Idempotency-Key required. `{ staffId, chairId, serviceId? }` (`serviceId` required only if the entry itself has none, e.g. an unspecified walk-in) → creates `ServiceSession`, entry → `IN_SERVICE`. `409 CHAIR_ALREADY_OCCUPIED`/`STAFF_ALREADY_OCCUPIED` on the partial-unique-index conflict (the transaction rolls back fully, so the entry reverts to its prior status for a retry with a different staff/chair). |
| POST | `/dashboard/service-sessions/:id/complete` | ends session, `QueueEntry` → `COMPLETED`; if the entry traces back to a `Booking` (appointment check-in), that `Booking` → `COMPLETED` too — the only place a `Booking` ever reaches that state. |
| POST | `/dashboard/queue-entries/:id/no-show` | manual trigger only in V1 (only a `CALLED` entry can be marked); an automatic sweep job would share this same code path but isn't built |
| POST | `/dashboard/queue-entries/:id/cancel` | staff-initiated; cancelling an `IN_SERVICE` entry cascades to cancel its `ACTIVE` `ServiceSession` too |
| PATCH | `/dashboard/staff/:id/status` | `{ status: 'ACTIVE' \| 'INACTIVE' }` — a deliberate V1 simplification of the three-word "clock-in/break/clock-out" label: the existing `StaffMemberStatus` enum only has these two values, so "clock-in"→`ACTIVE`, "break" and "clock-out" both→`INACTIVE` (indistinguishable at the data layer today). An owner may update any staff at their salon; a `SALON_STAFF` may only update their own row (`403 NOT_YOUR_STAFF_PROFILE` otherwise). Affects ETA + assignability, not queue-entry state. |
| POST/PATCH | `/dashboard/staff`, `/dashboard/staff/:id` | **deferred** — owner-only staff roster CRUD |
| POST/PATCH | `/dashboard/chairs`, `/dashboard/chairs/:id` | **deferred** — owner-only chair roster CRUD |
| POST/PATCH | `/dashboard/staff/:id/services` | **deferred** — owner-only — manages `StaffService` rows for capacity qualification |
| PUT | `/dashboard/salons/:salonId/hours` | **deferred** — owner-only, triggers ISR revalidation webhook to `apps/web` |
| PUT | `/dashboard/salons/:salonId/payment-policy` | **deferred** — owner-only — sets `SalonPaymentPolicy` |
| PUT | `/dashboard/salons/:salonId/cancellation-policy` | **deferred** — owner-only — sets the salon's `CancellationPolicy` row (falls back to platform default if never set) |
| POST | `/dashboard/salons/:salonId/photos` | **deferred** — owner-only, signed upload URL |
| GET | `/dashboard/customers/:customerId/ledger` | **deferred** — staff/owner view of a customer's outstanding balance at their salon, and manual settlement action (`POST .../settle`) |

## Payments

| Method | Path | Notes |
|---|---|---|
| POST | `/payments/initiate` | Idempotency-Key required. `{ bookingId }` — called when policy requires prepayment, or voluntarily under `OPTIONAL`. Returns Razorpay order/checkout details. |
| POST | `/payments/webhook/razorpay` | signature-verified callback — the only path that sets `SUCCESS`/`FAILED` |
| POST | `/payments/:id/refund` | staff/admin-initiated, or automatic on cancellation |

## Reviews

| Method | Path | Notes |
|---|---|---|
| POST | `/bookings/:id/review` | only if `Booking.status = COMPLETED` |
| POST | `/dashboard/reviews/:id/respond` | owner reply |

## Admin (platform) — lives under the same `apps/web` dashboard route group, gated by the `PLATFORM_ADMIN` role guard, not a separate app

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH | `/admin/salons` | onboarding, suspension |
| GET | `/admin/audit-log` | |
| GET | `/admin/ledger` | cross-salon outstanding-balance visibility |
| (future) | `/admin/plans`, `/admin/salons/:id/subscription` | inert scaffolding, inactive in V1 |

## WebSocket namespace (`/realtime`)

Implemented in Phase 3C (`RealtimeGateway`). JWT verified at handshake (`client.handshake.auth.token`),
re-checking the user's live status exactly like `JwtStrategy` rather than trusting the token's
claims for the connection's whole lifetime. Every authenticated connection auto-joins
`customer:{userId}`; a client-emitted `join:salon` message joins `salon:{salonId}` (dashboard, or
a customer viewing a specific salon's live queue) — no additional membership check gates the join
itself, since every event payload below is ids-only with no PII; real access control lives on the
REST endpoints (`SalonAccessService`), which is what actually returns entry details/customer phone
numbers/etc.

Events actually emitted in Phase 3C: `queue.updated` (`{ salonId }`), `queue.entry.called`
(`{ salonId, queueEntryId }`, sent to both the salon room and the specific customer's room),
`staff.status.changed` (`{ salonId, staffId }`). `booking.confirmed`, `payment.settled`, and
`ledger.updated` remain future/unimplemented — no booking, payment, or ledger mutation pushes over
WS yet. Every payload carries only an entity id, never full state; clients always re-fetch via
REST rather than trusting the payload.

## Resolved (previously open)

- Availability algorithm: resolved via the service-level capacity model.
- Whether `/bookings` requires payment before `CONFIRMED`: resolved as policy-driven per salon, both branches implemented, client reads `Booking.status` from the response rather than assuming.
