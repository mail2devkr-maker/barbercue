# BarberCue — Architecture Overview

Status: **V1 architecture finalized and approved.** No application code has been built against this yet — implementation begins only on explicit instruction ("START PHASE 1 IMPLEMENTATION").
This file is the index. Detail lives in [DATABASE.md](DATABASE.md), [API.md](API.md), [PAYMENTS.md](PAYMENTS.md), [STATE_MACHINES.md](STATE_MACHINES.md), [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md), [DEPLOYMENT.md](DEPLOYMENT.md), [TESTING.md](TESTING.md).

## 1. System architecture

```
                    ┌─────────────────────┐
                    │   packages/shared    │  types, zod schemas, enums,
                    │  (TS types + rules)  │  state-machine constants
                    └──────────┬───────────┘
                               │ imported by
        ┌──────────────────────┼──────────────────────┐
        │                      │                       │
 ┌──────▼──────┐        ┌──────▼──────┐         ┌──────▼──────┐
 │ apps/web     │        │ apps/mobile  │         │ apps/backend │
 │ Next.js      │        │ Expo/RN + TS │         │ NestJS + TS  │
 │ App Router   │        │ (customer    │◄───────►│ REST + WS    │
 │ (public site │◄──────►│  app)        │  HTTPS  │ gateway      │
 │ + owner/staff│  HTTPS │              │         │              │
 │ + admin      │        │              │         │              │
 │ dashboards)  │        │              │         │              │
 └──────────────┘        └──────────────┘         └──────┬───────┘
                                                           │
                                                    ┌──────▼───────┐
                                                    │  PostgreSQL   │
                                                    └───────────────┘
```

One backend, one database, one source of business logic. Web and mobile are thin clients over the same REST/WebSocket API. `packages/shared` holds only shapes (types/DTOs/enums) and pure, side-effect-free helpers — the server re-validates every rule regardless of what a client computed locally.

## 2. Application boundaries

| App | Owns | Does not own |
|---|---|---|
| `apps/web` | Public SEO pages (city/locality/salon discovery), customer booking UI, **and** the salon owner, salon staff, and platform admin dashboards — all three as auth-gated route groups in one Next.js app, separated by route-level authorization, not by separate codebases | Business rules, payment logic, DB access |
| `apps/mobile` | Customer-facing native app (booking, queue status, notifications). Confirmed to remain part of the product — customers choose web/PWA or the app, never forced into either. | Business rules, DB access |
| `apps/backend` | All business logic, auth issuance, state machines, payment verification, realtime gateway, DB access | Rendering, SEO |
| `packages/shared` | Types, DTOs, zod schemas, enums, pure calculation helpers | Any I/O |

Only 3 apps — confirmed. No `apps/admin`, no `apps/api`. The admin dashboard is a stricter-guarded section of the same `(dashboard)` route group used by owners/staff, not a fourth app (see [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md#appsweb)).

**Staff experience (confirmed, not foreclosed)**: V1 ships the owner/staff dashboard as a responsive web app usable on phone, tablet, and desktop — no separate native staff codebase is built now. This is explicitly **not** a permanent decision against a native staff app: because all business logic lives in `apps/backend` and all shared shapes live in `packages/shared`, a future `apps/staff-mobile` (Expo, same pattern as `apps/mobile`) would consume the identical REST/WebSocket API with zero duplicated business logic — it's an additive app, not a redesign, whenever the need becomes concrete.

## 3. Database entities/relationships

Full detail in [DATABASE.md](DATABASE.md). `User` (identity, phone-OTP for customers / email+password for staff-owner-admin) → `UserRole` → `Salon` → `SalonPaymentPolicy` + `CancellationPolicy` (per-salon configurable rules) → `SalonStaff` / `Chair` / `StaffChairAssignment` (approved concepts, unchanged) → `Booking` (capacity reservation, policy-driven prepayment) → `QueueEntry` (created at check-in for appointments, immediately for walk-ins) → `ServiceSession` (concurrency enforced here) → `Payment` / `Refund` / `CustomerLedgerEntry` (the last being the resolved answer to "what happens when there's nothing to charge"). Discovery/SEO: `City`, `Locality`, `Photo`, `OperatingHours`. Future-ready, inactive in V1: `Plan`, `Entitlement`, `PlanEntitlement`.

## 4. Authentication model (finalized)

- **Customers**: phone OTP only. No password, ever — onboarding stays a single OTP step by design.
- **Staff/owner**: email + password. The `User` table carries `twoFactorEnabled`/`totpSecret` for every account from day one (see [DATABASE.md](DATABASE.md)), so staff/owner 2FA is a future feature flip, not a schema change — not enforced for these roles in V1, but the API contract (`/auth/staff/login` returns a `twoFactorRequired` flag, `/auth/staff/2fa/verify` exists as a reserved endpoint) is shaped for it now so the client doesn't need retrofitting later.
- **Platform admin**: email + password + **mandatory TOTP 2FA** — deliberately a stronger bar than any other role, per instruction.
- Tokens: short-lived JWT access (15 min) + rotating refresh token (httpOnly cookie on web, secure storage on mobile), tracked in `RefreshToken` for revocation.
- OTP delivery is behind a swappable `OtpSender` interface; vendor selection (MSG91/Twilio/etc.) remains an implementation detail to pick when auth is actually built, not an architectural fork.

**Phase 2 implementation notes** (concrete choices this doc left open, now resolved by the code):
- Refresh tokens are **opaque random strings** (64 bytes, `crypto.randomBytes`), never JWTs — only a SHA-256 hash is stored in `RefreshToken.tokenHash`, matching the "never store the raw secret" pattern already used for `OtpRequest`/`PasswordResetToken`. Rotation is enforced: every `/auth/refresh` call revokes the presented token and issues a new one.
- Web delivery: httpOnly cookie (`barbercue_refresh_token`, `SameSite=Lax`, `Secure` in production) scoped to `/api/v1/auth`. Mobile delivery: returned in the JSON response body and stored via `expo-secure-store`. The refresh endpoint accepts either (body takes precedence), so one endpoint serves both clients.
- TOTP: real RFC 6238 generation/verification via `otplib` (not a stub) with a ±30s clock-drift tolerance. `User.totpSecret` is encrypted at rest with AES-256-GCM (key from `TOTP_ENCRYPTION_KEY`), decrypted only at verification time.
- Session management (customer requirement, but implemented role-agnostically): `GET /auth/sessions` / `DELETE /auth/sessions/:id` / `POST /auth/logout-all`, all backed by the same `RefreshToken` rows used for auth — a "session" *is* an unrevoked, unexpired refresh token.
- Forgot/reset password (staff/owner/admin only) uses the same `EmailSender` DI-token pattern as `OtpSender` — a `ConsoleEmailSender` logs the reset link since no email provider is connected yet. Resetting a password revokes every existing session for that user.
- Admin accounts are seeded via `apps/backend/prisma/seed.ts`, which provisions the TOTP secret and prints the `otpauth://` URI once for authenticator-app enrollment — there is still no self-serve admin signup endpoint anywhere in the API.

## 5. Authorization / RBAC

Roles: `CUSTOMER`, `SALON_STAFF`, `SALON_OWNER`, `PLATFORM_ADMIN`. JWT carries `userId` + coarse `roles[]` only, never salon associations (which can go stale). Every salon-scoped mutation is checked against `SalonStaff` at request time via a guard. Admin routes use a separate, non-overlapping guard. This is unchanged from the prior round — reconfirmed, not revisited.

## 6–9. Booking, queue, payment, cancellation (all resolved this round)

- **Booking/payment relationship**: a `Booking` is a pure time/capacity reservation. Whether it also requires a `Payment` before confirming is decided per salon by `SalonPaymentPolicy` (`NONE`/`OPTIONAL`/`PARTIAL`/`FULL`) — never hard-coded as universally required. See [STATE_MACHINES.md](STATE_MACHINES.md#booking) and [PAYMENTS.md](PAYMENTS.md#prepayment-is-policy-driven-not-mandatory-resolved).
- **Booking capacity**: service-level, computed as `min(qualified staff, active chairs)` minus currently-consumed overlapping bookings — not a single salon-wide number. See [DATABASE.md](DATABASE.md#booking-capacity-model-resolved--service-level-not-salon-wide).
- **Queue creation timing**: appointment `Booking`s do not create a `QueueEntry` until check-in; walk-ins create one immediately on joining. See [STATE_MACHINES.md](STATE_MACHINES.md#queue-entry-creation-timing-resolved).
- **Cancellation charges**: computed from a per-salon (or platform-default) `CancellationPolicy`. When an eligible payment exists, the charge nets against a refund. When none exists, a `CustomerLedgerEntry` records the outstanding balance — BarberCue never attempts to auto-charge a customer with no payment or stored authorization on file. See [PAYMENTS.md](PAYMENTS.md#cancellation-charge-collection-resolved--this-was-the-key-open-question).

## 10. Multi-chair / multi-barber concurrency (unchanged, reconfirmed)

`SalonStaff`, `Chair`, `StaffChairAssignment` preserved exactly as approved. `ServiceSession` remains the sole concurrency guard via two partial unique Postgres indexes (`WHERE status = 'ACTIVE'` on `staffId` and on `chairId`), independently supporting 3+3, 3+2, and 2+3 barber/chair combinations without a single-capacity-per-salon simplification anywhere in the design.

## 11. Realtime architecture

Unchanged: Socket.IO gateway inside `apps/backend`, per-salon and per-customer rooms, events as refetch-notifications rather than trusted state. This is also the substrate the future native staff app would reuse without change.

## 12. Website / SEO architecture (confirmed)

Next.js App Router, confirmed (not "evaluated"). Hybrid rendering: static/ISR for city/locality/salon pages, client-fetched live-wait widget and booking flow so the SEO shell never goes stale. Full detail in [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md#seo-details). No ranking guarantee is made or implied anywhere in this documentation set.

## 13. Environment configuration

Three environments (`development`/`staging`/`production`), each with isolated DB, payment credentials, OTP credentials. Detail in [DEPLOYMENT.md](DEPLOYMENT.md).

## 14. Testing strategy

Summarized in [TESTING.md](TESTING.md), now including explicit coverage for the capacity algorithm, the check-in-triggered queue-entry creation path, and ledger-creation-on-uncollectable-cancellation.

## 15. Deployment architecture (cost-conscious, provider-agnostic — confirmed)

Containerized backend (portable across any Docker host), standard PostgreSQL (no vendor-specific extensions), Vercel for the Next.js app, no AWS-specific services designed in for V1. Full detail in [DEPLOYMENT.md](DEPLOYMENT.md).

## 16. Future subscription architecture (confirmed)

`Salon` carries `planId`, `subscriptionStatus`, `trialEndsAt`, `subscriptionExpiresAt`, `gracePeriodEndsAt` from day one. `Plan`/`Entitlement`/`PlanEntitlement` tables exist from day one. V1 seeds one `PILOT` plan (price 0) with entitlements generous enough to cover every V1 capability — no functional restriction anywhere. The single integration seam, `salonHasFeature(salonId, featureKey)`, unconditionally returns `true` in V1. Turning on billing later means introducing real paid `Plan` rows, wiring a payment provider for recurring salon charges, and making `salonHasFeature` actually check `PlanEntitlement`/`subscriptionStatus`/grace period — no schema migration or call-site rewrite required elsewhere.

## Decisions finalized this round (no longer open)

- Payment gateway: Razorpay, UPI-only.
- Customer auth: phone OTP, no password, ever.
- Staff/owner auth: email+password now, schema-ready for 2FA later; admin gets mandatory 2FA now.
- Prepayment: optional/policy-driven, not mandatory by default.
- Cancellation charge with no payment to collect against: `CustomerLedgerEntry`, no fake auto-collection.
- Booking capacity: service-level (`min(staff, chairs)` minus consumed), not salon-wide.
- Queue entry creation: check-in for appointments, immediate for walk-ins.
- Staff experience: web dashboard now, native app door deliberately left open.
- Monorepo: `apps/{web,mobile,backend}` + `packages/shared`, web contains all three dashboard audiences via route-level auth.
- Package manager: staying on npm workspaces; pnpm only if a concrete problem appears.
- Hosting: cost-conscious, provider-agnostic, no AWS-first design.

No open architectural decisions remain blocking Phase 1 scaffolding. Two items remain intentionally deferred as low-stakes implementation-time choices rather than architecture: exact OTP/SMS vendor, exact object-storage vendor for salon photos — neither affects any schema, API contract, or state machine in this document set.
