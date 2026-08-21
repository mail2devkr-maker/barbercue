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
- OTP delivery is behind a swappable `OtpSender` interface; vendor selection (2Factor.in, resolved below) was always an implementation detail to pick when auth is actually built, not an architectural fork.

**Phase 2 implementation notes** (concrete choices this doc left open, now resolved by the code):
- Refresh tokens are **opaque random strings** (64 bytes, `crypto.randomBytes`), never JWTs — only a SHA-256 hash is stored in `RefreshToken.tokenHash`, matching the "never store the raw secret" pattern already used for `OtpRequest`/`PasswordResetToken`. Rotation is enforced: every `/auth/refresh` call revokes the presented token and issues a new one.
- Web delivery: httpOnly cookie (`barbercue_refresh_token`, `SameSite=Lax`, `Secure` in production), `Path=/`. Mobile delivery: returned in the JSON response body and stored via `expo-secure-store`. The refresh endpoint accepts either (body takes precedence), so one endpoint serves both clients. **Phase 3B fix**: this cookie was originally scoped to `Path=/api/v1/auth` (narrower, so the browser wouldn't attach it to every backend call) — but `apps/web/proxy.ts`'s coarse session-presence gate on `/account/*`/`/dashboard/*` reads this cookie on requests to the *web app* (e.g. `localhost:3001/account/bookings`), a path that never starts with `/api/v1/auth`. Cookies are scoped by (domain, path) only, never by port, so the backend (`:3000`) and web app (`:3001`) share one cookie jar in dev — but the narrow path silently hid the cookie from proxy.ts's check, making it redirect every fresh/hard navigation to those routes to `/login` even when fully authenticated. Widened to `Path=/`; only `/auth/refresh` and `/auth/logout` ever read it server-side regardless.
- TOTP: real RFC 6238 generation/verification via `otplib` (not a stub) with a ±30s clock-drift tolerance. `User.totpSecret` is encrypted at rest with AES-256-GCM (key from `TOTP_ENCRYPTION_KEY`), decrypted only at verification time.
- Session management (customer requirement, but implemented role-agnostically): `GET /auth/sessions` / `DELETE /auth/sessions/:id` / `POST /auth/logout-all`, all backed by the same `RefreshToken` rows used for auth — a "session" *is* an unrevoked, unexpired refresh token.
- Forgot/reset password (staff/owner/admin only) uses the same `EmailSender` DI-token pattern as `OtpSender` — a `ConsoleEmailSender` logs the reset link since no email provider is connected yet. Resetting a password revokes every existing session for that user.
- Admin accounts are seeded via `apps/backend/prisma/seed.ts`, which provisions the TOTP secret and prints the `otpauth://` URI once for authenticator-app enrollment — there is still no self-serve admin signup endpoint anywhere in the API.
- **SMS delivery (resolved)**: `TwoFactorOtpSender` (`apps/backend/src/auth/services/two-factor-otp-sender.ts`) implements `OtpSender` against 2Factor.in's custom-OTP SMS endpoint, sending the exact code `OtpService` already generated and hashed — 2Factor never generates or holds its own OTP value, so `OtpService` stays the single OTP authority. `AuthModule` wires `OTP_SENDER` via a factory: `ConsoleOtpSender` when `NODE_ENV !== 'production'`, `TwoFactorOtpSender` when it is — same `process.env.NODE_ENV` check already used for the refresh cookie's `secure` flag, not a new configuration mechanism. Credential: `OTP_PROVIDER_API_KEY` (existing env var, reused rather than adding a vendor-specific name). A provider failure (bad key, non-2xx response, malformed body, or network error) throws `AppException(OTP_DELIVERY_FAILED)` — the OTP row is still created and still counts toward the phone-based rate limit before delivery is attempted, so a failing provider can't be abused to bypass `OtpService`'s existing limits.
- **Google Sign-In (major-upgrade phase, resolved)**: customer auth is now provider-based, not phone-OTP-only — a `User` can hold multiple `AuthIdentity` rows (`provider`, `providerSub`, unique together), so Google and phone OTP are two ways to reach the same account rather than parallel unlinkable systems. `GoogleAuthService.verifyIdToken` (backend) verifies the client-supplied ID token against Google itself via `google-auth-library`'s `OAuth2Client`, accepting either the web or Android OAuth client ID as valid audience; the client-supplied `email` is only trusted when Google's own `email_verified` claim is `true`, otherwise treated as absent (never used to link accounts). `AuthService.googleLogin` looks up by `(GOOGLE, sub)` first (existing identity → log in), then by verified email (existing `User`, no `AuthIdentity` yet → link, never duplicate), then creates a new `CUSTOMER` user as a last resort — linking to an existing STAFF/OWNER account additionally grants `CUSTOMER` without touching their existing roles. Staff/owner/admin auth (password + TOTP) is completely untouched by this. `AuthProvider.WHATSAPP` is reserved in the enum but has no implementation — researched and found not "genuinely free" (Meta's WhatsApp Business Platform moved to per-message pricing in 2025, plus Business verification/template-approval prerequisites), so per instruction nothing fake was built; a future `WhatsAppOtpSender implementing OtpSender` is architecturally trivial when that cost is approved.

## 5. Authorization / RBAC

Roles: `CUSTOMER`, `SALON_STAFF`, `SALON_OWNER`, `PLATFORM_ADMIN`. JWT carries `userId` + coarse `roles[]` only, never salon associations (which can go stale). Admin routes use a separate, non-overlapping guard.

**Phase 3C correction**: salon-scoped mutations are checked against **`UserRole`** at request time (`SalonAccessService.assertAccess`), not `SalonStaff` as this section previously said — a `SALON_OWNER` has authority over a salon via a `UserRole` row but no `SalonStaff` roster row at all (only barbers/managers assignable to actually serve customers get one). `SalonStaff`-based checks remain correct for staff-*qualification* questions (e.g. "is this person qualified to perform this service," `AvailabilityService.assertStaffQualified`), which is a distinct question from "does this user have authority over this salon."

## 6–9. Booking, queue, payment, cancellation (all resolved this round)

- **Booking/payment relationship**: a `Booking` is a pure time/capacity reservation. Whether it also requires a `Payment` before confirming is decided per salon by `SalonPaymentPolicy` (`NONE`/`OPTIONAL`/`PARTIAL`/`FULL`) — never hard-coded as universally required. See [STATE_MACHINES.md](STATE_MACHINES.md#booking) and [PAYMENTS.md](PAYMENTS.md#prepayment-is-policy-driven-not-mandatory-resolved).
- **Booking capacity**: service-level, computed as `min(qualified staff, active chairs)` minus currently-consumed overlapping bookings — not a single salon-wide number. See [DATABASE.md](DATABASE.md#booking-capacity-model-resolved--service-level-not-salon-wide).
- **Queue creation timing**: appointment `Booking`s do not create a `QueueEntry` until check-in; walk-ins create one immediately on joining. See [STATE_MACHINES.md](STATE_MACHINES.md#queue-entry-creation-timing-resolved).
- **Cancellation charges**: computed from a per-salon (or platform-default) `CancellationPolicy`. When an eligible payment exists, the charge nets against a refund. When none exists, a `CustomerLedgerEntry` records the outstanding balance — BarberCue never attempts to auto-charge a customer with no payment or stored authorization on file. See [PAYMENTS.md](PAYMENTS.md#cancellation-charge-collection-resolved--this-was-the-key-open-question).

## 10. Multi-chair / multi-barber concurrency (unchanged, reconfirmed)

`SalonStaff`, `Chair`, `StaffChairAssignment` preserved exactly as approved. `ServiceSession` remains the sole concurrency guard via two partial unique Postgres indexes (`WHERE status = 'ACTIVE'` on `staffId` and on `chairId`), independently supporting 3+3, 3+2, and 2+3 barber/chair combinations without a single-capacity-per-salon simplification anywhere in the design.

## 11. Realtime architecture

**Implemented in Phase 3C** (previously planned, not built): Socket.IO gateway (`RealtimeGateway`, `/realtime` namespace) inside `apps/backend`, per-salon (`salon:{salonId}`) and per-customer (`customer:{userId}`) rooms, events as ids-only refetch-notifications rather than trusted state (`queue.updated`, `queue.entry.called`, `staff.status.changed` — `booking.confirmed`/`payment.settled`/`ledger.updated` remain future, unimplemented). JWT verified at handshake, re-checking live user status rather than trusting the token's claims for the connection's lifetime. Both `apps/web` and `apps/mobile` connect via a thin `socket.io-client` wrapper (`lib/realtime.ts`). This is also the substrate the future native staff app would reuse without change.

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

## 17. Shop public IDs and self-serve registration (major-upgrade phase)

`Salon.publicId` (`BC-SHOP-000001`) is a permanent, human-shareable identifier distinct from the internal UUID `id` — assigned once at creation by a Postgres sequence-backed column default (`add_salon_public_id` migration), never written by application code afterward. `POST /salons` (`SalonsService.registerSalon`) is genuine self-serve: any authenticated user (customer or existing owner) submits name/address/lat-lng/city, the salon is created `PENDING` (existing default, previously only reachable via seed data), and a `SALON_OWNER` `UserRole` is granted in the same transaction — additive to whatever roles the caller already had. Requires an existing `City` (by slug) rather than accepting free-text state/country, so a typo can't silently create a duplicate `City` row; a brand-new city with zero prior shops needs an admin/seed step before its first self-serve registration (known V1 limitation, not a bug).

## 18. Landing page (major-upgrade phase)

Full redesign of `apps/web/app/(public)/page.tsx` — hero (+ illustrated, accessible, `prefers-reduced-motion`-aware slideshow), How It Works, Find a Shop, Skip the Queue, AI Style Advisor teaser, Popular Styles, Featured Shops, Customer/Owner Benefits, Final CTA, Footer. No licensed photography exists for this project, so all visuals are inline SVG/CSS — no hotlinked or fabricated image URLs. Testimonials deliberately omitted (pre-launch product, no real customers yet — a fabricated quote would be dishonest).

## 19. AI Style Advisor (major-upgrade phase)

`POST /style-advisor/generate` (`@Roles(CUSTOMER)`, strict throttle, memory-only multipart upload — never written to disk) sits behind a swappable `AiImageProvider` interface, same DI-swap shape as `OtpSender`. `HAIRSTYLE_CATALOG` (`packages/shared`) is a small fixed list, not a DB table, since styles aren't salon-configurable. A selected style name threads through `?style=`/navigation params across search → salon profile → booking form, landing in `Booking.selectedStyleName` on real booking creation — this hand-off is fully wired and live-verified end to end, independent of which image-generation provider is connected.

**Provider status: disabled by default, on purpose.** `GeminiAiImageProvider` (Google's `gemini-2.5-flash-image` via the official `@google/genai` SDK, `ai.models.generateContent`) is fully implemented and unit-tested but is **not** wired into `AI_IMAGE_PROVIDER` automatically. `StyleAdvisorModule`'s factory now requires two env vars set together — `GEMINI_API_KEY` **and** `AI_IMAGE_PROVIDER=gemini` — before it will construct `GeminiAiImageProvider`; either one alone keeps the default `UnconfiguredAiImageProvider`, which always throws a typed `AI_PROVIDER_NOT_CONFIGURED` error (disclosed to the user in-product with an honest "temporarily unavailable, your photo was not stored" message, never a fabricated preview image, never mentioning the provider name or an HTTP status). This is deliberate, not a placeholder: **`gemini-2.5-flash-image` has no free tier** — confirmed both officially (`ai.google.dev/gemini-api/docs/pricing` lists "Free Tier: Not available" for this model) and empirically (a real API key returned `HTTP 429` on its very first call), and this project is not enabling billing right now.

**Free-alternative research (done before touching any code).** Investigated three categories:
- *Dedicated hairstyle/virtual-try-on APIs* — LightX AI Hairstyle (25 credits, one-time signup trial, not a recurring free tier — disqualified), api.market "Hair Changer" (its own pricing page showed no usable tier details — too undocumented to build on), roboMUA Hairstyle Try-On API (`/hairswap`, facial-landmark-based — the most promising candidate: a genuinely *recurring* 100 requests/month free tier, no credit-card requirement found in its docs or Terms of Use). roboMUA was **not** implemented: its Terms of Use and API docs have **no documented data-retention policy** for uploaded photos, and obtaining its API key requires personally creating a third-party account — an action this codebase/agent cannot perform on the operator's behalf. Per this phase's explicit instruction, an undocumented third-party retention policy must be flagged, not assumed safe.
- *General image-to-image APIs* (Stability AI, Hugging Face Inference API, Replicate, OpenAI images) — all confirmed pay-as-you-go or one-time-trial-credit only for image generation; none offer a sustained free API quota suitable for production-shaped use without a card.
- *Self-hosted open-source* (HairFastGAN, HairPort, diffusion-based hairstyle transfer) — technically free of API cost, but these are GPU-oriented diffusion/identity-preservation stacks with multi-GB model downloads and heavy Python/CUDA dependencies; judged impractical to run reliably on a GPU-less 16GB-RAM Windows dev machine (the actual target environment) and out of proportion to a preview feature.

No candidate satisfied every stated requirement (genuine recurring free quota + verifiable identity preservation + documented, acceptable photo-retention behavior + no third-party account creation required of the agent), so none was implemented as a replacement. The honest "temporarily unavailable" state is intentional, not a shortfall — see the module's own comments for the exact reactivation switch once billing is approved.

## 20. Premium plans & AI credits (Premium phase)

The AI Style Advisor is now Premium-only, gated by a real backend entitlement + credit-ledger check — never a frontend-only restriction. New models (`CustomerPremiumPlan`, `CustomerSubscription`, `AiCreditTransaction`) are deliberately **separate** from the existing `Plan`/`Entitlement`/`PlanEntitlement`/`Salon.subscriptionStatus` scaffolding (§16 above): that trio is salon (B2B) platform-tier billing, still inert in V1; this is customer (B2C) AI-credit billing — conflating the two under one schema concept would have been wrong.

Three annual plans — Basic (₹99/yr, 12 credits), Pro (₹299/yr, 48 credits, `isPopular: true`), Max (₹499/yr, 84 credits) — live in `CustomerPremiumPlan`, seeded by `prisma/seed.ts` (single authoritative source; `PremiumPlansService` reads the table, nothing is hard-coded). `PremiumEntitlementService.hasActivePremiumSubscription`/`getEntitlement` is the one centralized "is this customer Premium" check (`status === ACTIVE && periodEnd > now`, computed lazily — no cron sweep needed, matching the "no complicated rollover logic" instruction for this phase).

`AiCreditService` is the only writer of a subscription's `aiCreditsReserved`/`aiCreditsConsumed` counters, via a strict reserve → (consume | release) lifecycle: `StyleAdvisorService.generate()` reserves one credit before ever calling `AiImageProvider`, consumes it on success, releases it on any failure — a customer is never charged for a generation that didn't happen. `reserveCredit` wraps its check-then-increment in a transaction holding a per-user Postgres advisory lock (`pg_advisory_xact_lock(hashtext(userId))`), the same pattern `BookingsService` uses for slot-capacity races — this is what actually prevents two concurrent requests (e.g. two browser tabs) from both observing "1 credit available" and overspending; `consumeCredit`/`releaseCredit` are unconditional atomic increments needing no lock. Every balance change is logged to `AiCreditTransaction` for auditability (never contains photo data or API keys).

`POST style-advisor/generate` now returns `PREMIUM_REQUIRED` (no active subscription) or `AI_CREDITS_EXHAUSTED` (zero available balance) instead of ever reaching the provider — both are `StyleAdvisorErrorCode` values, mapped in the frontend to a locked/no-credits state rather than a generic error, with a link to the new `/account/premium` page.

**No real payment provider exists in this codebase** (`Payment`/`Refund` are schema-only; no `PaymentsModule` was ever built — confirmed via `AppModule`'s own comment). Per this phase's explicit instruction, `/account/premium` was **not** wired to a fake purchase flow — each plan card honestly shows "Online payment is coming soon" instead of a button that silently grants Premium. `PremiumController`'s `POST premium/dev/activate` is a real subscription-creation path with zero payment, gated by `process.env.NODE_ENV === 'production'` returning `DEV_ACTIVATION_DISABLED` — unreachable in production regardless of caller — that exists purely so Premium can be exercised locally without a payment integration; it activates only the calling (already-authenticated) user's own account, never an arbitrary one.

## 21. Shop QR / public queue entry (Phase 9)

A walk-in customer scans a per-shop QR code and lands on `/q/[publicQueueToken]` — a public, unauthenticated page — without ever creating a traditional account. `Salon.publicQueueToken` (added in Phase 9's migration) is the one and only token for this: 48 hex characters from `crypto.randomBytes(24)` (same convention as `auth.service.ts`'s password-reset token), generated lazily and race-safely by `PublicQueueTokenService.getOrCreateToken` on a salon's first QR request, looked up via its existing unique index. Deliberately distinct from `Salon.publicId` (a sequential, enumerable "BC-SHOP-000001" counter, unsuitable for a join-my-queue link) and never `Salon.id` (the internal PK).

**No second queue engine, no second guest-identity system.** The customer authenticates via the existing phone-OTP endpoints (unmodified) directly on the public page, then `POST public-queue/:token/join` resolves the token to a salon *server-side* — the request body carries no `salonId` at all, so a customer cannot manipulate which shop's queue they join — and delegates straight to the existing, byte-for-byte unmodified `QueueService.joinWalkIn`. Every existing rule (capacity, duplicate-active-entry, the `SalonStatus.ACTIVE` check inside `AvailabilityService.getSalonOrThrow`, concurrency protections) applies exactly as it does for an authenticated customer joining via the dashboard. Post-join, the page renders the same `QueueStatusPanel` and connects to the same `/realtime` Socket.IO gateway an authenticated customer's own queue page already uses — `RealtimeGateway`'s existing JWT-at-handshake requirement is satisfied because the customer is, by this point, genuinely authenticated.

`GET public-queue/:token` (public, throttled) returns only `{salonName, queueAvailable, services, waitingCount, estimatedWaitMinutes}` — never `Salon.id`, `ownerUserId`, or staff/customer data — and returns the identical generic "not available" error for both a syntactically-odd and a syntactically-valid-but-unknown token, giving no signal that would help enumerate tokens. A resolvable token whose salon isn't `ACTIVE` still returns `200` with `queueAvailable: false` rather than a 404, so the page can distinguish "this shop paused its queue" from "this link doesn't exist." The owner-facing `GET dashboard/salons/:salonId/queue-qr` (renders a client-side SVG via `qrcode.react` — no server-side image generation, no per-scan cost) uses the same `SalonAccessService.assertAccess` every other dashboard salon route already uses, so an owner can never retrieve another salon's QR.

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
