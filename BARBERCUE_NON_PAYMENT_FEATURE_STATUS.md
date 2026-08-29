# BarberCue — Non-Payment Product Completion: Feature Status

Tracks the master non-payment/non-subscription mission. Branch: `claude/owner-bookings-realtime`.
Statuses: `DONE`, `PARTIAL`, `BLOCKED`, `NOT STARTED`. Updated after every phase.

## Phase 0 — Codex reconciliation
**DONE.** `origin/master` verified at `81ad0f7` containing all Codex feature families (six-step
setup, service catalog, barber roster, chair remove/restore, queue reassignment/NEW-badge/chime,
web Owner/Staff Google, photo fallback, Super Admin monitoring).

## Phase 1 — Device-verified mobile Google fix
**DONE.** `49e5ee6` cherry-picked onto this branch as `70d58fe`. Owner/Staff/Customer Google all
device-tested working on the resulting APK (EAS build `26b629c2-891b-4c4e-ade3-6eab994550ab`).

## Phase 1 (mission) — Owner Booking Operations
**DONE.** Commit `03e0b0c`. `GET dashboard/salons/:salonId/bookings[/:id]`, owner-only,
salon-scoped via `SalonAccessService`. Filters: today/upcoming/completed/cancelled/no_show/all +
date range, cursor pagination. `OwnerBookingDetailDto`: reference, customer phone/email, service,
preferred + assigned barber, date/time/duration, status, source, style, price, created/cancelled
timestamps. No online-payment field — `prepaymentRequiredAmount` only (pay-at-shop model). Owner
mobile Bookings tab and Web Bookings page both built on this same contract (commit `c17769d`), plus
a mobile Dashboard summary widget (today/upcoming/completed/cancelled-no-show counts, deep-linking
into filtered tabs).

## Phase 2 (mission) — Realtime Booking Notifications
**DONE.** Commit `03e0b0c` (event emission) + `c17769d` (UI). `booking.created`/`booking.cancelled`
emitted only after transaction commit, ids-only payload, authoritative refetch on receipt. Web +
mobile: popup/toast, NEW badge, chime (web Web Audio API, distinct tone from the queue chime),
voice ("New booking received for {service} at {time}" — no customer PII spoken). Web sound gated
behind an explicit "Booking alerts: Sound ON/OFF" toggle (browser autoplay policy); mobile speaks
immediately (no such restriction), via `expo-speech`. Dedupe: session-scoped `notifiedIds` Set keyed
by booking id — alert fires at most once per id regardless of duplicate/reconnect delivery: the
list refetch itself is unconditional (always reflects server state) but carries no alert. Cancel
gets a quieter toast-only notice.

## Phase 3 — Customer Booking Convenience
**DONE.** Commit `12d8c97`.
- **Reschedule**: `POST bookings/:id/reschedule`, same booking row/id (preserves history), reuses
  create()'s concurrency-safe capacity check + operating-hours validation, no charge computed
  (payment excluded from this mission), `BOOKING_RESCHEDULED` AuditLog entry, `booking.rescheduled`
  realtime event. Web dialog + mobile sheet, both with a lightweight date/slot picker.
- **Rebook**: "Book again" preselects service + preferred barber, customer always explicitly
  repicks date/time — never assumes the old slot is available.
- **Directions**: Google Maps deep link (coordinates when the salon has them, address fallback) —
  no paid Maps SDK.
- **Share**: real Web Share API / RN Share sheet with clipboard fallback, plus a `wa.me` WhatsApp
  deep link (never claims proactive/automatic delivery).

## Phase 4 — GPS / Nearby Discovery
**DONE.** Commit `5a7368a`. Real geolocation permission flow (browser Geolocation API / RN
`expo-location`), haversine distance sort (in-memory, capped candidate batch — no PostGIS
available, so near-me mode is a single unpaginated page rather than a faked cursor over a sort the
DB didn't produce), Open/Closed badges from live OperatingHours. No paid Maps/geocoding SDK.

## Phase 5 — Advanced Smart Queue
**DONE.** Commit `f7af04e`.
- **Arrival window**: `estimatedWaitRangeMinutes` (a proportional +/- band) replaces a falsely
  precise single number on customer-facing queue status.
- **Overrun-aware ETA**: `remainingSessionMinutes` floors at a small fixed tail (5 min) instead of
  0 once a session passes its nominal duration — a documented heuristic (real ML-driven duration
  prediction is Phase 32's job), not a data model.
- **Fresh-on-read**: `getActiveForCustomer`/`getDashboardQueue` recompute ETAs on every read, not
  only after a mutation — an overrunning service no longer leaves a stale number on screen.
- **Turn-approaching / large-swing alerts**: `queue.entry.wait_alert` (ids-only, customer-room
  only), emitted only on a genuine threshold crossing or >=10min swing (`isWaitAlertWorthy`) — web
  gets a chime + banner, mobile gets vibration + speech + banner.
- Booked appointment time (`Booking.slotStart`) vs. current queue ETA remain visually and
  structurally distinct (different screens/DTOs) — not merged into one number anywhere.

## Phase 6 — Owner Capacity Dashboard
**DONE.** Commit `c5485dc`. New `GET dashboard/salons/:salonId/capacity`
(`QueueService.getCapacitySummary`): active/busy/available chairs and staff, current in-service
count, waiting customers, queue size, average estimated wait, today's/upcoming booking counts.
Compact realtime summary strip — web at the top of the live queue page, mobile on the Owner
Dashboard tab. Deliberately small/decision-oriented, not a trend report (that's Phase 9).

## Phase 7 — Barber Working Hours / Skills / Availability
**DONE** (working hours + availability integration) **/ PARTIAL** (mobile UI deferred). Commit
`a2de19d`.
- Staff self-identity gap: resolved earlier (`1056a21`) — `GET dashboard/salons/:salonId/staff/me`.
- Skills/qualifications: already existed pre-mission (`StaffService` join table + owner CRUD) —
  confirmed still correct, no changes needed.
- **New**: `StaffWorkingHours` model (additive migration), owner CRUD at
  `dashboard/salons/:salonId/staff/:staffId/working-hours`, opposite default from OperatingHours
  (unconfigured = unrestricted, not closed).
- **Wired into real availability**: `AvailabilityService.getAvailability` clips the slot grid to
  shop-hours ∩ barber-hours when a specific `preferredStaffId` is requested; re-validated
  authoritatively at `create()`/`reschedule()` time via `assertStaffWithinWorkingHours`. The
  general pool-based capacity model (no specific staffId) is deliberately untouched — a documented
  existing architectural decision (DATABASE.md's soft-preference design), not something this
  mission should silently override.
- Web owner UI: inline per-barber hours editor on the Staff page.
- **Deferred**: mobile working-hours editor UI. The backend contract + web configuration surface
  are complete and load-bearing; a barber can be scheduled correctly today without a native editor.
- **Active/off-duty + temporary-unavailable state**: covered by existing `StaffMemberStatus`
  ACTIVE/INACTIVE (deliberately not expanded to a third enum value — see code comments for why:
  that enum is load-bearing across capacity/dashboard filters and expanding it is a materially
  larger, riskier change than this phase's scope justified).

## Phase 8 — Customer CRM
**DONE** (backend + web) **/ PARTIAL** (mobile UI deferred). Commit `ddf8647`.
`GET dashboard/salons/:salonId/customers[/:customerId]` — total/completed/cancelled/no-show
counts, first/last visit, preferred service/barber where derivable, new/repeat/frequent segment
(purely a completed-visit-count threshold, never inferred from anything about the customer).
Cross-salon isolation via `SalonAccessService.assertAccess` in every query, same as every other
owner dashboard endpoint. Offset-paginated (groupBy results have no row id to cursor over) but the
response shape matches every other dashboard list. Web Customers page under the settings hub nav.
Mobile UI deferred — read-only convenience surface, doesn't block any workflow.

## Phase 9 — Owner Analytics & Reporting
**DONE** (backend + web) **/ PARTIAL** (mobile UI deferred). Commit `50c1317`.
`GET dashboard/salons/:salonId/analytics?range=today|7d|30d|custom` — appointments booked,
completed/cancelled/no-show, walk-ins, new/repeat customers, average queue wait, average service
duration, barber/chair utilization, peak/slow hours (IST), service popularity, estimated service
value. All real DB aggregates, no external analytics provider. `estimatedServiceValue` is
deliberately never labeled revenue anywhere (listed-price x completed bookings, since BarberCue
doesn't process payment). Web page with Today/7d/30d range tabs. Mobile UI deferred.

## Phase 10 — Multi-Branch Experience
**DONE.** Commit `4aaaab1`. New `GET dashboard/overview` — aggregate-only (total/open shops,
today's bookings, active queue) across every salon the caller owns, derived from their own
UserRole rows (no separate authorization check needed). Web `DashboardHeader` gained a cross-shop
switcher (shown when 2+ owned shops) that preserves the current sub-path across shops; shop-list
page shows the aggregate overview and gained missing Bookings/Customers/Analytics card links.
Mobile already had cross-shop switching via `SalonProvider`/`useSalon` (pre-existing).

## Phase 11 — Notification Center
**NOT STARTED.**

## Phase 12 — Appointment Reminders
**NOT STARTED.**

## Phase 13 — Communication Preferences
**NOT STARTED.**

## Phase 14 — Localization & Voice Operations
**NOT STARTED.**

## Phase 15 — Low-Network / Resilience Mode
**NOT STARTED.**

## Phase 16 — Ratings & Reviews
**NOT STARTED.** (Review model already exists in the schema from an earlier phase; this mission's
extensions not yet built.)

## Phase 17 — Barber Professional Profile
**NOT STARTED.**

## Phase 18 — Shop / Barber Verification Foundation
**NOT STARTED.**

## Phase 19 — Support / Disputes
**NOT STARTED.**

## Phase 20 — Happy Hours
**NOT STARTED.**

## Phase 21 — Last-Minute Empty Slot Offers
**NOT STARTED.**

## Phase 22 — Customer-Specific Offers
**NOT STARTED.**

## Phase 23 — Budget Request / Shop Counteroffer
**NOT STARTED.**

## Phase 24 — Coupons / Referrals / Loyalty
**NOT STARTED.**

## Phase 25 — Service Packages / Bundles
**NOT STARTED.**

## Phase 26 — Empty-Chair Marketplace
**NOT STARTED.**

## Phase 27 — Freelance / Temporary Barber Marketplace
**NOT STARTED.**

## Phase 28 — Temp-to-Regular & Training Placement
**NOT STARTED.**

## Phase 29 — Home / Office / Hotel Service Requests
**NOT STARTED.**

## Phase 30 — Wedding / Event Services
**NOT STARTED.**

## Phase 31 — Quotations / Estimates
**NOT STARTED.**

## Phase 32 — AI / Data-Driven Operational Intelligence
**NOT STARTED.**

## Phase 33 — Style Advisor Non-Paid-Provider Completion
**NOT STARTED.** Existing state (unchanged this session): `StyleAdvisorModule` has no configured
`AiImageProvider` — Gemini requires paid billing, no free alternative wired (see
`style-advisor.module.ts` / ARCHITECTURE.md §19). Confirmed still true by this session's own test
run (`GeminiAiImageProvider` 429/500 errors are expected test fixtures, not new regressions).
`VIRTUAL IMAGE GENERATION — BLOCKED BY AI PROVIDER`. Non-image-generation parts of this phase
(catalog, scoring, booking hand-off) not yet extended.

## Phase 34 — Public Availability Experience
**NOT STARTED.**

## Phase 35 — Responsiveness & Accessibility
**PARTIAL.** Every screen built this session (Owner bookings web/mobile, reschedule dialogs) reuses
existing responsive layout primitives (`Screen`, CSS custom properties, flex-wrap chip rows) but has
not had dedicated 375px/tablet/desktop or accessibility passes yet.

## Phase 36 — Security / Authorization Review
**PARTIAL.** Every new endpoint added this session (owner bookings, reschedule, staff/me) has
authorization tests: salon-scoped access via `SalonAccessService.assertAccess`, cross-owner
rejection tests for the owner bookings API. A dedicated cross-cutting review sweeping *all* Codex +
this-session endpoints together has not been run yet.

## Phase 37 — Data Privacy
**DONE for this session's additions.** Realtime payloads remain ids-only (`booking.created`,
`booking.cancelled`, `booking.rescheduled` never carry customer data). Owner booking DTOs expose
only documented safe fields (tested — no hashes/tokens). No new WebSocket broadcast carries PII.

## Phase 38 — Testing Strategy
**ONGOING, per-phase.** Current counts (after Phase 10): backend 514/514 tests passing (42
suites) · shared/backend/web/mobile typecheck clean · web lint clean · web production build (22
static/dynamic pages) · backend production build clean · mobile Expo config resolves cleanly.

## Phase 39 — Browser / Mobile Manual Validation
**NOT STARTED** (beyond Phase 1's real-device Google login test). No manual click-through of the
new booking/reschedule/rebook flows in a live browser/emulator yet this session.

## Phase 40 — Database Migration Rules
**N/A so far.** No new Prisma migrations this session — every field/model added
(`Booking.slotStart/slotEnd` reuse, `AuditLog` reuse) uses existing schema; no new columns were
needed (salonAddress/lat/lng/countryCode are DTO-layer additions reading existing Salon/City
columns, not new tables).

## Phase 41 — Git / Multi-Agent Discipline
**DONE, ongoing.** Exact-path staging throughout (never `git add .`), coherent per-feature-family
commits, regular pushes to `origin/claude/owner-bookings-realtime`.

## Phase 42 — Railway
**No action taken** — no manual deploy triggered, nothing pushed to `master`.

## Phase 43 — Mobile Builds
**Two builds so far**:
1. EAS `26b629c2-891b-4c4e-ade3-6eab994550ab` — Phase 1's Google fix only.
2. EAS `3081905e-e91d-4bbb-9409-85200a3d3b3e` — milestone build after Owner Bookings/realtime/
   reschedule-rebook-directions-share/GPS-near-me/Smart Queue, built from commit `c574aaa`.
   APK: https://expo.dev/artifacts/eas/qbLlnjbGthAt4PLySUCD9F2-0EZXHKW3bL_jPlsz8bA.apk
No new build yet covering Phase 6/7 (capacity dashboard, barber working hours) — both are
backend+web-only changes with no native/mobile-visible surface, so no build was needed for them
specifically. Next milestone build due before this branch is considered integration-ready, or
sooner if an upcoming phase touches mobile native behavior again.

## Phase 44 — This tracker
**DONE** — created this session.

## Phase 45 — External-Service Blocker Policy
Current known blockers (implemented everything possible around each, per policy — not asked
mid-run):
- **Android background push**: `BACKGROUND PUSH BLOCKED — FCM V1 credentials required`. No
  `firebase`/`FCM`/`expo-notifications` anywhere in the repo (confirmed by search). Foreground
  realtime notifications (this session's popup/chime/voice) are real and unblocked.
- **AI image generation** (Style Advisor): `VIRTUAL IMAGE GENERATION — BLOCKED BY AI PROVIDER` — no
  configured `AiImageProvider` (Gemini needs paid billing).
- **Production SMS / WhatsApp Business API**: not configured; this session's WhatsApp integration
  uses only the unauthenticated `wa.me` share deep link, never claims proactive delivery.
- **Third-party identity/background verification**: not configured; Phase 18 (verification
  workflow foundation) not yet built, so not yet a live blocker in this tracker.

---
**Payment/subscription work is explicitly and intentionally excluded from this entire mission** —
see the mission document's "Strictly Out of Scope" section. Nothing in this tracker implies payment
processing exists or is planned as part of this effort.
