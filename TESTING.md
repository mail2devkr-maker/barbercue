# BarberCue — Testing Strategy

Status: **V1 decisions finalized** — coverage below reflects the resolved capacity model, policy-driven prepayment, and cancellation-ledger behavior.

## apps/backend

- **Unit tests (Jest)**: state-machine transition logic (booking, queue entry, service session, payment) — every legal transition and every illegal transition attempt (e.g. completing a `CANCELLED` booking should be rejected, not silently no-op'd). Cancellation-charge math (`packages/shared/calc`) gets exhaustive table-driven tests since it's money logic, covering all four `SalonPaymentPolicy` branches (`NONE`/`OPTIONAL`/`PARTIAL`/`FULL`) and both cancellation-charge outcomes (refund-netting vs. `CustomerLedgerEntry` creation).
- **Capacity algorithm tests**: table-driven cases across the required combinations (3 staff+3 chairs, 3+2, 2+3) asserting `slotCapacity = min(qualifiedStaff, activeChairs)` and that consumed capacity correctly counts both `CONFIRMED` and `PENDING_PAYMENT` bookings but not `CANCELLED`/`EXPIRED`/`NO_SHOW` ones.
- **Integration tests**: run against a real Postgres (docker-compose test DB, or Testcontainers) — not mocked — for booking creation (all four payment-policy branches), check-in (appointment → `QueueEntry` creation, rejected while still `PENDING_PAYMENT`), walk-in join, payment webhook processing, and cancellation (both the "eligible payment exists" and "no payment, ledger created" paths).
- **Concurrency test (critical, non-optional)**: fire N parallel `assign(staffId, chairId)` requests at the same staff/chair and assert exactly one succeeds and the rest return `409` — the actual proof the multi-barber/multi-chair guarantee holds. Same pattern for two customers racing the last capacity unit on a slot.
- **Idempotency test**: replay the same `Idempotency-Key` (customer action) or the same deterministic system key (simulated no-show sweep retry) and assert no duplicate `AuditLog`/`CustomerLedgerEntry`/charge results.
- **Webhook contract tests**: replay real (sanitized) Razorpay webhook payloads (success, failure, duplicate delivery, invalid signature) against the webhook handler.

## apps/web

- **Component tests** (React Testing Library): booking flow steps, dashboard queue actions.
- **E2E** (Playwright): the critical path — search a city → open a salon page → book a slot → complete a (sandboxed/test-mode) UPI payment → see confirmation; separately, a staff-dashboard E2E — call next customer → assign chair → complete service.
- **SEO checks**: automated assertions (part of the E2E suite or a small standalone script) that salon pages render a canonical URL, required OG tags, and valid JSON-LD — cheap to check, easy to silently regress.

## apps/mobile

- **Component tests** (RN Testing Library) for booking/queue screens.
- **E2E (Detox)**: lower priority for V1 — the customer mobile app is largely the same booking flow as web against the same API, so E2E investment is weighted toward web first; revisit once the mobile app has flows the website doesn't (e.g. push-notification-driven actions).

## packages/shared

Unit tests for every zod schema (valid/invalid payload cases) and every pure calc helper — this package is imported by all three apps, so a bug here is a bug everywhere simultaneously; it gets proportionally higher test coverage than app-specific code.

## What's explicitly out of scope for V1 testing

- Load/performance testing — premature before real traffic patterns exist.
- Full offline-mode E2E on mobile (airplane-mode simulation) — the resilience pattern (idempotency keys + reconcile-on-reconnect) is unit-testable at the outbox/retry-layer level without needing a full device network-simulation harness yet.
