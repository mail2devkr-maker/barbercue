# FastQue Android 1.0.7 parity audit

Audit baseline: production website source at master `f4f15e986efb98ac0cf716ccd9e4683097f0c755`; mobile source is Draft PR #364 stacked on the certified Employee Login PR #361 (`2824568331cf4ae6631d26f387b9971779da4db8`). This is a source/API audit. It is not authenticated production browser acceptance or physical-device certification.

Statuses: **SOURCE** means a native path and current API usage exist; **PARTIAL** means part of the web workflow is present but a material function remains; **GAP** means no equivalent native workflow was found; **PHYSICAL_REQUIRED** means source is present but real-device behavior is not yet verified; **WEB_ONLY** means privileged scope is intentionally excluded pending an explicit mobile authorization.

## Shop Owner — 16 website sections

| # | Website section | Android candidate surface and API | Status / remaining evidence |
|---|---|---|---|
| 1 | Live Queue, arrivals, assign/start/complete, walk-in | `OwnerQueueScreen`; existing salon queue and service-session APIs | SOURCE; PHYSICAL_REQUIRED for queue race/arrival acceptance |
| 2 | Settings | English/Hindi `OwnerSettingsScreen` edits salon name/contact/address/description and explicitly confirms the shop IANA time zone through the existing owner-scoped profile/timezone APIs; `OwnerShopScreen` retains hours, photos and payment QR | PARTIAL; native core profile/timezone flows are source-tested, but complete device acceptance and audit of every web preference remain |
| 3 | Bookings | `OwnerBookingsScreen`, owner booking list/status actions | PARTIAL; web calendar/schedule workflows require separate audit |
| 4 | In-shop appointments | `InShopAppointmentPanel` on Owner Bookings uses the shared in-shop booking schema, active salon services, shop timezone, qualified-staff and availability APIs, customer phone-contact consent, and an idempotency key | SOURCE; synthetic UI/API-contract tests added; authenticated real-shop and physical acceptance pending |
| 5 | Schedule | Booking list plus opening-hours editor; no native calendar/per-staff schedule planner | PARTIAL |
| 6 | Customers | `OwnerCustomersScreen` and detail/history APIs | SOURCE; PHYSICAL_REQUIRED |
| 7 | Analytics/revenue | New `OwnerBusinessScreen` consumes owner analytics and recorded revenue APIs | PARTIAL; service/staff breakdown and recorded daily/weekly/monthly summaries shown; custom date exports remain absent |
| 8 | Cancellations/no-shows | New owner cancellation panel consumes `analytics/cancellations` and distinguishes Live Queue outcomes | SOURCE for report; booking-level charge management still requires review |
| 9 | Invoices/download/billing | New center lists invoices, opens details, and lists recorded payments | PARTIAL; PDF download, billing-profile editing, invoice creation and payment/refund recording not implemented here |
| 10 | Reviews | New center lists owner reviews and sends server-validated owner responses | SOURCE for FastQue reviews; physical and authenticated owner acceptance pending |
| 11 | Verification | New center reads/submits owner evidence notes and HTTPS links | PARTIAL; administrative review decision is web-only and no native evidence upload is claimed |
| 12 | Services/categories | Existing `OwnerShopScreen` service management | PARTIAL; category-tree parity and all-service variants/qualification behavior require a dedicated audit |
| 13 | Opening hours | Existing `HoursEditor` | SOURCE; PHYSICAL_REQUIRED |
| 14 | Shop photos | Existing `PhotosSection` | SOURCE for current hosted-photo workflow; upload/edit behavior must be verified on device |
| 15 | Chairs/SPA beds | Existing chair management | PARTIAL; verify chair types and occupancy conflict behaviors on device |
| 16 | Staff management | Existing roster/add flow plus salon-scoped editing of display name, bio and years of experience using the deployed staff PATCH API | PARTIAL; phone/email linking, qualifications, working schedules and a complete access-management workflow are not fully mirrored |

### Other owner capabilities

| Capability | Android status | Evidence / gap |
|---|---|---|
| Shop switcher | SOURCE | Owner salon context verifies workplaces and scopes selection; multi-shop device acceptance pending |
| Owner onboarding | SOURCE | Existing native onboarding and registration routes; production acceptance pending |
| Shop profile and notifications | PARTIAL | Native profile fields and explicit time-zone confirmation are now implemented; compare remaining owner preferences and verify on device |
| Payment QR | SOURCE | Existing `PaymentQrSection` manages shop payment QR; it is not a printable public shop poster |
| Public shop QR poster preview/download with long names | GAP | No equivalent poster design/print/download workflow found |
| Inventory | BLOCKED / PARTIAL | Backend controller exists, but Claude's R7 inventory release is not production-certified; keep UI disabled until capability and production API availability are verified |
| Offers/promotions | PARTIAL | New center reads capability before listing offers and supports publish/pause; creation/preview/edit flows are not implemented in this increment |

## Customer

| Website capability | Android status | Evidence / gap |
|---|---|---|
| Discovery/search, city/service/price sorting and salon details | SOURCE / PHYSICAL_REQUIRED | Existing `SalonSearchScreen` and `SalonProfileScreen`; confirm reported Hajipur distance issue with real coordinates and API response on device |
| Location and distance | PARTIAL | Existing location permission/search flow; accurate nearest-salon behavior and denied-permission recovery require device verification |
| Favorites/offers | PARTIAL | Existing discovery/favorites support; offer parity depends on enabled production capability and customer-facing availability |
| Google and +91 SMS OTP login | SOURCE / BACKEND_DEPENDENCY | Existing mobile screens and auth integrations; require production login tests, rate-limit behavior and OTP delivery authorization |
| Booking, multi-service, queue, arrival/cancellation | SOURCE / PHYSICAL_REQUIRED | Existing native booking/queue flows; production-like and device race/reconnect acceptance pending |
| Notifications | SOURCE / PHYSICAL_REQUIRED | Existing push registration and navigation code; verify Android notification permission, foreground/background delivery and taps |
| Profile, invoices, reviews, account deletion | PARTIAL | Account and customer invoice/API foundations exist; screen-level invoice details and actual account-deletion completion need separate proof |

## Employees, salon staff and privileged web roles

| Role | Android status | Evidence / boundary |
|---|---|---|
| FastQue Field Executive employee | SOURCE / PHYSICAL_REQUIRED | PR #361 supplies dedicated Employee ID/password login, EMPLOYEE-audience/FIELD_EXECUTIVE route guard, dashboard and logout. Exact-head PR CI passed; real production employee credentials/session/API are not physically tested. |
| Salon staff/barber | SOURCE / PHYSICAL_REQUIRED | Existing `StaffNavigator` and own-work flows remain distinct from Field Executive. Role/audience and salon-scoped authorization need device acceptance. |
| Platform Admin / Co-Founder / Viewer | WEB_ONLY | No privileged admin shell is exposed in this candidate. Mobile parity for these roles is excluded pending explicit security/product authorization. |

## Release gates not satisfied by this audit

- Authenticated production owner/customer/employee acceptance.
- Full parity closure for rows marked PARTIAL or GAP, or explicit owner-approved scope exclusions.
- Physical Galaxy S20 FE testing, including upgrade/session retention from the installed version, auth, queue, booking, location, notifications, and QR scan.
- EAS API connectivity and verified remote Android versionCode.
- Signed AAB build, artifact identity/checksum, Play internal-track preflight and upload permission.
- Play data-safety/target SDK/policy review and crash/ANR monitoring plan.

Therefore this matrix does **not** certify 100% website parity or a Play-ready public release.

## Candidate verification evidence

- Android release configuration resolves to version/runtime **1.0.7** while iOS is explicitly pinned to its existing **1.0.6** version/runtime; config assertions cover both platform values and identifiers.
- Mobile local regression: **41 suites / 281 of 282 tests passed**. The unchanged `salon-search-discovery` test `sends the new filters and shows the compared service price and salon type` timed out locally at Jest's 5-second limit both in the full run and isolated run; its source/test files are unchanged from the candidate baseline. Exact-head GitHub CI is the certification gate for the pushed source.
- Shared package: **26 suites / 500 tests passed**; TypeScript build passed.
- Mobile TypeScript: passed.
- Owner Business center focused tests: **5/5 passed**, including shop-local date filtering, fail-closed offers, review responses, and clearing prior-salon data after a failed shop switch.
- Owner settings tests: **5/5 passed**; validate selected-salon reads, shared-schema rejection, profile updates, explicit timezone confirmation, stale-data clearing on salon switch and Hindi labels.
- Staff profile editing tests: **3/3 passed**; validate salon-scoped name/bio/experience updates, schema rejection, and Hindi labels. Staff access revocation and employment status are not changed by this editor.
- Android JavaScript export: passed (1,209 modules; 3.3 MB Hermes bundle).
- Expo Android prebuild: passed and generated the native project in this isolated worktree.
- Android Gradle/AAB: not run. This runner has no Android SDK (`ANDROID_HOME` and `ANDROID_SDK_ROOT` are unset and the checked SDK paths are absent). EAS cloud version/build queries are also blocked by DNS (`api.expo.dev` resolves with `ENOTFOUND`). No cloud build was started.
- ADB physical-device check: blocked because the local ADB daemon could not start (`could not read ok from ADB Server`). No device was installed, modified, or reset by this check.
- EAS remote versionCode, production signing and Play account access remain unverified; the config uses the last verified local seed `17` with EAS remote auto-increment, but the next value is not claimed here.
