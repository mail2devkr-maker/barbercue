# FastQue Android 1.0.7 parity audit

Audit baseline: production master `d5295c2d2ca5e25ee8310325b392d79f9e448956`. This matrix describes the current Android 1.0.7 integration candidate, Draft PR #398 at `b3ad672c5c62d8554dad3ed636f98f00327703a8`, which integrates PR #385 (Android 1.0.7/Employee Login/Assistant), PR #389 (QR preview/share), and the GPS/keyboard fixes from PR #379. It is a source/API audit, not authenticated production runtime acceptance or physical-device certification.

Current exact-head CI for PR #398: Owner Operations Certification `41997817094`, Nitesh Admin + Discovery `41997817057`, and Salon Location Verification `41997817058` all completed SUCCESS. The Owner Operations workflow passed mobile typecheck, the 1.0.7 Android / 1.0.6 iOS effective-config assertions, Jest, and Android JavaScript export. JavaScript export is not a native AAB build. The older PR #383 certification entries below remain historical evidence for that exact older head only.

Statuses: **SOURCE** means a native path and current API usage exist; **PARTIAL** means part of the web workflow is present but a material function remains; **GAP** means no equivalent native workflow was found; **PHYSICAL_REQUIRED** means source is present but real-device behavior is not yet verified; **WEB_ONLY** means privileged scope is intentionally excluded pending an explicit mobile authorization.

## Shop Owner — 16 website sections

| # | Website section | Android candidate surface and API | Status / remaining evidence |
|---|---|---|---|
| 1 | Live Queue, arrivals, assign/start/complete, walk-in | `OwnerQueueScreen`; existing salon queue and service-session APIs | SOURCE; PHYSICAL_REQUIRED for queue race/arrival acceptance |
| 2 | Settings | English/Hindi `OwnerSettingsScreen` edits salon name/contact/address/description and explicitly confirms the shop IANA time zone through the existing owner-scoped profile/timezone APIs; `OwnerShopScreen` retains hours, photos and payment QR | PARTIAL; native core profile/timezone flows are source-tested, but complete device acceptance and audit of every web preference remain |
| 3 | Bookings | `OwnerBookingsScreen`, owner booking list/status actions | PARTIAL; web calendar/schedule workflows require separate audit |
| 4 | In-shop appointments | `InShopAppointmentPanel` on Owner Bookings uses the shared in-shop booking schema, active salon services, shop timezone, qualified-staff and availability APIs, customer phone-contact consent, and an idempotency key | SOURCE; synthetic UI/API-contract tests added; authenticated real-shop and physical acceptance pending |
| 5 | Schedule | Shop opening-hours editor plus salon-scoped per-staff weekly-hours editor; no native visual calendar/day planner | PARTIAL; owner weekly hours are now editable in native UI, while calendar scheduling remains absent |
| 6 | Customers | `OwnerCustomersScreen` and detail/history APIs | SOURCE; PHYSICAL_REQUIRED |
| 7 | Analytics/revenue | New `OwnerBusinessScreen` consumes owner analytics and recorded revenue APIs | PARTIAL; service/staff breakdown and recorded daily/weekly/monthly summaries shown; custom date exports remain absent |
| 8 | Cancellations/no-shows | New owner cancellation panel consumes `analytics/cancellations` and distinguishes Live Queue outcomes | SOURCE for report; booking-level charge management still requires review |
| 9 | Invoices/download/billing | New center lists invoices, opens details, and lists recorded payments | PARTIAL; PDF download, billing-profile editing, invoice creation and payment/refund recording not implemented here |
| 10 | Reviews | New center lists owner reviews and sends server-validated owner responses | SOURCE for FastQue reviews; physical and authenticated owner acceptance pending |
| 11 | Verification | New center reads/submits owner evidence notes and HTTPS links | PARTIAL; administrative review decision is web-only and no native evidence upload is claimed |
| 12 | Services/categories | `OwnerShopScreen` service management now loads the existing salon-scoped category tree and lets owners choose stable category/subcategory IDs when creating or editing services; legacy free-text categories remain available when the tree endpoint is unavailable | PARTIAL; category-tree assignment is covered, but category-tree CRUD, all-service variants/qualification behavior and physical validation remain |
| 13 | Opening hours | Existing `HoursEditor` | SOURCE; PHYSICAL_REQUIRED |
| 14 | Shop photos | Existing `PhotosSection` | SOURCE for current hosted-photo workflow; upload/edit behavior must be verified on device |
| 15 | Chairs/SPA beds | Existing chair management | PARTIAL; verify chair types and occupancy conflict behaviors on device |
| 16 | Staff management | Existing roster/add flow, salon-scoped staff profile editing, and per-staff weekly working-hours editor | PARTIAL; phone/email linking, qualifications, full access management, and visual schedule planning are not fully mirrored |

### Other owner capabilities

| Capability | Android status | Evidence / gap |
|---|---|---|
| Shop switcher | SOURCE | Owner salon context verifies workplaces and scopes selection; multi-shop device acceptance pending |
| Owner onboarding | SOURCE | Existing native onboarding and registration routes; production acceptance pending |
| Shop profile and notifications | PARTIAL | Native profile fields and explicit time-zone confirmation are now implemented; compare remaining owner preferences and verify on device |
| Payment QR | SOURCE | Existing `PaymentQrSection` manages shop payment QR; it is not a printable public shop poster |
| Public shop QR poster preview/download with long names | PARTIAL | Owner-only native screen previews the backend's canonical HTTPS salon link using native square `View` modules (font-independent rendering) and shares that link. The renderer has a focused component test, but a successful scan on a real S20 FE is still required. Printable/downloadable poster export remains unavailable in this candidate. |
| Inventory | PARTIAL | New native `OwnerInventoryScreen` uses the R7 owner/salon-scoped report, product listing/search/pagination, low-stock filter, product creation, idempotent opening/purchase/adjustment movements, and movement history APIs. Backend enforces owner/admin authorization and salon scope. Exact-head UI/API tests and authenticated runtime/device acceptance remain pending; supplier/category/forecast workflows are not fully represented |
| Offers/promotions | PARTIAL | Capability-gated center supports existing offer publish/pause, creating Draft offers, backend price preview and editing Draft/Paused offers; writes use idempotency keys |

| FastQue Assistant | SOURCE / BACKEND_GATED / PHYSICAL_REQUIRED | PR #385 adds role-aware customer, salon owner/staff, and field-employee native entry points; known native navigation; read-result rendering; proposed write previews; and explicit confirmation through the existing server confirmation endpoint. High-risk changes require a separate on-screen acknowledgement, enforced both in the native confirmation handler and by the backend. Server write allowlists remain default-deny. Runtime access depends on deployed backend APIs and authorized flags; no production Assistant action or physical-device flow is certified here. |

## Customer

| Website capability | Android status | Evidence / gap |
|---|---|---|
| Discovery/search, city/service/price sorting and salon details | SOURCE / PHYSICAL_REQUIRED | `SalonSearchScreen` and `nearby-city-fallback`; without an explicit radius, consented GPS can fall back to an unambiguous same-country city search while retaining other filters. Hajipur and other real-phone searches still require device acceptance. |
| Location and distance | PARTIAL / PHYSICAL_REQUIRED | Real Haversine distance is shown only for salons with stored coordinates; missing pins remain unavailable. The latest read-only aggregate recorded 6/107 active salons pinned and 101 without pins. Radius searches stay strict, wrong-country/ambiguous city matches are rejected, and stale requests are guarded. No coordinates or distances are fabricated. |
| Favorites/offers | PARTIAL | Existing discovery/favorites support; offer parity depends on enabled production capability and customer-facing availability |
| Google and +91 SMS OTP login | SOURCE / BACKEND_DEPENDENCY | Existing mobile screens and auth integrations; require production login tests, rate-limit behavior and OTP delivery authorization |
| Booking, multi-service, queue, arrival/cancellation | SOURCE / PHYSICAL_REQUIRED | Existing native booking/queue flows; production-like and device race/reconnect acceptance pending |
| Notifications | SOURCE / PHYSICAL_REQUIRED | Existing push registration and navigation code; verify Android notification permission, foreground/background delivery and taps |
| Keyboard accessibility | SOURCE / PHYSICAL_REQUIRED | PR #379 makes Android shared screens reflow around the keyboard and hides bottom tabs while typing; verify Samsung Keyboard and Gboard on long forms on device |
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

## Historical local verification evidence (PR #367; not the current-master candidate)

- Android release configuration resolves to version/runtime **1.0.7** while iOS is explicitly pinned to its existing **1.0.6** version/runtime; config assertions cover both platform values and identifiers.
- Mobile local full regression: **44 suites / 298 tests passed**, including the taxonomy picker UI and Expo Updates platform-runtime resolver assertions. An earlier local discovery-test timeout did not recur in this complete run.
- Shared package: **26 suites / 500 tests passed**; TypeScript build passed.
- Mobile TypeScript: passed.
- Owner Business center and taxonomy focused tests: **14/14 passed** locally, covering recorded-versus-estimated revenue, shop-local date filtering, fail-closed offers, Draft create/preview/edit, review responses, salon-switch clearing, stable service category selection, and taxonomy payload helpers.
- Expo platform runtime resolver suite: **13/13 passed**; the SDK 57 resolver reports Android `1.0.7` and iOS `1.0.6`.
- Owner settings tests: **5/5 passed**; validate selected-salon reads, shared-schema rejection, profile updates, explicit timezone confirmation, stale-data clearing on salon switch and Hindi labels.
- Staff profile editing tests: **3/3 passed**; validate salon-scoped name/bio/experience updates, schema rejection, and Hindi labels. Staff access revocation and employment status are not changed by this editor.
- Android JavaScript export: passed after the parity increment (1,212 modules; approximately 3.4 MB Hermes bundle).
- Expo Android prebuild: passed and generated the native project in this isolated worktree.
- Android Gradle/AAB: not run. This runner has no Android SDK (`ANDROID_HOME` and `ANDROID_SDK_ROOT` are unset and the checked SDK paths are absent). EAS cloud version/build queries are also blocked by DNS (`api.expo.dev` resolves with `ENOTFOUND`). No cloud build was started.
- ADB physical-device check: blocked because the local ADB daemon could not start (`could not read ok from ADB Server`). No device was installed, modified, or reset by this check.
- EAS remote versionCode, production signing and Play account access remain unverified; the config uses the last verified local seed `17` with EAS remote auto-increment, but the next value is not claimed here.



## Superseded integration evidence — PR #367

PR #367's exact head `41dc54d4efcdfb4013312c23e00666d3e1141f09` was certified against master `94ef6c1cfb26da9f1535d44a94284d67e3234548` by runs 41808853743, 41808853735 and 41808853825. This evidence remains valid for that tree but does not certify an integration with the current master.

## Current mobile integration candidate — PR #385

The current isolated source starts from the PR #383 Android 1.0.7/GPS/keyboard candidate and incorporates production master `98c724cc56402fafd679ec0f6c8d1e17ce86421b`, including the backend Assistant write-confirmation and role-consistency changes. Mobile Assistant high-risk confirmation sends `acknowledged: true` only after the user checks the native acknowledgement control. The backend independently enforces the acknowledgement and keeps writes denied unless the relevant action and salon are allowlisted.

Current local verification on this candidate: mobile TypeScript passed; mobile Jest passed (51 suites / 327 tests); Assistant safety tests passed again after the explicit acknowledgement guard (1 suite / 7 tests); shared Jest passed (29 suites / 527 tests); Android and iOS Expo JavaScript exports passed (1,226 and 1,230 modules respectively). Exact-head CI is required after the source is pushed. No EAS build, store upload, production runtime, or physical-device acceptance is claimed.

## Previous Android 1.0.7 candidate — PR #369 (preserved)

Branch: `codex/android-107-ai-integration-20261104`  
PR: #369 (OPEN / DRAFT)  
Exact head: `431f011c5d0c24dab6554f0d9544c650c05c89d1`  
Base master: `f0aa6acb3028ad24352b7225180c7ae88f67b3d7`

The candidate preserves the merged Assistant backend/web source and R7 inventory APIs from current master, carries the reviewed mobile changes from PRs #361/#364/#367, and adds native Inventory Management. PRs #361/#364/#367 remain separate Drafts. This is not 100% parity: the table above marks remaining sections PARTIAL/GAP.

Exact-head GitHub certification passed:
- Owner Operations Certification [run 41823467171](https://github.com/mail2devkr-maker/barbercue/actions/runs/41823467171): Android config validation, TypeScript, **47 Jest suites / 306 tests passed**, Android JavaScript export (1,219 modules); web TypeScript and production build passed; disposable PostgreSQL migrations and E2E passed. Baseline comparison reported 3 known backend unit failures, 18 known backend E2E failures, and 14 known web test failures, with **zero new failures**. The run also reported 85 table/sequence fingerprints matching and schema, indexes, constraints, triggers and financial guards verified on its disposable database.
- Nitesh Admin + Discovery [run 41823467238](https://github.com/mail2devkr-maker/barbercue/actions/runs/41823467238): backend, web and mobile jobs passed; focused mobile discovery tests **7/7** and Android JS export passed.
- Salon Location Verification [run 41823467047](https://github.com/mail2devkr-maker/barbercue/actions/runs/41823467047): full migration chain/checksums/schema drift checks passed; authenticated disposable-PostgreSQL location review **5/5** passed.

The configuration check resolves Android version/runtime to **1.0.7**, iOS version/runtime to **1.0.6**, package to `com.dcw.fastque`, local versionCode seed **17**, and remote EAS auto-increment. The Android internal profile is configured for a store AAB, uses the isolated preview update channel, and targets Play internal track as a draft. This verifies repository configuration only; EAS's remote next versionCode, account authentication, signing readiness and build allowance are not verified by GitHub CI.

Release gates still open:
- No native signed AAB was built; remote EAS/build/signing verification is unavailable from this session.
- No Google Play upload, OTA publication, master merge, production deployment, or database change occurred.
- Physical Galaxy S20 FE acceptance is not certified; ADB/UI host access was unavailable in this session.
- Owner/customer/employee authenticated runtime acceptance and parity rows marked PARTIAL/GAP remain open.

No production action was authorized or claimed for PR #369.

## Current combined Android GPS/keyboard integration candidate — PR #383

Branch: `codex/fastque-mobile-overnight-20261104`  
PR: #383 (OPEN / DRAFT)
Exact head: `565334f2a3ed151ada72e0d6ab71f7fb9b69492f`
Base production master: `90651cb3c32251739d8ab4b559f98e8347dab0c6`  
Source: reviewed PR #369 HEAD `431f011c5d0c24dab6554f0d9544c650c05c89d1` plus reviewed PR #379 HEAD `8cc9f53af977d92907dfe6e441c28afa2cff64cc`. Both were integrated conflict-free; source PRs #369 and #379 remain unchanged and Draft.

The source keeps package `com.dcw.fastque`, resolves Android app/runtime to `1.0.7`, and keeps iOS app/runtime pinned to `1.0.6`. The integration includes Android location fallback, strict-radius behavior, unknown-distance handling, keyboard avoidance and regression tests. It does not change PR #375 or publish an OTA.

Exact-head GitHub CI — all three workflows **SUCCESS**:
- Owner Operations Certification [run 41935875053](https://github.com/mail2devkr-maker/barbercue/actions/runs/41935875053): effective Android/iOS release config passed; mobile TypeScript passed; **49 suites / 317 mobile tests passed**; Android JS export passed (1,222 modules); web typecheck/tests/production build passed; disposable PostgreSQL migration/schema/integration checks passed. Backend baseline comparison recorded 1,989/1,992 unit tests (3 known baseline failures, 0 new) and 301/320 E2E tests (18 known baseline failures, 0 new; 2 baseline suites did not run).
- Nitesh Admin + Discovery [run 41935874882](https://github.com/mail2devkr-maker/barbercue/actions/runs/41935874882): backend, web and mobile jobs passed.
- Salon Location Verification [run 41935874917](https://github.com/mail2devkr-maker/barbercue/actions/runs/41935874917): full disposable migration chain/schema guards and authenticated owner/admin PostgreSQL E2E passed.

The parity matrix above remains honest: several owner flows are PARTIAL, printable public QR poster export and native Assistant are GAP, and owner/customer/employee production-authenticated runtime acceptance is pending. Public shop QR preview/link-share is only source-level in the current candidate until device acceptance. The last cited read-only map-pin aggregate was 6/107 active salons pinned; the other 101 distances remain unavailable until owners provide real coordinates.

Current environment gates: EAS [0m`api.expo.dev`[0m and npm registry DNS resolution failed from this host; EAS account/version/build allowance/signing reads and native AAB build were not available. ADB detected 0 ready, unauthorized or offline devices, so Galaxy S20 FE installation and physical acceptance remain NOT VERIFIED. No Play upload, OTA publication, production deployment/database change, master merge, or public rollout occurred.
