# BarberCue — Project Structure

Status: **V1 decisions finalized.**

## Monorepo layout

```
barbercue/
  apps/
    web/          # Next.js — public SEO site + auth-gated owner/staff/admin dashboard
    mobile/       # Expo/React Native + TypeScript — customer app
    backend/      # NestJS + TypeScript — REST + WebSocket API
  packages/
    shared/       # TS types, zod schemas, enums, pure state-machine helpers
  ARCHITECTURE.md, DATABASE.md, API.md, PAYMENTS.md, STATE_MACHINES.md,
  PROJECT_STRUCTURE.md, DEPLOYMENT.md, TESTING.md
```

No `apps/admin`, no `apps/api` — matches your instruction. The existing prototype (`App.js`, `screens/`, `data/mockData.js`, `components/`) stays untouched at the repo root until `apps/mobile` is scaffolded and the prototype is deliberately migrated into it screen-by-screen (rebuilt, not copy-pasted, per your note that the prototype screens are references).

## apps/backend

NestJS chosen over plain Express because the domain has real structural weight — five auth contexts, salon-scoped RBAC guards, a WebSocket gateway, and several independent business modules (auth, salons, staff, chairs, bookings, queue, payments, reviews, admin) that benefit from NestJS's module boundaries and dependency injection rather than hand-rolled routing. Prisma as the ORM (PostgreSQL, generates TS types consumed internally; `packages/shared` re-exports the DTO *shapes*, not raw Prisma models, so backend internals can change without breaking clients).

```
apps/backend/
  src/
    modules/
      auth/  salons/  staff/  chairs/  bookings/  queue/
      payments/  reviews/  notifications/  admin/  realtime/
    common/        # guards, interceptors, idempotency middleware
    prisma/        # schema.prisma, migrations
```

**`bookings/` (Phase 3B, implemented)**: `bookings.module.ts` registers two controllers —
`booking-info.controller.ts` (`GET salons/:salonId/booking/{staff,availability,cancellation-policy}`,
mounted under a literal `booking` segment specifically to avoid a route-shape collision with
`SalonsController`'s `GET salons/:citySlug/:salonSlug`, see API.md) and `bookings.controller.ts`
(`POST bookings`, `GET bookings/mine`, `GET bookings/:id`, `POST bookings/:id/cancel`) — plus three
services: `availability.service.ts` (the capacity engine, IST-fixed slot generation), `cancellation-policy.service.ts`
(salon-specific row, else platform default), `bookings.service.ts` (create/list/get/cancel,
the per-salon advisory-lock transaction).

**`common/decorators/idempotent.decorator.ts` + `common/interceptors/idempotency.interceptor.ts`
(Phase 3B, implemented)**: the first real use of the `IdempotencyKey` table (defined since Phase
1). Registered globally as an `APP_INTERCEPTOR`; no-ops on any route not marked `@Idempotent()`.

## apps/web

Single Next.js (App Router) app serving both surfaces via route groups, so there is exactly one place business-adjacent UI logic lives for the browser, per "do not duplicate business logic":

```
apps/web/
  app/
    (public)/                 # no auth — SEO-critical, SSR/ISR
      page.tsx                # homepage
      [citySlug]/page.tsx
      [citySlug]/areas/[localitySlug]/page.tsx   # locality page; see "Resolved" note below on why this isn't nested under the salon URL
      [citySlug]/[salonSlug]/page.tsx
      search/page.tsx
      sitemap.ts
      robots.ts
    lib/
      discovery-api.ts        # server-safe fetch client for (public) pages — no "use client", no auth/cookies, wraps fetch with { next: { revalidate } }
    components/discovery/     # SalonCard, ServiceList, OperatingHoursTable, PhotoGallery, ReviewList, Breadcrumbs, JsonLd
    (customer)/                # authenticated customer, not SEO-critical
      account/bookings/page.tsx              # cursor-paginated list + inline cancel (Phase 3B)
      book/layout.tsx                        # RequireRole(CUSTOMER) gate for the whole book/* subtree (Phase 3B)
      book/[salonSlug]/page.tsx              # reads ?city= (Salon.slug is only unique per city) — booking wizard (Phase 3B)
    components/booking/                      # BookingFlow, ServiceStep, StaffStep, DateStep, SlotStep, CancelBookingDialog (Phase 3B)
    lib/idempotency.ts                       # newIdempotencyKey() via crypto.randomUUID() (Phase 3B)
    (dashboard)/                # salon staff/owner/admin, auth-gated
      dashboard/salons/[salonId]/queue/page.tsx
      dashboard/salons/[salonId]/staff/page.tsx
      dashboard/salons/[salonId]/chairs/page.tsx
      dashboard/salons/[salonId]/settings/page.tsx      # payment policy, cancellation policy config
      dashboard/admin/...                               # PLATFORM_ADMIN only — same route group, stricter guard, not a separate app
    proxy.ts                   # role-level gate: CUSTOMER→(customer), SALON_STAFF/SALON_OWNER→(dashboard)/salons/*, PLATFORM_ADMIN→(dashboard)/admin/*
```

*(Implementation note: Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` — same purpose and API, file renamed accordingly. Not an architectural change.)*

Confirmed: the owner dashboard, staff dashboard, and platform admin dashboard are three authorization tiers of the **same** `(dashboard)` route group, not three codebases — a `PLATFORM_ADMIN`-only guard wraps `dashboard/admin/*`, a salon-membership guard (checked against `SalonStaff`) wraps `dashboard/salons/[salonId]/*`. This is what "route-level authorization and separation" means concretely here.

If a `dashboard.barbercue.app` subdomain is wanted later for a cleaner mental model for salon staff, it's a `proxy.ts` hostname rewrite to the same `(dashboard)` route group — not a code restructure.

**V1 dashboard is a responsive web app** — built to work well on phone, tablet, and desktop, since staff/owners will often use it on a phone at the front desk. This is not a decision against ever building a native staff app: see [ARCHITECTURE.md §2](ARCHITECTURE.md#2-application-boundaries) — a future `apps/staff-mobile` would be an additive Expo app consuming the same backend, not a redesign.

### SEO details

- URL scheme: `/{citySlug}` (city hub), `/{citySlug}/{salonSlug}` (salon profile) — flat two-level path, consistent with how customers actually search ("barbershop near [area/city]"), with locality surfaced as a filter/breadcrumb rather than a third path segment, so URLs stay stable if a salon's registered locality changes. A standalone locality page also exists at `/{citySlug}/areas/{localitySlug}` (Phase 3A) for locality-level SEO landing pages — routed under `/areas/` specifically so it can never collide with a salon slug in the same city.
- `generateMetadata` per page: title, description, canonical URL, Open Graph tags including a salon photo.
- JSON-LD: `HairSalon` (schema.org, a `LocalBusiness` subtype) on salon pages — address, `geo`, `openingHoursSpecification` from `OperatingHours`, `aggregateRating` from `Review` data (omitted entirely when there are zero reviews), `priceRange` from `Service`. `BreadcrumbList` on every public page.
- `sitemap.ts` generates entries for all active cities/localities/salons dynamically from the backend (not a static file) — regenerated on each build/ISR cycle.
- `robots.ts` disallows `/account`, `/dashboard`, `/book` (all authenticated, never indexable), `/search?` (query-string search variants only — the bare `/search` page stays crawlable via its own canonical); allows everything else under `(public)`.
- Images: `next/image` against a CDN-backed object storage bucket for salon photos; the backend only ever returns URLs, never serves image bytes itself.
- Public pages fetch only cacheable, non-personalized data server-side; the live wait-time widget (still unbuilt — depends on the queue phase) will be a client component fetching `/salons/:id/queue-status` independently, so a stale ISR cache never shows a stale "3 min wait" — only the static shell (name, services, hours, photos, reviews) is cached. The salon profile page's "Book an appointment" link (Phase 3B) is a plain server-rendered `<Link>` to `/book/{slug}?city={citySlug}` — not a queue-status-dependent client component, since it's a static call-to-action, not live data.

## apps/mobile

Migrated the existing Expo app to TypeScript in place, kept `com.dcw.barbercue` and the existing
color palette as the design-token baseline (`#1C1A17` background, `#EDE6DA` text, `#B0413E`
accent). Existing screens (`RoleSelectScreen`, `ShopListScreen`, etc.) were rebuilt against the
real API/shared types rather than kept as-is — the mock-data wiring was discarded, the UX shape was
a useful starting reference. `expo-secure-store` (via `lib/secure-storage.ts`) backs refresh-token
persistence, per the offline-resilience pattern in [ARCHITECTURE.md](ARCHITECTURE.md).

**Phase 3B added real navigation** — `@react-navigation/native` + `@react-navigation/native-stack`
(installed via `npx expo install` for SDK-57-compatible versions; this is the app's first
navigation library, previously just a two-screen `status === 'authenticated'` ternary in
`App.tsx`), plus `expo-crypto` for `newIdempotencyKey()`.

```
apps/mobile/
  navigation/
    types.ts             # RootStackParamList — booking-flow params carried step-to-step, not re-fetched
    RootNavigator.tsx     # native-stack, mounted only once authenticated
  screens/
    PhoneOtpLoginScreen.tsx, AccountScreen.tsx        # existing (Phase 2), AccountScreen now the hub with "Find a salon"/"My bookings" entry points
    SalonSearchScreen.tsx, SalonProfileScreen.tsx     # public discovery endpoints, no auth
    StaffSelectScreen.tsx, DateSelectScreen.tsx, SlotSelectScreen.tsx, ConfirmBookingScreen.tsx
    MyBookingsScreen.tsx, BookingDetailScreen.tsx     # cursor-paginated list, inline cancel-confirmation panel
  lib/
    idempotency.ts        # newIdempotencyKey() via expo-crypto's randomUUID()
```

**Found and fixed while verifying via `expo start --web`** (this project's standard mobile
verification path, per Phase 1.5's precedent): `react-native`'s `Alert.alert` renders nothing on
React Native Web — it's a real API on iOS/Android but a silent no-op on the web target. The initial
implementation used it to gate booking-creation and cancellation confirmation, which would have
silently done nothing when tested through the web target. Fixed by using in-screen confirmation
state instead (mirroring `apps/web`'s `CancelBookingDialog` — an in-page panel, not a native/browser
dialog), which is portable across native and web and was the actual bug this surfaced.

## packages/shared

```
packages/shared/
  src/
    types/        # Booking, QueueEntry, Salon, ... DTO shapes (hand-written or derived from OpenAPI later)
    schemas/       # zod validation schemas, one per DTO, used by both backend (request validation) and clients (form validation)
    enums/         # BookingStatus, QueueEntryStatus, PaymentStatus, Role, ...
    calc/          # pure functions: cancellationCharge(policy, booking, now), estimatedWait(...)
```

No I/O in this package — no fetch client, no React, no NestJS decorators — so it can be imported unmodified by a Next.js server component, a Next.js client component, an Expo app, and NestJS itself.

## Tooling

- Package manager: **npm workspaces, confirmed for V1.** No migration to pnpm unless a concrete technical problem (not a theoretical one) shows up during implementation — e.g. a real hoisting/dependency-resolution issue across `apps/*` and `packages/shared` that npm workspaces can't resolve. This is a deliberate "don't add tooling risk without a proven need" call, not an oversight.
- Build orchestration: plain npm workspace scripts (`npm run build --workspaces`, etc.) for V1; Turborepo can be layered in later purely for task caching if build times become a real friction point — not required to start.
- Shared TS config (`tsconfig.base.json`) extended by each app.
- Shared ESLint/Prettier config in a `packages/config` (or folded into `packages/shared`) so formatting/lint rules aren't redefined three times.

## Resolved (previously open)

- Package manager: npm workspaces confirmed, pnpm deferred indefinitely absent a concrete problem.
