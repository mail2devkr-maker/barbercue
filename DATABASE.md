# BarberCue — Database Design

Status: **V1 decisions finalized.** PostgreSQL. ORM: Prisma. Fields shown in camelCase (Prisma schema style); mapped to snake_case columns via `@map`/`@@map`. All IDs are UUIDs unless noted. All tables get `createdAt`/`updatedAt` (omitted below except where semantically important).

## Identity & access

**User**
- id, phone (unique, nullable), email (unique, nullable), passwordHash (nullable — customers never have one), phoneVerifiedAt, emailVerifiedAt, status (`ACTIVE`/`SUSPENDED`)
- **twoFactorEnabled** (bool, default false), **totpSecret** (nullable, encrypted at rest) — present on every user from day one so staff/owner 2FA can be turned on later with no migration; only enforced (`twoFactorEnabled` forced true) for `PLATFORM_ADMIN` in V1.
- Customers: phone only, no password — never prompted to set one. Staff/owner/admin: email + password.

**UserRole**
- id, userId → User, role (`CUSTOMER`/`SALON_STAFF`/`SALON_OWNER`/`PLATFORM_ADMIN`), salonId → Salon (nullable; required for `SALON_STAFF`/`SALON_OWNER`)
- unique(userId, role, salonId)

**RefreshToken** — id, userId → User, tokenHash, deviceInfo, expiresAt, revokedAt (nullable)

**OtpRequest** — id, phone, codeHash, purpose (`LOGIN`/`SIGNUP`), attempts, expiresAt, verifiedAt (nullable)

## Discovery / SEO

**City** — id, name, slug (unique), state, country

**Locality** — id, cityId → City, name, slug; unique(cityId, slug)

**Salon**
- id, ownerUserId → User, name, slug, cityId → City, localityId → Locality (nullable), addressLine, lat, lng, phone, description
- status (`PENDING`/`ACTIVE`/`SUSPENDED`)
- Subscription fields (inert in V1): planId → Plan (nullable), subscriptionStatus (`PILOT`/`TRIALING`/`ACTIVE`/`PAST_DUE`/`EXPIRED`), trialEndsAt, subscriptionExpiresAt, gracePeriodEndsAt
- unique(cityId, slug)

**SalonPaymentPolicy** (one row per salon; platform has no implicit default here — a salon without a row is treated as `NONE`, matching "must not require online payment by default")
- id, salonId → Salon (unique), prepaymentRequirement (`NONE`/`OPTIONAL`/`PARTIAL`/`FULL`), prepaymentPercentage (nullable int, required only when `PARTIAL`, e.g. `20` = 20% upfront)

**CancellationPolicy** (salonId nullable = platform default row, used when a salon hasn't configured its own)
- id, salonId → Salon (nullable), freeCancellationWindowMinutes
- lateCancellationChargeType (`FLAT`/`PERCENTAGE`), lateCancellationChargeValue
- noShowChargeType (`FLAT`/`PERCENTAGE`), noShowChargeValue
- appointmentArrivalGraceMinutes, queueCallResponseGraceMinutes
- V1 platform default (seeded row, salonId null): `freeCancellationWindowMinutes = 60`, late cancel = `PERCENTAGE 50`, no-show = `PERCENTAGE 100`, `appointmentArrivalGraceMinutes = 10`, `queueCallResponseGraceMinutes = 3`. These are ordinary configuration data, not hard-coded logic — every value above is read from this table, never inlined in code, so a salon overriding any of them requires zero code change.

**OperatingHours** — id, salonId → Salon, dayOfWeek (0–6), openTime, closeTime, isClosed; unique(salonId, dayOfWeek)

**Photo** — id, salonId → Salon, url, altText, type (`COVER`/`GALLERY`), sortOrder

## Staff / chairs (approved concepts, unchanged)

**SalonStaff** — id, salonId → Salon, userId → User, displayName, roleInSalon (`OWNER`/`MANAGER`/`BARBER`), status (`ACTIVE`/`INACTIVE`)

**Chair** — id, salonId → Salon, label, status (`ACTIVE`/`INACTIVE`/`MAINTENANCE`)

**StaffChairAssignment** (shift roster — not the concurrency guard) — id, salonId → Salon, staffId → SalonStaff, chairId → Chair, shiftDate, assignedFrom, assignedUntil (nullable)

**Service** — id, salonId → Salon, name, description, durationMinutes, price, category, isActive, **maxConcurrent** (nullable int) — future-proofing only: lets a service that needs a scarce fixed resource (e.g. one washing station) cap itself below the staff/chair-derived capacity. Unset in V1 for every seeded service; capacity falls through to the staff/chair pool calculation below.

**StaffService** (optional per-staff service capability) — staffId → SalonStaff, serviceId → Service; composite PK. **If a salon has zero `StaffService` rows for a given service, every `ACTIVE` staff member is treated as qualified for it** — small salons that never bother configuring specialties still get correct capacity math.

## Booking & queue

**Booking** (time/capacity reservation — never bound to a specific chair or staff member)
- id, salonId → Salon, customerId → User, serviceId → Service, slotStart, slotEnd
- status (`PENDING_PAYMENT`/`CONFIRMED`/`CANCELLED`/`COMPLETED`/`NO_SHOW`/`EXPIRED`)
- source (`APP`/`WEB`/`WALK_IN`), idempotencyKey (unique)
- **prepaymentRequiredAmount** (nullable, snapshot of `SalonPaymentPolicy` × `Service.price` at creation time — later policy edits never retroactively change what an existing booking owes)
- cancelledAt, cancelledBy → User (nullable), cancellationChargeAmount (nullable)
- **Whether a new `Booking` starts `PENDING_PAYMENT` or `CONFIRMED` is a pure function of `SalonPaymentPolicy.prepaymentRequirement`** — see [STATE_MACHINES.md](STATE_MACHINES.md#booking).

**QueueEntry** (the operational token — created at different times depending on source, see [STATE_MACHINES.md](STATE_MACHINES.md#queue-entry-creation-timing))
- id, salonId → Salon, bookingId → Booking (nullable — walk-ins), customerId → User (nullable — anonymous walk-in logged by staff)
- **source** (`WALK_IN`/`APPOINTMENT`) — explicit field, not inferred from `bookingId` presence, so queue analytics/filters don't depend on a join
- tokenNumber (int, scoped per salon per day), status (`WAITING`/`CALLED`/`IN_SERVICE`/`COMPLETED`/`NO_SHOW`/`CANCELLED`)
- assignedStaffId → SalonStaff (nullable until called), assignedChairId → Chair (nullable until called)
- joinedAt (= check-in time for appointments, join time for walk-ins), calledAt, serviceStartedAt, serviceCompletedAt, estimatedWaitMinutes (cached)

**ServiceSession** (the actual occupied-unit-of-work — concurrency enforced here, unchanged from prior design)
- id, queueEntryId → QueueEntry, staffId → SalonStaff, chairId → Chair, serviceId → Service
- status (`ACTIVE`/`COMPLETED`/`CANCELLED`), startedAt, endedAt (nullable)
- `CREATE UNIQUE INDEX service_session_staff_active_uq ON service_session(staffId) WHERE status = 'ACTIVE'`
- `CREATE UNIQUE INDEX service_session_chair_active_uq ON service_session(chairId) WHERE status = 'ACTIVE'`

## Payments

**Payment**
- id, bookingId → Booking (nullable — see cancellation ledger below), type (`BOOKING_PAYMENT`/`CANCELLATION_CHARGE`), amount, currency (`INR`)
- provider (`RAZORPAY`), providerOrderId, providerPaymentId (unique, nullable until success), idempotencyKey (unique)
- status (`CREATED`/`PENDING`/`SUCCESS`/`FAILED`/`EXPIRED`/`REFUNDED`/`PARTIALLY_REFUNDED`)
- webhookVerifiedAt (nullable)
- A `Payment` can exist against a `CONFIRMED` booking that never required one — that's the `OPTIONAL` policy case, where a customer voluntarily prepays. Nothing about `Payment`'s shape changes between "required" and "voluntary"; only `Booking.status`'s dependency on it differs.

**Refund** — id, paymentId → Payment, amount, reason, providerRefundId, status (`INITIATED`/`SUCCEEDED`/`FAILED`)

**CustomerLedgerEntry** (outstanding balance — the resolved mechanism for cancellation/no-show charges with nothing to collect against)
- id, customerId → User, salonId → Salon, bookingId → Booking (nullable), amount, reason (`CANCELLATION_CHARGE`/`NO_SHOW_CHARGE`)
- status (`OUTSTANDING`/`SETTLED`/`WAIVED`), settledByPaymentId → Payment (nullable — set if/when a future mandate mechanism or manual collection settles it), createdAt, settledAt
- This is never auto-charged in V1. It is a record, surfaced to the customer, that salon/platform policy can check before allowing a new booking. See [PAYMENTS.md](PAYMENTS.md#cancellation-charge-collection).

**IdempotencyKey** — key (unique, client-generated UUID), endpoint, requestHash, responseSnapshot (JSON), expiresAt. Also used for **system-triggered** transitions (e.g. the no-show sweep job uses a deterministic key like `noshow:{queueEntryId}:{scheduledRunDate}`) so a retried job run can't double-charge or double-transition — see [STATE_MACHINES.md](STATE_MACHINES.md#idempotent-auditable-transitions).

## Reviews

**Review** — id, salonId → Salon, customerId → User, bookingId → Booking (must be `COMPLETED`), rating (1–5), comment, ownerResponse (nullable)

## Notifications

**Notification** — id, userId → User, channel (`SMS`/`PUSH`/`EMAIL`), type, payload (JSON), status (`PENDING`/`SENT`/`FAILED`), sentAt

## Audit

**AuditLog** — id, actorUserId → User (**nullable = system-triggered**, e.g. automatic no-show detection), action, entityType, entityId, metadata (JSON)
- Written on every cancellation, refund, ledger entry creation/settlement, staff roster change, admin action, and automatic (system) state transition — no exceptions, since disputes over charges are the expected failure mode to design for.

## Subscription tables (inactive in V1)

**Plan** — id, name, priceMonthly, isActive. V1 seeds one row: `PILOT`, price 0.

**Entitlement** — id, key (e.g. `max_chairs`, `sms_notifications`), description

**PlanEntitlement** — planId → Plan, entitlementKey → Entitlement, value; composite PK

The `PILOT` plan is configured with entitlement values generous enough to cover every V1 capability with no functional restriction (no chair/staff/booking-volume caps). `salonHasFeature(salonId, featureKey)` unconditionally returns `true` in V1 — see [ARCHITECTURE.md §16](ARCHITECTURE.md#16-future-subscription-architecture).

## Booking capacity model (resolved — service-level, not salon-wide)

For a requested `(serviceId, slotStart, slotEnd)`:

1. **Qualified staff pool** = count of `ACTIVE` `SalonStaff` for the salon who are qualified for `serviceId` (all `ACTIVE` staff, if the salon has no `StaffService` rows for that service; otherwise only staff with a matching `StaffService` row).
2. **Chair pool** = count of `ACTIVE` `Chair` rows for the salon.
3. **Slot capacity** = `min(qualifiedStaffPool, chairPool)` — a service consumes one staff *and* one chair simultaneously, so the scarcer resource is the binding constraint. This is what makes 3 barbers + 2 chairs behave as capacity 2, and 2 barbers + 3 chairs behave as capacity 2, without a separate "capacity number" ever being manually set.
4. **Consumed capacity** for the slot = count of existing `Booking` rows for that salon with overlapping `[slotStart, slotEnd)` and status in (`CONFIRMED`, `PENDING_PAYMENT`) whose service draws from the same staff/chair pool (i.e., same qualified-staff intersection — in V1, simplify to "any service at this salon," since chairs are shared across all services; revisit only if a salon later has dedicated equipment per service, which is what `Service.maxConcurrent` exists for).
5. Slot is bookable iff `consumedCapacity < slotCapacity`.

Both `PENDING_PAYMENT` and `CONFIRMED` bookings count as consumed — a customer mid-payment for the last slot correctly blocks a second customer from also reserving it. Step 4's capacity check and the `Booking` insert happen in one transaction (`SELECT ... FOR UPDATE` on the overlapping-booking set) so two simultaneous requests for the last slot can't both succeed.

## Relationship summary (ER, textual)

```
User ──< UserRole >── Salon
User ──< SalonStaff >── Salon ──< Chair
SalonStaff ──< StaffChairAssignment >── Chair
Salon ──< Service ──< StaffService >── SalonStaff
Salon ── SalonPaymentPolicy (1:1)
Salon ──< CancellationPolicy (0:1, falls back to platform default row)
Salon ──< Booking >── User(customer)
Booking ──< QueueEntry (0..1, created at check-in for appointments, immediately for walk-ins)
QueueEntry ──< ServiceSession >── SalonStaff, Chair, Service
Booking ──< Payment (0..1, required/optional/voluntary depending on policy)
Payment ──< Refund
User(customer) ──< CustomerLedgerEntry >── Salon, Booking
Salon ──< Review >── Booking
Salon ──< Photo, OperatingHours
City ──< Locality ──< Salon
Salon ──< Plan (via planId, inert in V1)
```

No open decisions remain in this document — the two previously open questions (capacity model, queue-creation timing) are resolved above and in [STATE_MACHINES.md](STATE_MACHINES.md).
