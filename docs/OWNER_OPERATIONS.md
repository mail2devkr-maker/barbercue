# Owner operations: dashboard, Live Queue, in-shop appointments, notifications, cancellations and billing

This document describes the owner-operations work (branch `feat/owner-ops-dashboard`, Android in
`feat/owner-ops-mobile`). It is written for reviewers and for whoever operates the release. Nothing in
it has been deployed; no production database, Railway service, EAS channel or Play track was touched.

## 1. What changed, in one page

| Area | Change |
| --- | --- |
| Owner/staff web shell | New light shell (icon rail, grouped sidebar, global search, notification bell, account chip) with one navigation model (`owner-nav.ts`) shared by owner and barber. A test fails if a navigation item points to a page that does not exist. |
| Overview | Reference-style layout: welcome row, ten live operating figures, revenue overview (smooth area chart, tooltip, average line), Top services, Live Queue, Top performer, branches (multi-shop owners only), Day schedule timeline per barber. Every number comes from `GET dashboard/salons/:id/overview`. |
| Live Queue | Five separate places for a visit: Waiting, **Assigned** (a barber and chair are reserved, the service has **not** started), In service, Completed today, Cancelled & expired (see section 12). Server-authoritative snapshots with a `revision` so a slow response never rolls the board back; 15 s polling when the socket is down. "Local customer" chair control and the setup wizard's "Finish setup" are gone from the queue. |
| New Live Queue customer / In-shop appointment | Two explicit actions. A queue customer gets a real token and position. An in-shop appointment is a real booking (same availability and capacity checks) for a guest with no FastQue account; a phone number is stored only with recorded consent. |
| Automatic assignment | **ON by default for every shop** (the owner can switch it off and on; the server stores the choice and every client shows it). It only **assigns** a barber and chair - the barber starts the service. It reuses the existing transactional assign path (`QueueService.assign`), never a second engine. See section 12. |
| Shop cancels / reschedules | Cancels in the same advisory-locked transaction as the customer path, records who cancelled and why, and tells the customer through the delivery ledger (in-app + push). Push failure never rolls the cancellation back. |
| Cancellation analytics | By who cancelled (customer / owner / barber / automatic / FastQue support / not recorded), service, reason and charges; Live Queue outcomes reported separately. |
| Barbers | "My day" with Complete service, take-next, own appointments; owner can remove / restore a barber's login access (history is kept). |
| Billing | Invoices from completed services at their real prices, payments recorded by the shop, refunds, void, billing profile (GSTIN/tax only if the owner enters them), PDF with FastQue branding, customer "My invoices". |
| Customer app | "Call shop" (only if the owner chose to publish the number), "My invoices", notices when the shop cancels or moves an appointment. |
| Android | Owner overview, Live Queue board, in-shop appointments, reschedule/cancel, invoices, billing profile, cancellations, barber My day, access controls, customer Call shop and My invoices. |

## 2. Data model and migration safety

Three migrations, all additive (the third, `20261014000000_owner_ops_assignment_state_default_on`, is described in section 12):

* `20261013000000_owner_ops_enums` - new enum types and `BookingSource.IN_SHOP` (kept separate because PostgreSQL cannot use a new enum value in the transaction that adds it). The persisted `WALK_IN` value is **not renamed**; the word "walk-in" is simply never shown to a user.
* `20261013000100_owner_ops_foundation` - nullable / defaulted columns, the invoicing tables and the notification delivery ledger.

What the migrations do **not** do: drop, rewrite or backfill any existing row, column or index.

The only relaxation of an existing constraint is `bookings.customerId` becoming nullable. A CHECK
constraint allows that **only** for `source = 'IN_SHOP'` rows, so every existing and every online
booking is still guaranteed a customer. The constraint is added `NOT VALID` and then validated, so
the scan does not hold a write-blocking lock on `bookings`.

Database-level guarantees (not just application checks): one ISSUED invoice per booking and per
queue entry (partial unique indexes), unique invoice number and sequence per shop, append-only
payments ledger and frozen invoice money (triggers), non-negative amounts, one delivery row per
event+channel (`dedupeKey`).

Verified on a disposable PostgreSQL (never production):

* Upgrade test: a database at the pre-change schema with legacy bookings (APP, WEB and `WALK_IN`), queue entries, a salon and staff was upgraded; the md5 fingerprints of `bookings`, `queue_entries` and `salons` were identical before and after; legacy rows read `showPhoneToCustomers = true`, `guestContactConsent = false`, no cancellation actor, no revoked staff. (The first two migrations created `queueAutoAssignEnabled` defaulting to OFF; the third moves it to ON without overriding a recorded owner choice - section 12.1.) The migrations ran in well under a second.
* The database then rejected an online booking without a customer and an in-shop booking without a guest name, and accepted a valid in-shop guest booking.
* `prisma migrate diff` after the upgrade shows only the four drift items that already exist on `master` (`push_devices` FK, `booking_services` index, `cities` trigram index, `salons.publicId` default). None come from these migrations.
* The scripts are in this document's section 9 so the check can be repeated.

Rollback: the changes are additive and unused by older code, so rolling the application back needs no
database change. If the columns must be removed later, do it in a separate, reviewed migration after
exporting `invoices`, `invoice_payments` and `notification_deliveries`; do not drop them blindly.

## 3. API

All under `dashboard/salons/:salonId/...` unless noted; role-gated on the server (`SALON_OWNER`,
`SALON_STAFF` where noted, `PLATFORM_ADMIN`). The UI hides what a role cannot do, but the server is the
authority.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET overview`, `GET revenue` | owner | KPIs, revenue series, top services, staff, schedule, queue and cancellation summaries |
| `GET search?q=` | owner, barber | global search (bookings, customers, services, queue, invoices), scoped to the shop |
| `GET analytics/cancellations` | owner | cancellation analytics |
| `POST bookings/in-shop` | owner, barber | in-shop appointment (Idempotency-Key) |
| `POST bookings/:id/cancel`, `POST bookings/:id/reschedule` | owner, barber | shop cancels / moves; customer notified |
| `POST queue/customers` | owner, barber | New Live Queue customer (Idempotency-Key) |
| `POST queue/auto-assign`, `POST dashboard/queue-entries/:id/auto-assign`, `POST queue/take-next` | owner, barber | automatic assignment, one customer, or "take my next" |
| `PATCH queue/settings` | owner | turn automatic assignment on/off |
| `GET staff/me/work` | barber | the barber's own day |
| `POST staff/:id/access/revoke|restore` | owner | remove / restore a barber's login access |
| `PATCH contact-visibility` | owner | publish the shop phone to customers |
| `GET|PUT billing-profile` | owner | seller details printed on invoices |
| `POST invoices`, `GET invoices/:id`, `GET invoices/:id/pdf`, `GET invoices/by-source` | owner, barber | issue (one per visit, idempotent) and read one invoice |
| `GET invoices` | owner | invoice list |
| `POST invoices/:id/payments`, `POST invoices/:id/void` | owner | record a payment/refund the shop received/paid; void |
| `GET payments` | owner | what the shop recorded as received |
| `GET invoices/mine`, `GET invoices/mine/:id[/pdf]` (no `dashboard/`) | any signed-in user | a customer's own invoices (always `customerId = me`) |

Additive fields on existing responses: `OwnerBookingDetailDto.guestName/guestPhone/internalNote/cancelledByActor/cancellationReason`,
`BookingDetailDto.shopPhone`, `SalonStaffDto.accessRevoked`, `DashboardQueueDto.revision/sections/counts/autoAssignEnabled`.

## 4. Behaviour you should know about

* **Revenue is recorded money.** Revenue = payments the shop recorded against an invoice, net of recorded refunds, bucketed in the shop's own timezone. A completed service, a displayed payment QR or a listed price is never revenue; the "estimated value" is shown separately and labelled. Period changes compare like with like (same elapsed time) and show "No earlier data" instead of inventing a percentage.
* **Cancellation attribution is trusted.** The actor is written inside the cancelling transaction. Older rows have no actor and are reported as "Not recorded" (the only inference is "cancelled by the customer's own id" which was always true for old cancellations).
* **Assigning is not starting.** Automatic assignment (ON by default) only reserves a barber and chair for customers who are marked as in the shop, respects a chosen barber, never double-books a barber or a chair, and returns plain-language reasons for anyone left waiting. The barber then presses Start service; only that creates the service session. See section 12.
* **Payment QR wording.** Master treats the QR as optional for online bookings. The UI now says so ("Online Booking Payment QR"), says it is never needed for Live Queue or in-shop customers, and says a QR on screen is not proof of payment.
* **GST.** Tax appears only if the owner enters a rate; a GSTIN is validated and printed only if entered. Nothing is invented.

## 5. Android

Android reuses the same endpoints. Differences from the website, on purpose:

* Invoices can be viewed, paid/refunded/voided and **shared as a plain-text summary**; the PDF is available on the website. Handling PDF files on Android would need a native sharing module and a new native build, which is outside this change.
* Live Queue is a grouped board (Waiting, Assigned, In service, collapsible Completed and Cancelled & expired) rather than tabs, to stay compatible with the existing queue tests and one-handed use.
* Hindi: every control added by the corrective mission (Waiting, Assigned, In service, Start service, Complete service, Automatic assignment, No available staff, Cancel, Reschedule, Invoices, Notifications and the new hints) is translated through `UiStrings`. Some older owner-operations body text added in the first iteration is still English only.

## 6. Design reference

The owner's reference dashboard was compared with real 1440 px screenshots. Matched: light rail with a plum active state, plum active navigation pill, serif-italic name with three headline cards, Balance-statistics-style revenue card with area chart, Top services table with coloured icons, Top performer, branch bars, Day schedule timeline coloured by service category. Intentionally different:

* No AI assistant, Inventory/Products, Orders & Delivery, Payroll, Leave or Salary Rules: FastQue has no such modules and none are faked.
* "Expenses" is replaced by "Awaiting payment" (money still due), which FastQue does track.
* The rail keeps small text labels (usability), the page is full-bleed rather than a rounded card on a backdrop, and the 7-card "today at a glance" strip is added to carry the remaining required figures.

## 7. Known limitations

* No editor for the cancellation-charge policy (the existing policy is shown and enforced).
* Per-barber ratings do not exist (reviews belong to a booking), so the Top performer card shows completed services, not stars.
* The Customers page lists accounts, not walk-in guests.
* "Calendar" is the existing day scheduler.
* Automatic assignment is ON by default; an assigned customer waits for the barber to press Start with no minutes-based timeout (section 12.7).
* The platform's mandatory arrival prompt still appears over the Live Queue; it is unchanged.

## 8. Integration with other work

* PR #190 / #191 (multi-file catalog import, upload fix) are merged into this branch unchanged; there were no file overlaps.
* PR #181 (Android owner parity): the Android branch is stacked on #181's head and does not rewrite it. Merge #181 (and its base #170) first, then the Android PR.
* PR #187 (unified history + reviews, on hold) is untouched. A trial merge shows 9 overlapping files and 15 conflict hunks, all mechanical: `schema.prisma` (5 hunks, different columns on the same models), `bookings.module.ts`, `dashboard-reviews.service.ts`, the web analytics / payment-QR / public shop pages, `OwnerBookingsView.tsx` (2), `SetupChecklist.tsx` (2) and `NotificationBell.tsx`. The schema changes are independent (this work adds columns/tables; #187 adds `Review.queueEntryId` and indexes) and its migration (`20261012120000`) sorts before ours. Whichever merges second resolves the same files.

## 9. How to verify

```bash
npm ci
npm run build:shared
npm run prisma:generate --workspace=@barbercue/backend
npm run typecheck --workspace=@barbercue/backend && npm run typecheck --workspace=@barbercue/web
npm run test --workspace=@barbercue/backend            # 3 time-of-day tests fail on master as well
npm run test --workspace=@barbercue/web                # 2 suites (14 tests) fail on master as well
# end-to-end, disposable local database ONLY (the suite refuses a non-local DATABASE_URL):
DATABASE_URL=postgresql://...@127.0.0.1:<port>/<disposable>?schema=public npx jest --config apps/backend/test/jest-e2e.json --runInBand owner-ops
# Android
cd apps/mobile && npx tsc --noEmit && npx jest && npx expo export --platform android
```

Migration upgrade check: create a database from the migrations before `20261013000000`, insert a few
bookings/queue entries, apply the two owner-ops migrations with `psql -v ON_ERROR_STOP=1`, compare
`md5(string_agg(row::text))` of `bookings`, `queue_entries` and `salons` before and after, then
`prisma migrate diff --from-url <db> --to-schema-datamodel apps/backend/prisma/schema.prisma`.

## 10. Release checklist (not executed - needs the owner's approval)

1. Take a Neon branch / backup of production and rehearse `prisma migrate deploy` on a copy.
2. Deploy the backend first (all new API fields are optional for older clients), then the web app.
3. Automatic assignment is ON by default (migration `20261014000000`): on production the column is created by these migrations, so every existing shop ends ON with an audit row; rehearse on a Neon copy first and tell owners that assigning does not start a service.
4. Android: build a new binary / OTA only after the owner authorises it; physical-device verification is still required.

## 11. Evidence (real renders, local disposable stack)

Real headless-Chrome captures of the website (1440, 820 and 390 px) and real captures from the Android
emulator running a local test build of the Android branch, signed in as the demo owner / barber of a
disposable database. Nothing is mocked: every figure comes from the running backend.

| File | What it shows |
| --- | --- |
| `screenshots/web-owner-overview-1440.jpg` | Overview, desktop |
| `screenshots/web-owner-live-queue-1440.jpg` | Live Queue with the four separate places |
| `screenshots/web-owner-invoices-1440.jpg`, `web-owner-cancellations-1440.jpg` | Billing and cancellation analytics |
| `screenshots/web-owner-overview-tablet-820.jpg`, `web-owner-overview-mobile-390.jpg` | Responsive layouts |
| `screenshots/web-barber-my-day-1440.jpg` | A barber's own "My day" |
| `screenshots/android-owner-dashboard*.jpg` | Android overview |
| `screenshots/android-new-live-queue-customer.jpg` | New Live Queue customer (database-verified: a WALK_IN-source entry created by the operator) |
| `screenshots/android-in-shop-appointment-created.jpg` | In-shop appointment (database-verified: `IN_SHOP`, no account) |
| `screenshots/android-cancellation-outcome.jpg` | Shop cancellation with what the customer was actually told |
| `screenshots/android-invoice-detail.jpg` | Invoice; recording a UPI payment was database-verified |
| `screenshots/android-cancellations.jpg`, `android-barber-my-day.jpg`, `android-barber-access.jpg` | Analytics, barber Complete service (verified), remove/restore access (verified) |

The emulator run also found, and this branch fixes: automatic-assignment refusals were shown as a generic
error instead of the server's reason; the cancellation outcome vanished when the list reloaded (website
and Android); screens opened from another tab hid the Shop hub; invoice dates showed as raw timestamps.
Not verified: a physical phone, the Play-installed build, and push delivery to a real device.

## 12. Corrective mission (13 Oct 2026): automatic assignment ON, assigned is not in service, owner navigation

The owner reviewed this work and set three acceptance conditions. All three are implemented on the
backend, the website and Android; nothing here has been deployed, migrated in production, published as an
OTA or merged.

### 12.1 Automatic staff assignment is ON by default

* `salons.queueAutoAssignEnabled` now defaults to `true` (schema and database). Every shop created from now on starts with it ON; the owner can switch it OFF and ON again. The **server is the source of truth**: `GET dashboard/salons/:id/queue/settings`, the Live Queue snapshot (`autoAssignEnabled`) and the overview (`settings.autoAssignEnabled`) all read the same column, and the website's Shop Settings and Live Queue and Android's Shop Settings and Live Queue show exactly that value. No client invents a default; if a response lacks the field (an older server) the switch is not shown.
* **Transition for existing shops - migration `20261014000000_owner_ops_assignment_state_default_on`.** A boolean cannot tell "never chosen" from "chosen OFF", so the migration uses the audit trail (`QUEUE_AUTO_ASSIGN_ENABLED` / `QUEUE_AUTO_ASSIGN_DISABLED` rows written by every owner change):

  | Situation of an existing shop | Result |
  | --- | --- |
  | value `false` and **no** audit row of an owner choice (the default was never chosen) | set to ON, with a `QUEUE_AUTO_ASSIGN_DEFAULT_APPLIED` audit row |
  | owner switched it OFF (audit `DISABLED`) | **stays OFF** |
  | owner switched it ON then OFF | **stays OFF** |
  | owner switched it ON | stays ON |
  | audit says `ENABLED` but the value is `false` (changed outside the app) | **not overridden** - contradictory evidence is never "fixed" |

  The migration is a **new** file: `20261013000100_owner_ops_foundation` is byte-for-byte unchanged, so its checksum stays valid on any database (development, a staging copy, a Neon branch) that already applied it. On a production database the column does not exist yet, so nobody could have chosen anything and every existing shop ends ON, each with an audit row. `prisma/owner-ops-migration-checksums.json` pins all three owner-operations migrations; editing one later is a reviewed act.
* Migration data-safety proof (`apps/backend/scripts/verify-owner-ops-migrations.sh`, also run by CI): scenario A (the previous draft applied, owners have toggled) and scenario B (production-like, all three at once) on populated disposable databases - queue history fingerprints identical, every case in the table above asserted, the hold indexes accept/reject exactly what they should.

### 12.2 Assigned is not in service

Approved workflow: **WAITING -> ASSIGNED -> IN SERVICE -> COMPLETED.**

* **No new persisted status.** ASSIGNED is a `CALLED` queue entry that has `assignedStaffId` + `assignedChairId` + `assignedAt`, no `serviceStartedAt` and no `ServiceSession`. Reusing the existing enum value means released clients and every historical row keep their meaning (a historical `CALLED` row has no barber, so it reads as "called to the counter" exactly as before). Shared `queuePhaseOf()` and the server's `phase` field expose one word per customer: WAITING, CALLED, ASSIGNED, IN_SERVICE, COMPLETED, NO_SHOW, CANCELLED, EXPIRED.
* **Assigning** (the automatic allocator, "Assign automatically", a barber's "Take next customer", and the manual Assign form of every current client) reserves the barber and chair inside the same transaction and locks as before (`pg_advisory_xact_lock` on the shop and on the chair, the appointment-reservation window check, a conditional claim). It sets `status = CALLED`, `assignedAt`, and nothing else about service: **no `serviceStartedAt`, no session**. It does not mark arrival. The customer's device is told they were called ("Your barber is ready").
* **Starting** - `POST dashboard/queue-entries/:id/start-service` (`QueueService.startService`): the assigned barber (or the owner/delegated admin) starts it. It re-validates the assignment against the current world - barber still on duty, access intact and qualified; chair still active and not occupied by a local customer; no appointment reservation in the way - under the same locks, then atomically claims *exactly that assignment* (`status CALLED` and the same barber and chair), stamps the real `serviceStartedAt`, opens the ACTIVE session and writes a `QUEUE_ENTRY_SERVICE_STARTED` audit row. Another barber is refused (`NOT_YOUR_ASSIGNMENT`, 403); a customer nobody was assigned is refused (`NOT_ASSIGNED`); a double tap is idempotent (an `IN_SERVICE` entry is returned unchanged).
* **Completing** is unchanged (`complete` on the session): the session ends, the barber and chair are released and the allocator is triggered to assign the next present customer.
* **No double assignment.** A barber or chair held by an assigned customer is *busy* for everyone: `ReservationService.isStaffFreeForInterval` (so the booking engine, the availability slot grid and the planner all see it), `countPoolReservations`, the capacity summary, ETA maths, the overview and the board. The database backstops it with two **partial unique indexes** (`queue_entries(assignedStaffId) WHERE status = 'CALLED'`, likewise for the chair). Existing rows cannot violate them: before this release no `CALLED` row ever carried a barber or chair.
* **Release rules** (an assigned customer never stays stuck behind a barber/chair that cannot serve them): the customer goes back to WAITING - keeping their place in line (`joinedAt` untouched) - and the allocator is triggered, when the barber goes off duty, loses login access, is made inactive in the roster, or the chair leaves service (`QueueAssignmentReleaseService`, audit `QUEUE_ASSIGNMENT_RELEASED` with the reason). Cancelling or marking no-show an assigned customer frees both at once and triggers the allocator. The owner reassigns by assigning again.
* **Compatibility decision (please review).** `POST queue-entries/:id/assign` accepts `startService`. Every current first-party client sends `false`. When it is **omitted**, the endpoint keeps its old seat-and-start behaviour, **only** so already-installed apps that predate the Start action (e.g. Play-installed 1.0.x owner apps) are not left with customers they can never start. The automatic allocator, "Assign automatically" and "Take next customer" always assign only. If you prefer, flip the default to assign-only once old apps are retired.
* **Timeouts.** The existing "called customer did not respond" no-show sweep (`queueCallResponseGraceMinutes`) now applies **only** to a CALLED customer with **no** barber; an assigned customer is never auto-marked no-show. The only automatic rule for an assignment is that it does not survive the salon-local day it was made on (then `EXPIRED`, audit `QUEUE_ASSIGNMENT_EXPIRED`). **There is deliberately no minutes-based timeout** - how long a barber may leave an assigned customer unstarted is a product decision still waiting for the owner (see 12.7).

### 12.3 Owner login, Dashboard home and session

* After sign-in, the owner/barber lands on a **resolver** (`/dashboard/salons`): one authorised shop -> that shop's dashboard home at once; several shops -> the shop used last **only if the server still lists it** (the hint is stored per account in the browser and is never an authorisation); otherwise the picker (also at `?select=1`); no shop -> the registration / invitation path (setup is not bypassed). The same rule (`chooseShopHome`, one shared function) is used by Android.
* The shell's logo, the Dashboard entry and the phone bottom bar open the **selected** shop's home. The public header's "Owner dashboard" link opens the last shop's home. A shop the user cannot operate sends them to the picker; nothing of it is shown.
* **Removed:** the rail's public "Site" link; the menu link to `/account/profile` (the customer area is gated to customer accounts and bounced an owner to the **customer login**); Help now opens in a **new tab** so the dashboard session and page stay where they were.
* Session restoration is the existing httpOnly-cookie refresh (unchanged, STAFF audience): a refresh, a new tab, back/forward and a shop switch were driven in a real browser and never reached the public home page; logout ends the session and a dashboard URL asks for sign-in again.
* Android: the selected shop is remembered per account (secure storage) and restored after a relaunch only if the server still lists it; the app shows its loading view while the session restores and routes by role, and Android back from a tab returns to Dashboard, never to a customer screen.

### 12.4 Website and Android changes

* **Website:** the Live Queue has Waiting / **Assigned** / In service / Completed / Cancelled & expired as separate tabs with exact counts; an assigned card shows barber and chair, "Service not started" and **Start service**; reserved chairs and assigned barbers read as such; a waiting customer is labelled "Waiting for available staff" (or "Waiting to be assigned" when automatic assignment is off). Barber "My day" shows an assigned customer with Start service and only shows a Current service once it started. Shop Settings has the Automatic staff assignment switch (server value). The customer ticket says "Your barber is ready".
* **Android:** the same sections, Start service (owner: anyone's; barber: only their own - the server also enforces it), the barber's "Assigned to you" card, the Shop Settings switch, the persisted shop, the customer ticket, and **Hindi** for every new control (`UiStrings`, EN + HI, tested for Devanagari and for kept placeholders). Owner-operations refusals show the server's own precise sentence instead of a generic "no permission".

### 12.5 Certification

* `.github/workflows/owner-operations-certification.yml` runs on every push/PR of these branches: `npm ci`; Prisma validate; **the whole committed migration chain on PostgreSQL 16** (in stages, because two older migrations assume rows an empty database lacks - true on master too); migration checksums; no owner-operations schema drift; the populated-database safety proof; backend unit, **owner-operations e2e (must all pass)**, remaining e2e; web typecheck/tests/build; mobile typecheck/Jest/Android JS export.
* A failing test fails the job unless it is in the **baseline recorded on the base commit** (`docs/owner-operations/baseline/*.json`, produced by `scripts/ci/jest-baseline-record.js` in a clean `npm ci` checkout of master `f2f2b2c6`, each with its cause). Nothing is skipped, and a baseline test still runs and is listed.
* The Android export in CI is a **bundle check only**. It is not evidence of native behaviour; emulator and device results are reported separately and honestly (physical device and Play-installed 1.0.3: **not verified**).

### 12.6 Results

See the final report in the pull request descriptions for exact numbers and the run URLs.

### 12.7 Decisions that still need the owner

1. How long may an assigned customer wait for the barber to press Start before the system acts? Today: never automatically (except at the end of the shop's day). A shorter limit needs a product rule (who is told, whether the customer goes back to Waiting, whether a barber is penalised).
2. Retire the omitted-`startService` compatibility behaviour of `assign` once old Android builds are gone.
3. Whether "Take next customer" should also start the service in one tap (today it assigns, and the barber presses Start).
4. Merge order and a migration rehearsal on a Neon copy; physical-device testing; any Play/OTA step - all unchanged and not done.
