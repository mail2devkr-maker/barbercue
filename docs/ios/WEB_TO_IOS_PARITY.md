# FastQue live-web to iOS parity checkpoint

Date: 2026-10-28 (IST)

## Evidence boundary

- iOS source base: PR #315, `3e9b533ffeddf7d9c2edc24c1b1cd07bb04990c8` (OPEN, Draft).
- Parity PR: #331, remote head before this increment `8a2c7115a65c69b068ed706bc7973a7a0b9b9f1f`; Owner Cancellations and Reviews are committed locally at `f16dec41` on the same Draft branch (stacked on #315); push and exact-head CI remain pending.
- Current production master was rechecked at `7069b299dab5b58732f630179f1395e267dcae9a`.
- Isolated worktree: `codex/fastque-ios-parity-20261027`, based on remote PR #331. Generated local export/cache artifacts are preserved and excluded from source changes.
- Exact-head PR #331 CI on `8e1a4d7e2cc07dc293ad7fba1144417a48517f87`: Owner Operations Certification `40557861156` SUCCESS; iOS Simulator Smoke `40557861089` SUCCESS. These do not certify production, TestFlight, or physical-device behavior and do not include the later local inventory increment.
- “Source present” means a native route/component/API call exists; it does not prove the production backend, authentication, or real device flow works.
- Scope is current live website functionality. Unmerged Draft UI work is not counted as a live-web feature or an iOS release dependency.

## Customer and public flows

| Live web flow | Existing native surface / API | Gap and acceptance test | Current status |
|---|---|---|---|
| Salon discovery, city/service filters, location | `SalonSearchScreen`; discovery API | Verify location permission denied/granted, filters, pagination, and search results on a physical iPhone against production HTTPS. | Source present; device/runtime NOT VERIFIED |
| Salon profile, photos, services, staff, reviews | `SalonProfileScreen`, `ReviewPanel`, salon APIs | Verify all image/service variants and review loading against live account-independent data, with no clipping or failed images. | Source present; full live acceptance NOT VERIFIED |
| Appointment booking | Staff/date/slot/confirmation screens; bookings API | Confirm sign-in/session, availability, price authority, idempotency, and actual production booking lifecycle. | Source present; production auth/runtime NOT VERIFIED |
| Booking history, detail, cancellation/reschedule/check-in | `MyBookingsScreen`, `BookingDetailScreen`; booking APIs | Verify every live web-supported action and status transition with a synthetic authorized account; do not alter real customer data. | Source present; complete parity NOT VERIFIED |
| Live Queue, ETA, queue cancellation/status | `QueueScreen`, `QueueStatusPanel`; queue APIs | Verify refresh, ETA, reconnect/retry, cancellation, and arrival/check-in semantics on device. | Source present; runtime NOT VERIFIED |
| Customer profile, credits, notifications, account deletion | Account and Credits screens; account/notification APIs | Verify session restoration/logout, privacy/deletion flow, voice preference persistence, and credits behavior. | Source present; production auth and deletion acceptance NOT VERIFIED |
| Public offers and offer-to-booking | New `OffersScreen`; public `GET offers`; booking sends offer ID only | Verify public offer pagination, expired/eligibility handling, and server-authoritative price/eligibility. | Candidate source added; local tests PASS; production/runtime NOT VERIFIED |
| Customer invoices and recorded payment/refund history | New `MyInvoicesScreen` / `InvoiceDetailScreen`; authenticated `GET invoices/mine` | Verify server-owned customer scope, pagination, payment/refund display, and cross-account denial. PDF sharing is not implemented in this candidate. | Candidate source added; local tests PASS; live authorization NOT VERIFIED |
| Customer reviews | Public review panel on salon profile | Verify submit/edit eligibility only if supported by the live website; confirm abuse controls and account identity. | Partial; no separate review-management parity certification |

## Salon owner flows

| Live web flow | Existing native surface / API | Gap and acceptance test | Current status |
|---|---|---|---|
| Owner overview and operational summary | `OwnerDashboardScreen`; owner-scoped dashboard API | Verify exact shop scope and values using an authorized owner session; test multi-shop selection and refresh. | Source present; production owner authentication NOT VERIFIED |
| Live Queue and booking management | `OwnerQueueScreen`, `OwnerBookingsScreen`; owner APIs | Verify assigned versus in-service transitions, cancellation reasons, concurrency, and notifications. | Source present; authenticated runtime NOT VERIFIED |
| Shop settings, services, chairs, staff, hours, photos, QR | `OwnerShopScreen`, setup sections/catalog picker; owner APIs | Verify CRUD and role authorization without modifying a real shop during acceptance. | Source present; full parity/runtime NOT VERIFIED |
| Owner notifications and arrival/voice preferences | Dashboard account/notifications and `OwnerVoiceSettingsCard` | Verify persistence, notification delivery behavior, and voice ON/OFF on a real device; audible playback is not yet certified. | Source present; device/runtime NOT VERIFIED |
| Revenue and analytics charts/exports | Candidate adds `OwnerAnalyticsScreen` linked from the owner dashboard; it uses the owner-only `GET dashboard/salons/:salonId/analytics?range=today\|7d\|30d` contract and the salon-selected scope | Includes appointment/cancellation/no-show KPIs, daily and service-level listed-price estimates, customer visit counts, and clear non-revenue disclaimer. The screen is read-only; owner revenue reports/exports and full analytics parity remain separate gaps. | Source is on remote PR #331 head `8e1a4d7`; focused tests passed and exact-head Owner Operations + iOS Simulator CI passed; production data/runtime not verified |
| Owner invoices and recorded payment/refund history | Candidate adds `OwnerInvoicesScreen` / `OwnerInvoiceDetailScreen`; owner-scoped `GET dashboard/salons/:salonId/invoices` APIs | Verify authorized owner can read the selected shop only and that payment status matches persisted records. Invoice issue/void, payment entry, refund, and billing-profile editing are not implemented in this candidate. Never mark paid from QR display. | Candidate read-only source; local tests 10/10 PASS and full suite 260/260 PASS; production authorization NOT VERIFIED; write workflows remain missing |
| Inventory and stock history | Candidate increment adds `OwnerInventoryScreen` with salon-scoped report, product/low-stock list, and separately cursor-paged movement history reads | Uses the existing owner/admin-only GET routes; the backend additionally checks owner-or-admin salon access. Cursor pages are de-duplicated, stale responses are ignored after shop changes, errors do not fabricate stock values, and valuation is labeled as an estimate rather than revenue. Product/category/supplier creation, purchases, consumption, and adjustments remain unavailable in native UI. | Local candidate source; focused inventory tests 5/5 PASS, full mobile suite 265/265 PASS, TypeScript and iOS JS export PASS; exact-head CI for this increment pending |
| Cancellations analytics | Current increment adds `OwnerCancellationsScreen` using the existing owner-only `GET dashboard/salons/:salonId/analytics/cancellations` API with 7/30/90-day and actor filters, UNKNOWN attribution, recorded charge summaries, latest booking rows, and separate Live Queue totals | Read-only; does not guess missing historical actors or imply charge display is payment collection. Focused tests cover encoded salon scope, filter query, null rate, attribution, separate queue outcomes, and API errors. Backend authorization/runtime still needs end-to-end production-compatible acceptance. | Current local candidate `f16dec41`: 4 focused tests PASS; full mobile suite 40 suites / 274 tests PASS; TypeScript PASS; iOS JS export PASS (1 bundle / 1,220 modules). Exact-head CI pending push. |
| Owner review management | Current increment adds `OwnerReviewsScreen` for salon-scoped FastQue reviews and public owner replies, plus safe external review-profile links | Customer contact fields are not rendered. Google/Facebook/Instagram remain explicitly link-only/unconnected; reviews are not falsely represented as imported. Profile links pass the shared provider URL validation before opening. | Current local candidate `f16dec41`: 5 focused tests PASS; full mobile suite 40 suites / 274 tests PASS; TypeScript PASS; iOS JS export PASS (1 bundle / 1,220 modules). Exact-head CI pending push. |
| Offers, campaign, and promotion management | Native customer offers are available, but no dedicated native owner campaign-management route has been implemented | Owner draft/preview/publish/pause, eligibility, and redemption controls remain web-only. | Missing launch parity; BLOCKED |

## Staff and platform administration

| Persona | Existing native surface | Gap and acceptance test | Current status |
|---|---|---|---|
| Salon staff | `StaffTodayScreen`, staff account/notification surfaces | Verify assigned-work scope, status actions, cross-salon denial, session restore, and push navigation. | Source present; authenticated device acceptance NOT VERIFIED |
| Platform admin | Admin/CRM routes are web-only; no equivalent mobile admin navigator | Treat as intentionally web-only unless the owner approves a mobile admin scope; do not grant owner/staff sessions admin access. | No mobile parity claimed; production RBAC NOT VERIFIED |
| Language, accessibility, responsive/device behavior | Native language context, React Native layout and accessibility labels | Run VoiceOver, Dynamic Type, reduced motion, permission-denied, small-screen and iPad checks on real hardware. | Partial source; physical accessibility certification NOT VERIFIED |

## Candidate change and test record

- PR #331 adds customer-facing public Offers browsing, offer-ID handoff into the existing server-validated booking request, customer-scoped invoice list/detail, owner-scoped read-only invoice/payment history, and read-only owner analytics/inventory. The current local continuation adds read-only owner cancellation analytics and FastQue review/reply management with external-provider link-only states.
- Does not change backend source, database schema, Expo native modules, Android configuration, production services, or customer data.
- PR #331 previously recorded focused commerce/invoice tests: 4 suites / 10 tests PASS; full mobile Jest: 36 suites / 256 tests PASS; mobile TypeScript: PASS; iOS JS export: PASS (Metro export only).
- Owner Analytics: focused suite 4/4 PASS. On remote head `8e1a4d7`, Owner Operations `40557861156` and iOS Simulator Smoke `40557861089` both passed; the latter is simulator evidence only.
- Owner Inventory increment at `8a2c7115`: focused suite 5/5 PASS; full mobile Jest 38 suites / 265 tests PASS; mobile TypeScript PASS; iOS Expo JavaScript export PASS (1 bundle / 1,218 modules). Exact-head Owner Operations run `40566271721` completed SUCCESS; iOS Simulator Smoke `40566271365` was still in progress at the last status check. Neither check includes later uncommitted changes.
- Owner Cancellations and Reviews are committed locally at `f16dec41` on top of `8a2c7115`: focused suites 2/2 suites / 9 tests PASS; full mobile Jest 40 suites / 274 tests PASS (Jest reports a non-failing open-handle notice after completion); mobile TypeScript PASS; iOS Expo JavaScript export PASS (1 bundle / 1,220 modules). These checks validate JavaScript only, not an iOS native signed build. Exact-head CI is pending until the branch is pushed.
- Current diff whitespace check and staged-diff check are required before commit.
- Signed production IPA, App Store Connect upload, TestFlight, physical iPhone, App Review, and public listing: NOT VERIFIED / NOT DONE.

## Release blockers

1. PR #315 remains Draft and includes an additive Apple-auth migration. Its auth/migration integration with relevant backend PRs must be rehearsed on disposable PostgreSQL and deployed compatibly before relying on it in production.
2. Apple Developer Program Agreement is verified accepted on October 27, 2026; no further agreement action is currently indicated.
3. Confirm Sign in with Apple capability/profile, the correct App Store Connect FastQue record, accurate Individual seller disclosure, and documented right to publish the company's app under that account.
4. Production Google/Apple authentication, verified production API TLS/configuration, and owner/customer role separation need end-to-end acceptance.
5. The owner-facing revenue, billing, inventory, cancellation/review, and offers-management parity gaps above need an explicit reviewed minimum launch scope; this candidate does not claim full owner-dashboard parity.
6. A signed store-distribution build and real iPhone/TestFlight acceptance are still required. Simulator evidence cannot substitute.
7. Finish App Privacy, account deletion, export compliance, support/privacy URLs, review notes, supported-device screenshots, and final seller/listing approval before App Review.

**Decision: NO-GO for App Store submission or public release.** Safe local engineering and review can continue, but the gates above remain open.
