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
| GET | `/salons/:salonId/queue-status` | **deferred past Phase 3A** — lightweight, cacheable few seconds — public live-wait widget; needs live-queue work from a later phase |
| GET | `/salons/:salonId/reviews` | **deferred past Phase 3A** — standalone paginated reviews; Phase 3A's salon profile response embeds the 10 most recent reviews directly instead, which is enough for the page UI and JSON-LD `aggregateRating` |

## Booking (customer, authenticated)

| Method | Path | Notes |
|---|---|---|
| GET | `/salons/:salonId/availability?serviceId=&date=` | applies the service-level capacity algorithm in [DATABASE.md](DATABASE.md#booking-capacity-model-resolved--service-level-not-salon-wide) |
| POST | `/bookings` | Idempotency-Key required. `{ salonId, serviceId, slotStart }`. Response status is `CONFIRMED` or `PENDING_PAYMENT` depending on the salon's `SalonPaymentPolicy` — client branches on the returned status, never assumes one or the other. Rejected with `OUTSTANDING_BALANCE` if the customer has a blocking `CustomerLedgerEntry` at that salon. |
| GET | `/bookings/mine` | paginated |
| GET | `/bookings/:id` | |
| POST | `/bookings/:id/check-in` | Idempotency-Key required. Only valid when `Booking.status = CONFIRMED`. Creates a `QueueEntry(source=APPOINTMENT)` — this is the only path that turns an appointment into a live queue token; booking creation never does this implicitly. |
| POST | `/bookings/:id/cancel` | Idempotency-Key required. Runs the cancellation flow in [STATE_MACHINES.md](STATE_MACHINES.md#cancellation-flow-resolved); response includes whether a refund, a retained charge, or a new `CustomerLedgerEntry` resulted. |

## Queue (customer view)

| Method | Path | Notes |
|---|---|---|
| GET | `/queue-entries/mine/active` | current active token, if any |
| POST | `/salons/:salonId/queue/join` | Idempotency-Key required. Walk-in only — creates `QueueEntry(source=WALK_IN, bookingId=null)` immediately. `{ serviceId }` optional. |

## Customer account

| Method | Path | Notes |
|---|---|---|
| GET | `/customers/me/ledger` | outstanding/settled `CustomerLedgerEntry` rows — surfaces exactly what [PAYMENTS.md](PAYMENTS.md#cancellation-charge-collection-resolved--this-was-the-key-open-question) requires exposing to the customer |

## Queue & chair/staff operations (staff/owner dashboard, salon-scoped auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/salons/:salonId/queue` | full live queue, also pushed over WS |
| POST | `/dashboard/queue-entries/:id/call` | `WAITING`→`CALLED` |
| POST | `/dashboard/queue-entries/:id/assign` | `{ staffId, chairId }` → creates `ServiceSession`, entry → `IN_SERVICE`. `409 CHAIR_ALREADY_OCCUPIED`/`STAFF_ALREADY_OCCUPIED` on constraint conflict. |
| POST | `/dashboard/service-sessions/:id/complete` | ends session, `QueueEntry` → `COMPLETED` |
| POST | `/dashboard/queue-entries/:id/no-show` | manual trigger; the same transition the automatic sweep job uses, sharing one idempotent, audited code path |
| POST | `/dashboard/queue-entries/:id/cancel` | staff-initiated |
| PATCH | `/dashboard/staff/:id/status` | clock-in/break/clock-out — affects ETA + assignability, not queue-entry state |
| POST/PATCH | `/dashboard/staff`, `/dashboard/staff/:id` | owner-only |
| POST/PATCH | `/dashboard/chairs`, `/dashboard/chairs/:id` | owner-only |
| POST/PATCH | `/dashboard/staff/:id/services` | owner-only — manages `StaffService` rows for capacity qualification |
| PUT | `/dashboard/salons/:salonId/hours` | owner-only, triggers ISR revalidation webhook to `apps/web` |
| PUT | `/dashboard/salons/:salonId/payment-policy` | owner-only — sets `SalonPaymentPolicy` |
| PUT | `/dashboard/salons/:salonId/cancellation-policy` | owner-only — sets the salon's `CancellationPolicy` row (falls back to platform default if never set) |
| POST | `/dashboard/salons/:salonId/photos` | owner-only, signed upload URL |
| GET | `/dashboard/customers/:customerId/ledger` | staff/owner view of a customer's outstanding balance at their salon, and manual settlement action (`POST .../settle`) |

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

JWT at handshake. Rooms: `salon:{salonId}` (dashboard, or a customer viewing a specific salon's live queue), `customer:{userId}` (personal updates). Events (`queue.updated`, `queue.entry.called`, `booking.confirmed`, `payment.settled`, `ledger.updated`, `staff.status.changed`) carry only an entity id + type; clients always re-fetch via REST rather than trusting the payload as full state.

## Resolved (previously open)

- Availability algorithm: resolved via the service-level capacity model.
- Whether `/bookings` requires payment before `CONFIRMED`: resolved as policy-driven per salon, both branches implemented, client reads `Booking.status` from the response rather than assuming.
