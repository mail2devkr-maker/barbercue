# FastQue live-web to iOS parity checkpoint

Date: 2026-10-27 (IST)

## Evidence boundary

- iOS source base: PR #315, `3e9b533ffeddf7d9c2edc24c1b1cd07bb04990c8` (OPEN, Draft).
- Live web/backend source baseline recorded by Issue #308: `7069b299dab5b58732f630179f1395e267dcae9a`.
- This parity candidate is an uncommitted, isolated worktree based on the PR #315 head. Its local changes have not yet been pushed, reviewed, or run through GitHub CI. A passing unit test or JS export below is not production, TestFlight, or physical-device certification.
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
| Revenue and analytics charts/exports | No dedicated native owner analytics/revenue screen found in navigator | Web has revenue, analytics, cancellations, and export pages. Define the required mobile scope and implement a native read-only surface using existing authorized APIs; validate arithmetic/timezone. | Missing launch parity; BLOCKED pending implementation and review |
| Owner invoices and recorded payment/refund history | Candidate adds `OwnerInvoicesScreen` / `OwnerInvoiceDetailScreen`; owner-scoped `GET dashboard/salons/:salonId/invoices` APIs | Verify authorized owner can read the selected shop only and that payment status matches persisted records. Invoice issue/void, payment entry, refund, and billing-profile editing are not implemented in this candidate. Never mark paid from QR display. | Candidate read-only source added; local tests pending rerun; production authorization NOT VERIFIED; write workflows remain missing |
| Inventory and stock history | No native inventory routes found | Web has products, purchases, adjustments, reports, suppliers, and stock history. Requires a scoped implementation/API review before claiming parity. | Missing launch parity; BLOCKED |
| Cancellations analytics and owner review management | No dedicated native owner routes found | Web has cancellation analysis and review management. Keep admin/owner RBAC distinct; add only after reviewed scope. | Missing launch parity; BLOCKED |
| Offers, campaign, and promotion management | Native customer offers are not owner campaign management | Owner draft/preview/publish/pause, eligibility, and redemption controls remain web-only. | Missing launch parity; BLOCKED |

## Staff and platform administration

| Persona | Existing native surface | Gap and acceptance test | Current status |
|---|---|---|---|
| Salon staff | `StaffTodayScreen`, staff account/notification surfaces | Verify assigned-work scope, status actions, cross-salon denial, session restore, and push navigation. | Source present; authenticated device acceptance NOT VERIFIED |
| Platform admin | Admin/CRM routes are web-only; no equivalent mobile admin navigator | Treat as intentionally web-only unless the owner approves a mobile admin scope; do not grant owner/staff sessions admin access. | No mobile parity claimed; production RBAC NOT VERIFIED |
| Language, accessibility, responsive/device behavior | Native language context, React Native layout and accessibility labels | Run VoiceOver, Dynamic Type, reduced motion, permission-denied, small-screen and iPad checks on real hardware. | Partial source; physical accessibility certification NOT VERIFIED |

## Candidate change and test record

- Adds customer-facing public Offers browsing, offer-ID handoff into the existing server-validated booking request, customer-scoped invoice list/detail, and owner-scoped read-only invoice/payment history.
- Does not change backend source, database schema, Expo native modules, Android configuration, production services, or customer data.
- Focused mobile tests: 4 suites / 10 tests PASS after adding salon-scoped owner invoice read-only coverage.
- Full mobile Jest: 36 suites / 256 tests PASS.
- Mobile TypeScript check: PASS.
- iOS JavaScript export: PASS (Metro export only; not a signed native build).
- `git diff --check`: PASS on the code diff before the parity document was added; rerun before commit.
- Exact-head GitHub CI for this parity candidate: NOT RUN (not pushed).
- Native iOS simulator CI exists separately on PR #315 and passed there; it does not certify these new local screens.
- Signed production IPA, App Store Connect upload, TestFlight, physical iPhone, App Review, and public listing: NOT VERIFIED / NOT DONE.

## Release blockers

1. PR #315 remains Draft and includes an additive Apple-auth migration. Its auth/migration integration with relevant backend PRs must be rehearsed on disposable PostgreSQL and deployed compatibly before relying on it in production.
2. The Apple Account Holder must personally accept the pending Apple developer agreement. Do not request or handle account passwords or 2FA codes.
3. Confirm Sign in with Apple capability/profile, correct App Store Connect FastQue record, accurate Individual seller disclosure, and documented right to publish the company's app under that account.
4. Production Google/Apple authentication, verified production API TLS/configuration, and owner/customer role separation need end-to-end acceptance.
5. The owner-facing revenue, billing, inventory, cancellation/review, and offers-management parity gaps above need an explicit reviewed minimum launch scope; this candidate does not claim full owner-dashboard parity.
6. A signed store-distribution build and real iPhone/TestFlight acceptance are still required. Simulator evidence cannot substitute.
7. Finish App Privacy, account deletion, export compliance, support/privacy URLs, review notes, supported-device screenshots, and final seller/listing approval before App Review.

**Decision: NO-GO for App Store submission or public release.** Safe local engineering and review can continue, but the gates above remain open.
