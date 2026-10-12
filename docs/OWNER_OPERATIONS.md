# Owner operations: dashboard, Live Queue, in-shop appointments, notifications, cancellations and billing

This document describes the owner-operations work (branch `feat/owner-ops-dashboard`, Android in
`feat/owner-ops-mobile`). It is written for reviewers and for whoever operates the release. Nothing in
it has been deployed; no production database, Railway service, EAS channel or Play track was touched.

## 1. What changed, in one page

| Area | Change |
| --- | --- |
| Owner/staff web shell | New light shell (icon rail, grouped sidebar, global search, notification bell, account chip) with one navigation model (`owner-nav.ts`) shared by owner and barber. A test fails if a navigation item points to a page that does not exist. |
| Overview | Reference-style layout: welcome row, ten live operating figures, revenue overview (smooth area chart, tooltip, average line), Top services, Live Queue, Top performer, branches (multi-shop owners only), Day schedule timeline per barber. Every number comes from `GET dashboard/salons/:id/overview`. |
| Live Queue | Four separate places for a visit: Waiting, In service, Completed today, Cancelled & expired. Server-authoritative snapshots with a `revision` so a slow response never rolls the board back; 15 s polling when the socket is down. "Local customer" chair control and the setup wizard's "Finish setup" are gone from the queue. |
| New Live Queue customer / In-shop appointment | Two explicit actions. A queue customer gets a real token and position. An in-shop appointment is a real booking (same availability and capacity checks) for a guest with no FastQue account; a phone number is stored only with recorded consent. |
| Automatic assignment | Optional per shop, **off by default**. It reuses the existing transactional assign path (`QueueService.assign`), never a second engine. |
| Shop cancels / reschedules | Cancels in the same advisory-locked transaction as the customer path, records who cancelled and why, and tells the customer through the delivery ledger (in-app + push). Push failure never rolls the cancellation back. |
| Cancellation analytics | By who cancelled (customer / owner / barber / automatic / FastQue support / not recorded), service, reason and charges; Live Queue outcomes reported separately. |
| Barbers | "My day" with Complete service, take-next, own appointments; owner can remove / restore a barber's login access (history is kept). |
| Billing | Invoices from completed services at their real prices, payments recorded by the shop, refunds, void, billing profile (GSTIN/tax only if the owner enters them), PDF with FastQue branding, customer "My invoices". |
| Customer app | "Call shop" (only if the owner chose to publish the number), "My invoices", notices when the shop cancels or moves an appointment. |
| Android | Owner overview, Live Queue board, in-shop appointments, reschedule/cancel, invoices, billing profile, cancellations, barber My day, access controls, customer Call shop and My invoices. |

## 2. Data model and migration safety

Two migrations, both additive:

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

* Upgrade test: a database at the pre-change schema with legacy bookings (APP, WEB and `WALK_IN`), queue entries, a salon and staff was upgraded; the md5 fingerprints of `bookings`, `queue_entries` and `salons` were identical before and after; legacy rows read `showPhoneToCustomers = true`, `queueAutoAssignEnabled = false`, `guestContactConsent = false`, no cancellation actor, no revoked staff. The two migrations ran in about 0.2 s and 0.4 s.
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
* **Automatic assignment starts the service.** `assign()` is "start of service", so the setting is opt-in, only seats customers marked as in the shop, respects a chosen barber, never double-books a barber or a chair, and returns plain-language reasons for anyone left waiting.
* **Payment QR wording.** Master treats the QR as optional for online bookings. The UI now says so ("Online Booking Payment QR"), says it is never needed for Live Queue or in-shop customers, and says a QR on screen is not proof of payment.
* **GST.** Tax appears only if the owner enters a rate; a GSTIN is validated and printed only if entered. Nothing is invented.

## 5. Android

Android reuses the same endpoints. Differences from the website, on purpose:

* Invoices can be viewed, paid/refunded/voided and **shared as a plain-text summary**; the PDF is available on the website. Handling PDF files on Android would need a native sharing module and a new native build, which is outside this change.
* Live Queue is a grouped board (Waiting, In service, collapsible Completed and Cancelled & expired) rather than tabs, to stay compatible with the existing queue tests and one-handed use.
* Hindi: the section labels and corrected wording are translated; the new screens' body text is English and still needs translation.

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
* Automatic assignment is off by default by design.
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
3. Leave `queueAutoAssignEnabled` off; owners switch it on per shop.
4. Android: build a new binary / OTA only after the owner authorises it; physical-device verification is still required.
