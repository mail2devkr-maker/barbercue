# FastQue Assistant: feature coverage matrix (issue #362)

Branch `claude/fastque-action-assistant-362`, Draft PR #363. **Nothing here is deployed.**

**How to read the matrix**
- **Test** is where each action is proven on a throwaway Postgres:
  - `P1` = `test/assistant-actions.e2e-spec.ts`
  - `P2` = `test/assistant-phase2.e2e-spec.ts`
  - `unit` = parser, interpreter and transcriber specs
- **CI** is the GitHub *Owner Operations Certification* workflow, which runs P1 and P2.
- **Live** and **Physical** are "no" for every row, because the assistant has never been deployed and has never had a real-microphone or real-device test.

All 32 actions share these rules:
- The user, role and shop come only from the session.
- Access is checked at preview **and** again at execute.
- Every write needs an on-screen confirmation, sealed to the user, shop, action, payload and before-state. The seal is single-use and expires after 120 s.
- Every step writes an audit row with no transcript text.
- The screen updates only after the server reports success (`refresh` → the page re-fetches from the API).

## 1. Actions the assistant runs (32)

**Access levels**
- `owner/admin` = `assertOwnerOrAdminAccess` (the shop owner or a delegated platform admin).
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
| 21 | `schedule.view` | Owner, staff, admin | `DashboardBookingsService.list(date)` (phones masked) | team/admin | – | "Kal ke appointments dikhao" | P2 |
| 22 | `bookings.cancelByShop` | Owner, staff, admin | `ShopBookingActionsService.cancel` (notifies the customer) | team/admin | yes | "Kal raat 8 baje ka appointment cancel karo" | P2 |
| 23 | `bookings.rescheduleByShop` | Owner, staff, admin | `ShopBookingActionsService.reschedule` | team/admin | yes | "Kal 7 baje wala appointment 8 baje kar do" | P2 |
| 24 | `customers.find` | Owner, admin | `DashboardCustomersService.list` (phones masked) | owner/admin | – | "Customer Amit dhundo" | P2 (staff denied) |
| 25 | `insights.today` | Owner, admin | `OwnerAssistantService.query` (deterministic) | owner/admin | – | "Aaj ki sales batao" | P1 |
| 26 | `salons.search` | Anyone signed in | `CustomerAssistantSearchService.search` | signed in | – | "Haircut salon dhoondo" | unit |
| 27 | `me.bookings` | Customer | `BookingsService.listMine` | self | – | "Meri bookings dikhao" | P2 (another customer sees none) |
| 28 | `me.book` | Customer | `AvailabilityService.getAvailability` then `BookingsService.create` (idempotency key = confirmation nonce) | self, salon page | yes | "Kal shaam 5 baje haircut book karo" | P2 (exactly once) |
| 29 | `me.rescheduleBooking` | Customer | `AvailabilityService.getAvailability` then `BookingsService.reschedule` | self | yes | "Mera appointment kal 7 baje kar do" | P2 |
| 30 | `me.cancelBooking` | Customer | `BookingsService.cancel` (cancellation policy applies) | self | yes | "Mera appointment cancel karo" | P2 (another customer cannot) |
| 31 | `me.queueStatus` | Customer | `QueueService.getActiveForCustomer` | self | – | "Meri queue ka status batao" | P2 |
| 32 | `me.leaveQueue` | Customer | `QueueService.cancelByCustomer` | self | yes | "Queue chhod do" | P2 |

**Cross-cutting negative tests**
- Another shop's owner is denied, even when the request names the victim shop.
- The platform viewer and customers cannot run shop actions, and each denial is audited.
- An owner cannot use customer self-service.
- The customer screen never reaches a shop-management action.
- A stolen confirmation fails for another account.
- Replayed and stale confirmations are refused.
- A service name written as an instruction stays data.
- Inventory and onboarding requests return UNAVAILABLE.

## 2. FastQue capabilities not yet run by the assistant

The full route list is in [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md). Status meanings:
- **NEXT**: safe, an existing API exists, and it can be added in the same pattern.
- **BLOCKED**: needs an owner decision, a release, or a device.
- **NEVER**: deliberately excluded.

| Area | Persona | Existing API | Status | Blocker or reason |
|---|---|---|---|---|
| Chairs (list, add, deactivate) | Owner | `SalonChairsService` | NEXT | – |
| Staff working hours, weekly off | Owner | `StaffWorkingHoursService.list/set` | NEXT | – |
| Queue: assign a barber or chair, start a service | Owner, staff | `QueueService.assign/startService` | BLOCKED | Needs a deliberate chair and barber choice; kept in the Live Queue console until a picker UI exists |
| In-shop appointment for a walk-up caller | Owner, staff | `BookingsService.createInShop` | NEXT | Phone needs the recorded consent flow |
| Booking no-show / correct to completed | Owner, staff | `BookingNoShowService` | NEXT | – |
| Offers / daily deals | Owner | offers module | NEXT | – |
| Invoices / revenue report / CSV | Owner | `InvoicesService`, revenue report | NEXT (read) | Downloads stay as page links |
| Salon profile, description, timezone, payment QR | Owner | salon-setup services | NEXT | – |
| Photos (upload, cover) | Owner | `SalonPhotosService` | BLOCKED | A file upload can't come from a sentence; link to the page |
| Shop open/close for today | Owner | `SalonActivationService` | BLOCKED | Owner decision: an instant public effect needs a stronger confirmation |
| Reviews (reply) | Owner | dashboard-reviews | NEXT | – |
| Notifications (read, mark read) | All | notifications | NEXT | – |
| Customer: join queue at a salon | Customer | `QueueService.joinWalkIn` | NEXT | Uses the salon page context like `me.book` |
| Customer: favorites, profile, invoices, review | Customer | favorites, auth profile, invoices, reviews | NEXT | – |
| Guest (not signed in) actions | Guest | guest queue routes | BLOCKED | The assistant requires sign-in; guests keep the existing OTP and guest flows |
| Field employee: leads, follow-ups, visits | Employee | employee module | NEXT (read first) | Employee-audience session; Android UI is Codex's 1.0.7 lane, by API contract only |
| Platform admin, co-founder: analytics, shop status, verification queue | Admin | admin module | NEXT (read first) | Decisions such as verify or suspend need owner sign-off on confirmation strength |
| Platform viewer | Viewer | admin read endpoints | NEXT (read only) | Never writes (tested) |
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

The assistant drawer is mounted on every owner and staff shop page (`OwnerShell`), on customer account pages, and on each salon's booking page, where its `salonId` lets the customer book there.
