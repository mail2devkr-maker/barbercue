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

**PasswordResetToken** — *Phase 2 addition, not in the original list below.* id, userId → User, tokenHash (unique — only a hash is ever stored, same pattern as `RefreshToken`/`OtpRequest`), expiresAt, usedAt (nullable), createdAt. Backs the approved staff/owner/admin "Forgot Password" flow (customers never have a password, so never use this).

**AuthIdentity** — *major-upgrade phase addition.* id, userId → User, provider (`GOOGLE`/`WHATSAPP` — the latter reserved, unimplemented), providerSub (Google's stable `sub` claim, never the email), email (nullable snapshot at link time, display/support only — never the identity key), createdAt. unique(provider, providerSub). A `User` can hold multiple rows here (Google + phone OTP simultaneously) — this is what makes auth provider-based rather than parallel unlinkable systems.

## Discovery / SEO

**City** — id, name, slug (unique), state, country

**Locality** — id, cityId → City, name, slug; unique(cityId, slug)

**Salon**
- id, ownerUserId → User, name, slug, cityId → City, localityId → Locality (nullable), addressLine, lat, lng, phone, description
- **publicId** (`BC-SHOP-000001` format, unique, major-upgrade phase) — permanent, human-shareable identifier, distinct from `id`; assigned once at creation by a Postgres sequence-backed column default (see `add_salon_public_id` migration), never written by application code afterward, so uniqueness/monotonicity are DB-guaranteed, not app-level.
- **email** (nullable, major-upgrade phase) — business contact email, distinct from the owner's own login email on `User`.
- status (`PENDING`/`ACTIVE`/`SUSPENDED`) — self-serve registration (`POST /salons`, major-upgrade phase) always creates `PENDING`; this default already existed but was previously only reachable via seed data.
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
- **Phase 3B fix**: this platform-default row was documented here from Phase 1 but never actually inserted — `prisma/seed.ts` skipped it with a comment deferring it, leaving nothing for cancellation to fall back to. `seed.ts` now idempotently upserts this exact row (`seedPlatformDefaultCancellationPolicy`), found while implementing booking cancellation.

**OperatingHours** — id, salonId → Salon, dayOfWeek (0–6), openTime, closeTime, isClosed; unique(salonId, dayOfWeek)

**Photo** — id, salonId → Salon, url, altText, type (`COVER`/`GALLERY`), sortOrder

## Staff / chairs (approved concepts, unchanged)

**SalonStaff** — id, salonId → Salon, userId → User, displayName, roleInSalon (`OWNER`/`MANAGER`/`BARBER`), status (`ACTIVE`/`INACTIVE`)

**Chair** — id, salonId → Salon, label, status (`ACTIVE`/`INACTIVE`/`MAINTENANCE`)

**StaffChairAssignment** (shift roster — not the concurrency guard) — id, salonId → Salon, staffId → SalonStaff, chairId → Chair, shiftDate, assignedFrom, assignedUntil (nullable)

**Service** — id, salonId → Salon, name, description, durationMinutes, price, category, isActive, **maxConcurrent** (nullable int) — future-proofing only: lets a service that needs a scarce fixed resource (e.g. one washing station) cap itself below the staff/chair-derived capacity. Unset in V1 for every seeded service; capacity falls through to the staff/chair pool calculation below.

**StaffService** (optional per-staff service capability) — staffId → SalonStaff, serviceId → Service; composite PK. **If a salon has zero `StaffService` rows for a given service, every `ACTIVE` staff member is treated as qualified for it** — small salons that never bother configuring specialties still get correct capacity math.

## Booking & queue

**Booking** (time/capacity reservation — never bound to a specific chair or staff member for capacity purposes)
- id, salonId → Salon, customerId → User, serviceId → Service, slotStart, slotEnd
- status (`PENDING_PAYMENT`/`CONFIRMED`/`CANCELLED`/`COMPLETED`/`NO_SHOW`/`EXPIRED`)
- source (`APP`/`WEB`/`WALK_IN`), idempotencyKey (unique)
- **prepaymentRequiredAmount** (nullable, snapshot of `SalonPaymentPolicy` × `Service.price` at creation time — later policy edits never retroactively change what an existing booking owes)
- **preferredStaffId → SalonStaff (nullable)** — *Phase 3B addition.* A soft customer preference captured during booking ("choose a barber," with "Any Staff" = null), shown to the salon later, but explicitly **not** a capacity input — the pool-based algorithm below is completely unchanged by it. Real staff/chair assignment still only happens at queue check-in/dashboard-assign time. This preserves the "never bound to a specific staff member" capacity model above while still letting the customer express a preference; validated for qualification/active status at booking time but never blocks or filters slot availability.
- cancelledAt, cancelledBy → User (nullable), cancellationChargeAmount (nullable)
- **selectedStyleName** (nullable string, major-upgrade phase) — set only when the booking arrived via the AI Style Advisor's "Try This Look" hand-off; free text, not a foreign key, since `HAIRSTYLE_CATALOG` is a fixed `packages/shared` constant rather than salon-configurable DB data.
- **Whether a new `Booking` starts `PENDING_PAYMENT` or `CONFIRMED` is a pure function of `SalonPaymentPolicy.prepaymentRequirement`** — see [STATE_MACHINES.md](STATE_MACHINES.md#booking).

**QueueEntry** (the operational token — created at different times depending on source, see [STATE_MACHINES.md](STATE_MACHINES.md#queue-entry-creation-timing))
- id, salonId → Salon, bookingId → Booking (nullable — walk-ins), customerId → User (nullable — anonymous walk-in logged by staff)
- **source** (`WALK_IN`/`APPOINTMENT`) — explicit field, not inferred from `bookingId` presence, so queue analytics/filters don't depend on a join
- **serviceId → Service (nullable)** — *Phase 1 implementation addition, not in the original field list above.* API.md's walk-in join endpoint accepts an optional `serviceId` with nowhere else to hold it before a `ServiceSession` exists; an appointment-sourced entry can still resolve its service via the linked `Booking` instead. Filling this gap, not contradicting the original design.
- tokenNumber (int, scoped per salon per day), status (`WAITING`/`CALLED`/`IN_SERVICE`/`COMPLETED`/`NO_SHOW`/`CANCELLED`)
- assignedStaffId → SalonStaff (nullable until called), assignedChairId → Chair (nullable until called)
- joinedAt (= check-in time for appointments, join time for walk-ins), calledAt, serviceStartedAt, serviceCompletedAt, estimatedWaitMinutes (cached)

**ServiceSession** (the actual occupied-unit-of-work — concurrency enforced here, unchanged from prior design)
- id, queueEntryId → QueueEntry, staffId → SalonStaff, chairId → Chair, serviceId → Service
- status (`ACTIVE`/`COMPLETED`/`CANCELLED`), startedAt, endedAt (nullable)
- `CREATE UNIQUE INDEX service_session_staff_active_uq ON service_session(staffId) WHERE status = 'ACTIVE'`
- `CREATE UNIQUE INDEX service_session_chair_active_uq ON service_session(chairId) WHERE status = 'ACTIVE'`

**Phase 3C note**: the queue/check-in engine (walk-in join, appointment check-in, call, assign,
complete, no-show, cancel, staff clock-in/out) required **zero schema changes** — every model and
field above (including the two partial unique indexes, exercised for the first time here) was
already fully designed in Phase 1. `QueueEntry.estimatedWaitMinutes` is recomputed for every
`WAITING` entry at a salon after every mutation (`recomputeEtas` in `queue.service.ts`), using
`packages/shared`'s `estimateWaitMinutes(serverCount, peopleAhead, avgServiceDurationMinutes,
activeSessionsRemainingMinutes)` — `serverCount` reuses the same `computeSlotCapacity` (qualified
staff × active chairs) as the booking capacity model above, scoped to the entry's own service.

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

Both `PENDING_PAYMENT` and `CONFIRMED` bookings count as consumed — a customer mid-payment for the last slot correctly blocks a second customer from also reserving it. Step 4's capacity check and the `Booking` insert happen in one transaction so two simultaneous requests for the last slot can't both succeed.

**Phase 3B implementation refinement**: the literal mechanism is a per-salon Postgres advisory transaction lock (`pg_advisory_xact_lock(hashtext(salonId))`), not `SELECT ... FOR UPDATE` on the overlapping-booking set as originally worded here. `FOR UPDATE` only locks *existing* rows, so it doesn't serialize two *first-ever* concurrent bookings for an empty slot (there's nothing yet to lock) — the advisory lock closes that gap completely while preserving the documented intent unchanged. Verified directly: an e2e test creates 3 concurrent bookings against a capacity-3 slot (3 qualified staff × 4 chairs) and confirms a 4th is rejected with `SLOT_FULL`. Also note: Neon's serverless Postgres can incur a multi-second cold-start on the first query after inactivity, which can exceed Prisma's default 5s interactive-transaction window — this transaction is opened with an explicit 15s timeout to absorb that, not because the transaction's own work is slow.

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
