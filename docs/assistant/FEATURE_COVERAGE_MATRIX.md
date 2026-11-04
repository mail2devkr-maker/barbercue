# FastQue Assistant: feature coverage matrix (issue #362)

Branch `claude/fastque-action-assistant-362`, Draft PR #363. **Nothing here is deployed.**

**How to read the matrix**
- **Test** is where each action is proven on a throwaway Postgres:
  - `P1` = `test/assistant-actions.e2e-spec.ts`
  - `P2` = `test/assistant-phase2.e2e-spec.ts`
  - `B3` = `test/assistant-batch3.e2e-spec.ts`
  - `B4` = `test/assistant-batch4.e2e-spec.ts`
  - `B5` = `test/assistant-batch5.e2e-spec.ts`
  - `B6` = `test/assistant-batch6.e2e-spec.ts`
  - `B7` = `test/assistant-batch7.e2e-spec.ts`
  - `B8` = `test/assistant-batch8.e2e-spec.ts`
  - `B9` = `test/assistant-batch9.e2e-spec.ts`
  - `B11` = `test/assistant-batch11.e2e-spec.ts` (batch 10 was UI only)
  - `B12` = `test/assistant-batch12.e2e-spec.ts`
  - Every suite also passes twice in a row in one shared database, as CI's full-suite step runs it.
  - `unit` = parser, interpreter and transcriber specs
- **CI** is the GitHub *Owner Operations Certification* workflow, which runs P1, P2, B3–B9, B11 and B12.
- **Live** and **Physical** are "no" for every row, because the assistant has never been deployed and has never had a real-microphone or real-device test.

All 32 actions share these rules:
- The user, role and shop come only from the session.
- Access is checked at preview **and** again at execute.
- Every write needs an on-screen confirmation, sealed to the user, shop, action, payload and before-state. The seal is single-use and expires after 120 s.
- Every step writes an audit row with no transcript text.
- The screen updates only after the server reports success (`refresh` → the page re-fetches from the API).

## 1. Actions the assistant runs (80)

**Access levels**
- `owner/admin` = `assertOwnerOrAdminAccess` (the shop owner or a delegated platform admin).
- `owner only` = `assertOwnerAccess`: the shop's actual owner, no delegated admin (offers, as in FastQue).
- `platform` = a platform role **and** an ADMIN-audience (TOTP) session, exactly like FastQue's role guard.
- `team/admin` = `assertAccessOrAdminAccess` (owner, the shop's staff, or a delegated platform admin).
- `self` = the signed-in customer's own records only.

| # | Action | Persona | Existing API / service used | Access | Confirm | Example phrases | Test |
|---|---|---|---|---|---|---|---|
| 1 | `staff.list` | Owner, admin | `SalonStaffService.list` | owner/admin | – | "Staff dikhao" | P1 |
| 2 | `staff.add` | Owner, admin | `SalonStaffService.create` (name, mobile; no email invite) | owner/admin | yes | "Ravi ko staff mein add karo" | P1 |
| 3 | `staff.setStatus` | Owner, admin | `SalonStaffService.update{status}` | owner/admin | yes | "Ravi staff ko deactivate karo" | P1 |
| 4 | `staff.rename` | Owner, admin | `SalonStaffService.update{displayName}` | owner/admin | yes | "Ravi staff ka naam Ravi Kumar karo" | P2 |
| 5 | `services.list` | Owner, admin | `SalonServicesService.list` | owner/admin | – | "Services dikhao" | P1 |
| 6 | `services.add` | Owner, admin | `SalonServicesService.create` | owner/admin | yes | "Beard trim service add karo ₹100 20 minute" | P1 |
| 7 | `services.setPrice` | Owner, admin | `SalonServicesService.update{price}`: exact, ±%, ±₹; checks the "from" price | owner/admin | yes | "Haircut ₹200 se ₹150 karo", "Massage price 10% badha do" | P1 (exactly once, stale, replay) |
| 8 | `services.setDuration` | Owner, admin | `SalonServicesService.update{durationMinutes}` | owner/admin | yes | "Haircut 45 minute karo" | P2 |
| 9 | `services.rename` | Owner, admin | `SalonServicesService.update{name}` | owner/admin | yes | "Rename service Facial to Gold Facial" | P2 |
| 10 | `services.archive` | Owner, admin | `SalonServicesService.update{isActive:false}` (archive, restorable) | owner/admin | yes | "Facial service hata do" | P1 |
| 11 | `services.restore` | Owner, admin | `SalonServicesService.update{isActive:true}` | owner/admin | yes | "Facial wapas chalu karo" | unit |
| 12 | `hours.view` | Owner, admin | `SalonOperatingHoursService.list` | owner/admin | – | "Dukan ki timing dikhao" | P2 |
| 13 | `hours.set` | Owner, admin | `SalonOperatingHoursService.set` (whole week, only the named days change) | owner/admin | yes | "Sunday band rakho", "Monday 10 se 8 baje" | P2 (staff, other owner and viewer denied) |
| 14 | `queue.status` | Owner, staff, admin | `QueueService.getDashboardQueue` | team/admin | – | "Aaj ki queue dikhao" | P1 |
| 15 | `queue.callNext` | Owner, staff, admin | `QueueService.call` (lowest waiting position) | team/admin | yes | "Agla customer bulao" | P2 (replay refused) |
| 16 | `queue.markArrived` | Owner, staff, admin | `QueueService.markArrived` | team/admin | yes | "Token 12 aa gaya" | unit |
| 17 | `queue.noShow` | Owner, staff, admin | `QueueService.noShow` | team/admin | yes | "Token 12 no show" | P2 |
| 18 | `queue.cancel` | Owner, staff, admin | `QueueService.cancelByStaff` | team/admin | yes | "Token 4 cancel karo" | P2 (stale refused) |
| 19 | `queue.complete` | Owner, staff, admin | `QueueService.completeSession` (active session only) | team/admin | yes | "Token 4 ho gaya" | unit |
| 20 | `queue.addWalkIn` | Owner, staff, admin | `QueueService.createOperatorEntry` (name and service; no phone without recorded consent) | team/admin | yes | "Walk-in add karo Amit" | P2 |
| 21 | `schedule.view` | Owner, admin | `DashboardBookingsService.list(date)` (phones masked; this list is owner/admin only in FastQue) | owner/admin | – | "Kal ke appointments dikhao" | P2 |
| 22 | `bookings.cancelByShop` | Owner, admin | `ShopBookingActionsService.cancel` (notifies the customer) | owner/admin | yes | "Kal raat 8 baje ka appointment cancel karo" | P2 |
| 23 | `bookings.rescheduleByShop` | Owner, admin | `ShopBookingActionsService.reschedule` | owner/admin | yes | "Kal 7 baje wala appointment 8 baje kar do" | P2 |
| 24 | `customers.find` | Owner, admin | `DashboardCustomersService.list` (phones masked) | owner/admin | – | "Customer Amit dhundo" | P2 (staff denied) |
| 25 | `insights.today` | Owner, admin | `OwnerAssistantService.query` (deterministic) | owner/admin | – | "Aaj ki sales batao" | P1 |
| 26 | `salons.search` | Anyone signed in | `CustomerAssistantSearchService.search` | signed in | – | "Haircut salon dhoondo" | unit |
| 27 | `me.bookings` | Customer | `BookingsService.listMine` | self | – | "Meri bookings dikhao" | P2 (another customer sees none) |
| 28 | `me.book` | Customer | `AvailabilityService.getAvailability` then `BookingsService.create` (idempotency key = confirmation nonce) | self, salon page | yes | "Kal shaam 5 baje haircut book karo" | P2 (exactly once) |
| 29 | `me.rescheduleBooking` | Customer | `AvailabilityService.getAvailability` then `BookingsService.reschedule` | self | yes | "Mera appointment kal 7 baje kar do" | P2 |
| 30 | `me.cancelBooking` | Customer | `BookingsService.cancel` (cancellation policy applies) | self | yes | "Mera appointment cancel karo" | P2 (another customer cannot) |
| 31 | `me.queueStatus` | Customer | `QueueService.getActiveForCustomer` | self | – | "Meri queue ka status batao" | P2 |
| 32 | `me.leaveQueue` | Customer | `QueueService.cancelByCustomer` | self | yes | "Queue chhod do" | P2 |

| 33 | `chairs.list` | Owner, admin | `SalonChairsService.list` | owner/admin | – | "Chairs dikhao" | B3 |
| 34 | `chairs.add` | Owner, admin | `SalonChairsService.create` | owner/admin | yes | "Naya chair add karo Chair 3" | B3 (barber denied) |
| 35 | `chairs.setStatus` | Owner, admin | `SalonChairsService.update{status}`: in use, off, under repair | owner/admin | yes | "Chair 2 maintenance mein daalo" | B3 |
| 36 | `staffHours.view` | Owner, admin | `StaffWorkingHoursService.list` | owner/admin | – | "Ravi staff ki timing dikhao" | B3 |
| 37 | `staffHours.set` | Owner, admin | `StaffWorkingHoursService.set` (whole week; days that followed the shop's hours are shown as becoming fixed) | owner/admin | yes | "Ravi staff ka Sunday off karo" | B3 (barber denied) |
| 38 | `bookings.noShow` | Owner, admin | `BookingNoShowService.markNoShow` (after the arrival grace; the shop's no-show rule applies) | owner/admin | yes | "3 nov 17:05 wala appointment no show" | B3 (barber and other owner denied) |
| 39 | `offers.list` | Owner | `OffersService.listForOwner` | owner only | – | "Offers dikhao" | B3 (barber and platform admin denied) |
| 40 | `offers.publish` | Owner | `OffersService.publish` (public impact, stated in the preview) | owner only | yes | "Diwali offer live karo" | B3 |
| 41 | `offers.pause` | Owner | `OffersService.pause` | owner only | yes | "Diwali offer pause karo" | B3 |
| 42 | `reviews.list` | Owner, admin | `DashboardReviewsService.list` | owner/admin | – | "Reviews dikhao" | B3 |
| 43 | `reviews.reply` | Owner, admin | `DashboardReviewsService.respond` (the owner's own words; the latest unanswered review unless one is named) | owner/admin | yes | "Review ka jawab do: Thank you!" | B3 (no second reply) |
| 44 | `invoices.list` | Owner, admin | `InvoicesService.list` (read) | owner/admin | – | "Invoices dikhao" | B3 |
| 45 | `revenue.report` | Owner, admin | `RevenueReportService.getReport` (this week or this month; read) | owner/admin | – | "Is hafte ki sales report" | B3 (barber and customer denied) |
| 46 | `notifications.list` | Everyone | `NotificationsService.listMine` and `unreadCount` (own only) | signed in | – | "Notifications dikhao" | B3 |
| 47 | `notifications.readAll` | Everyone | `NotificationsService.markAllRead` (own only) | signed in | yes | "Sab notifications read karo" | B3 (another user's unread untouched) |
| 48 | `me.joinQueue` | Customer | `QueueService.joinWalkIn` on the salon page (a mobile number is asked for first) | self | yes | "Mujhe queue mein lagao haircut" | B3 (no double join) |
| 49 | `me.favorites` | Customer | `FavoritesService.list` | self | – | "Meri favorite salons dikhao" | B3 |
| 50 | `me.favoriteAdd` | Customer | `FavoritesService.add` (salon page) | self | yes | "Is salon ko favorite karo" | B3 (owner denied) |
| 51 | `me.favoriteRemove` | Customer | `FavoritesService.remove` | self | yes | "Favorite se hatao" | B3 |
| 52 | `me.invoices` | Customer | `InvoicesService.listMine` | self | – | "Mere bills dikhao" | B3 |
| 53 | `admin.overview` | Platform admin, co-founder, viewer | `AdminExecutiveOverviewService.getOverview` (last 30 days; read) | platform | – | "Platform overview dikhao" | B3 (wrong audience and shop owner denied) |
| 54 | `admin.shopStatus` | Platform admin, co-founder, viewer | `AdminShopStatusService.getStatus` (read) | platform | – | "Kitni shops open hain" | B3 (viewer read-only) |
| 55 | `queue.assign` | Owner, staff, admin | `QueueService.assign` with `startService:false` — **never picks**: both barber and chair must be named or tapped from the offered free pairs | team/admin | yes | "Token 5 Ravi Chair 1 assign karo" | B4 (free pairs only; busy barber/chair not offered) |
| 56 | `queue.start` | Owner, staff, admin | `QueueService.startService` (assigned customers only) | team/admin | yes | "Token 5 start karo" | B4 |
| 57 | `bookings.inShop` | Owner, staff, admin | `ShopBookingActionsService.createInShop` — mobile saved **only** when the operator says the customer agreed; idempotency key = confirmation nonce | team/admin | yes | "Amit ke liye kal 5 baje haircut appointment book karo" | B4 (books once; phone not saved without consent) |
| 58 | `bookings.correctCompleted` | Owner, staff, admin | `BookingNoShowService.correctToCompleted` — warns that the no-show charge is removed | team/admin | yes | "5 baje wala appointment no show galat tha, completed karo" | B4 |
| 59 | `offers.create` | Owner | `OffersService.create` — **draft only** (kind OFFER, audience all, 1 use per customer); publishing stays the separate `offers.publish` action; validated with `createOfferSchema` before the preview | owner | yes | "Diwali offer banao 20% off 10 din ke liye" | B5 (draft once; staff and other shop denied; 150% refused) |
| 60 | `offers.edit` | Owner | `OffersService.update` (discount, end date) — a live offer must be paused first, refused in the preview | owner | yes | "Diwali offer 25% karo" | B5 (live offer unchanged) |
| 61 | `salon.profile` | Owner, admin | `SalonProfileService.get` (read) | owner/admin | – | "Dukaan ki profile dikhao" | B5 |
| 62 | `salon.setProfile` | Owner, admin | `SalonProfileService.update` — description, phone, email or address only, with a public-page warning; the shop **name** is not changed by voice | owner/admin | yes | "Dukaan ka description badlo: Best haircuts in town" | B5 (bad email refused; staff and other shop denied) |
| 63 | `me.writeReview` | Customer | `ReviewsService.create` on the customer's own latest unreviewed completed visit | self | yes | "Haircut ko 5 star review do: bahut badiya" | B5 (once per visit) |
| 64 | `me.language` | Everyone signed in | `AuthService.setLanguage` (own account only) | self | yes | "Meri language Hindi karo" | B5 (customer and staff; others unchanged) |
| 65 | `employee.dashboard` | Field employee | `EmployeeService.getDashboard` (own records; read) | employee session | – | "Mera kaam kitna hua" | B6 (counts match own records) |
| 66 | `employee.leads` | Field employee | `EmployeeService.listLeads` with an optional status (new, contacted, interested, demo, onboarded, lost); phone numbers and notes are not read out | employee session | – | "Interested leads dikhao" | B6 (another employee's leads never shown) |
| 67 | `employee.followUps` | Field employee | `EmployeeService.listFollowUps` (open; "overdue" filters to past due) | employee session | – | "Overdue follow ups" | B6 |
| 68 | `employee.visits` | Field employee | `EmployeeService.listVisits` | employee session | – | "Meri visits dikhao" | B6 (wrong session audience and customer denied) |
| 69 | `admin.verificationQueue` | Platform admin, co-founder | `AdminVerificationService.list` (oldest first; optional status) — read only; approve/reject stays in the admin screen; submitter phone/email never shown | platform (same roles as the route) | – | "Pending verification dikhao" | B7 (HR, sales, viewer and non-admin session denied; nothing decided) |
| 70 | `admin.crmOverview` | Platform admin, co-founder, HR, sales | `AdminCrmService.getOverview` (team counts, top employees) | platform (same roles as the route) | – | "Sales team ka kaam dikhao" | B7 (viewer denied) |
| 71 | `employee.logVisit` | Field employee | `EmployeeService.createVisit` on one of the employee's **own** leads (never a new shop name); preview shows the lead-status change the service applies | employee session | yes | "Sharma Salon visit kiya, interested" | B8 (logs once; another employee's lead never offered) |
| 72 | `employee.closeFollowUp` | Field employee | `EmployeeService.updateFollowUp` → COMPLETED with the outcome after a colon | employee session | yes | "Sharma Salon ka follow up ho gaya: demo kal" | B8 |
| 73 | `employee.scheduleFollowUp` | Field employee | `EmployeeService.createFollowUp` on one of the employee's own open leads; India time; past times refused; channel call/WhatsApp/visit/email | employee session | yes | "Sharma Salon ka follow up kal 4 baje lagao" | B9 (once; 16:00 IST) |
| 74 | `me.editReview` | Customer | `ReviewsService.update` on the customer's **own** review (stars and/or comment) | self | yes | "Haircut ka review badlo 4 star" | B9 (another customer's review unchanged) |
| 75 | `admin.shopActivity` | Platform admin, co-founder, HR, sales, viewer | `AdminShopActivityService.getActivity` (today or last 7 days; counts only) | platform (same roles as the route) | – | "Aaj kaunsi shops busy hain" | B9 (non-admin session and customer denied) |
| 76 | `admin.customerAnalytics` | Platform admin, co-founder, viewer (`ADMIN_PERMISSION_ROLES.viewCustomerAnalytics`) | `AdminCustomerAnalyticsService.getOverview` — **KPI figures only**; per-customer rows are never read out | platform | – | "Is mahine kitne naye customers aaye" | B11 (HR and sales denied; no name/email/phone in replies) |
| 77 | `admin.staffAnalytics` | Platform admin, co-founder, HR, viewer (`viewStaffAnalytics`) | `AdminStaffAnalyticsService.getOverview` — KPI figures only | platform | – | "Is hafte staff analytics" | B11 (sales and shop owner denied) |
| 78 | `staff.myWork` | Owner, staff, admin | `StaffWorkService.getMyWork` — the barber's own day: serving now, appointments left, queue they can take; customer phone numbers never read out | team/admin | – | "Mera aaj ka kaam dikhao" | B12 (other shop denied) |
| 79 | `analytics.cancellations` | Owner, admin | `CancellationAnalyticsService.getAnalytics` (7/30/90 days; by who, service, reason; live-queue drops separate) | owner/admin | – | "Is hafte ki cancellations" | B12 (barber and other shop denied) |
| 80 | `me.credits` | Customer | `CustomerCreditsService.getBalance` (own account) | self | – | "Mere credits kitne hain" | B12 (staff denied) |

**Cross-cutting negative tests**
- Another shop's owner is denied, even when the request names the victim shop.
- The platform viewer and customers cannot run shop actions, and each denial is audited.
- An owner cannot use customer self-service.
- The customer screen never reaches a shop-management action.
- A stolen confirmation fails for another account.
- Replayed and stale confirmations are refused.
- A service name written as an instruction stays data.
- Inventory and onboarding requests return UNAVAILABLE.
- A platform role from a non-admin (no TOTP) session cannot read platform figures.
- The platform viewer stays read-only on every screen.

## 2. FastQue capabilities not yet run by the assistant

The full route list is in [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md). Status meanings:
- **NEXT**: safe, an existing API exists, and it can be added in the same pattern.
- **BLOCKED**: needs an owner decision, a release, or a device.
- **NO API**: FastQue has no endpoint for it yet; adding one is backend work outside the assistant.
- **NEVER**: deliberately excluded.

| Area | Persona | Existing API | Status | Blocker or reason |
|---|---|---|---|---|
| Invoices: issue, record payment, void; CSV downloads | Owner | `InvoicesService` | BLOCKED | Money movement; needs owner sign-off on confirmation strength. Lists and the report are done (#44, #45) |
| Offers: description, audience, per-customer limit, birthday/anniversary kinds | Owner | `OffersService.create/update` | NEXT | Draft create and discount/end-date edit are done (#59, #60); the rest stays in the Offers page |
| Salon timezone, payment QR, shop name | Owner | salon-setup services | BLOCKED | Timezone moves every slot and a QR is an image upload; renaming the shop is an owner decision. Profile fields are done (#61, #62) |
| Photos (upload, cover) | Owner | `SalonPhotosService` | BLOCKED | A file upload can't come from a sentence; link to the page |
| Shop open/close for today | Owner | `SalonActivationService` | BLOCKED | Owner decision: an instant public effect needs a stronger confirmation |
| Customer: profile name edit; delete a review; change sign-in email | Customer | auth profile, reviews | NO API (name) / BLOCKED (delete, email) | Write/edit a review and language are done (#63, #64, #74). Deleting is irreversible and the email is the sign-in identity |
| Guest (not signed in) actions | Guest | guest queue routes | BLOCKED | The assistant requires sign-in; guests keep the existing OTP and guest flows |
| Field employee: create or update a lead, onboard a shop | Employee | employee module | NEXT | Reads, visit logging, scheduling and closing follow-ups are done (#65–68, #71–73) on the web employee page. A new lead carries a third party's phone, so it needs the recorded-consent pattern first. Onboarding a shop creates a salon and stays in the guided screen. Android UI is Codex's lane, by API contract only |
| Platform admin: verify/suspend decisions; role changes; exports; per-person analytics rows | Admin | admin module | NEXT (read) / BLOCKED (decisions) | Overview, shop status, verification queue, CRM overview, shop activity and customer/staff analytics figures are done (#53, #54, #69, #70, #75–77). Per-person rows stay on the admin screens. Verify/suspend, roles and exports need owner sign-off |
| Platform viewer | Viewer | admin read endpoints | Partly done | Reads #53 and #54; never writes (tested) |
| Inventory (stock, products, recipes, forecasts) | Owner | R7 #357 routes | BLOCKED | Not deployed; R7 waits on the fresh P1 backup. Returns UNAVAILABLE today |
| Salon onboarding (applications, status) | Employee, admin | R8 #358 routes | BLOCKED | Not deployed; activation and publishing are off by default even after R8 |
| Roles and permissions, payouts, payments, OTP/DLT, bulk delete | – | – | NEVER | High-impact; stays in the dedicated screens |

## 3. Voice, interpreter and privacy (Phase 2)

| Item | State | Notes |
|---|---|---|
| Deterministic Hindi, English, Hinglish rules | Default, tested | ₹0, nothing leaves FastQue. Days (aaj/kal/parso, weekdays in both scripts), times ("shaam 5 baje", "raat 8 baje", "17:30") and tokens |
| Optional self-hosted model (Ollama, llama.cpp, vLLM; Qwen and similar) | Built, **off** | `ASSISTANT_INTERPRETER=local` and a private `ASSISTANT_LOCAL_MODEL_URL`. Either JSON intent mode, or canonical-command mode, where the model only rewrites speech into a fixed command the rules must accept. A failure or timeout falls back to the rules |
| IRISH/Qwen compatibility | Interface only | Usable if IRISH exposes an OpenAI-compatible endpoint on a private address. FastQue never depends on it. IRISH is Codex's |
| Browser speech recognition | On (dev/testing) | A consent notice appears **before** the microphone opens: "in Chrome … your audio is sent to Google". Consent is remembered per browser, with Stop and a "listening" indicator. Typing always works |
| Private speech-to-text (self-hosted whisper.cpp) | Built, **off** | `ASSISTANT_WHISPER_URL` (private host only). `POST /assistant/transcriptions`: up to 2 MB / 30 s, audio types only, kept in memory once and never stored. It has its own consent notice and is preferred automatically when configured |
| Read replies aloud | Opt-in | Browser `speechSynthesis` |
| Paid AI or voice providers | **Not implemented** | No Gemini, OpenAI, cloud speech or paid hosting without owner approval |

## 3b. Accessibility and phones (batch 10)

- The drawer is labelled by its heading. The Assistant button reports `aria-expanded`.
- Focus moves into the message box when the drawer opens and back to the Assistant button when it closes.
- Escape closes the microphone notice first, then the drawer.
- Results stay in a polite live region; refusals and voice errors use `role="alert"`.
- At 600px and below:
  - Buttons, chips and the close control are at least 44px tall.
  - The message box uses a 16px font, so iOS does not zoom.
  - The composer and Assistant button stay clear of the phone's home indicator (safe-area insets).
- Verified in the browser at 375×812: full-width drawer, no horizontal scroll, focus and Escape as described.
- Unit test: `ActionAssistant.test.jsx` (keyboard).

## 4. Screens that update after a confirmed change

| Resource | Screen | Hook |
|---|---|---|
| `services` | Services page | `useAssistantRefresh("services")` |
| `staff` | Staff page | `useAssistantRefresh("staff")` |
| `hours` | Opening hours page | `useAssistantRefresh("hours")` |
| `bookings` | Bookings list and day schedule | `useAssistantRefresh("bookings")` |
| `customers` | Customer directory | `useAssistantRefresh("customers")` |
| `queue` | Live Queue | Server realtime events (existing) |
| `myBookings`, `myQueue` | Customer "My bookings" | `useAssistantRefresh("myBookings" / "myQueue")` |
| `chairs` | Chairs page | `useAssistantRefresh("chairs")` |
| `offers` | Offers workspace | `useAssistantRefresh("offers")` |
| `reviews` | Reviews page | `useAssistantRefresh("reviews")` |
| `favorites` | Favorites page and every heart icon | `useAssistantRefresh("favorites")` and `reloadFavoritesFor` |
| `staffHours`, `notifications` | Staff page, notification bell | Read on next open (no live hook yet) |

The assistant drawer is mounted on every owner and staff shop page (`OwnerShell`), on customer account pages, on each salon's booking page (its `salonId` lets the customer book, join the queue or save a favorite there), and on the platform admin screens (`AdminShell`, platform reads only).
