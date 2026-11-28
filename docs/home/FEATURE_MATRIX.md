# Feature matrix

"Verified" means an automated test on a real PostgreSQL, or a check in the running app, passed. Nothing has been used by real customers.

| Feature | Status |
|---|---|
| Feature flags; existing bookings survive switch-off | Implemented and verified |
| Two provider models, clear labels everywhere | Implemented and verified |
| Reuse of accounts, staff, Work profile, OTP, notifications, inventory, private storage | Implemented and verified |
| Reuse of FastQue Talent profiles and shifts (Talent is not on master) | Blocked |
| Agencies, franchises, mobile salons (model can be extended) | Not implemented |
| Service catalogue, Hindi names, restricted categories, price limits | Implemented and verified |
| Catalogue images, per-service required equipment/skill matching (fields exist; per-service assignment is enforced) | Not implemented |
| Salon wizard, 16 owner sub-tabs (services and pricing share one; 15 tabs) | Implemented and verified |
| Home prices never change in-salon prices | Implemented and verified |
| Freelancer registration (English labels with Hindi critical text) | Implemented and verified |
| Voice-assisted onboarding | Not implemented |
| Portfolio photos/videos (stored links and display; no upload screen) | Implemented but not verified |
| Field-executive assisted registration and leads (API and admin report) | Implemented and verified |
| Field-executive screens in the employee portal | Not implemented |
| Discovery: PIN, locality, city, society, radius, filters, sort, compare | Implemented and verified |
| Polygon areas, service-specific areas, map-pin and society search | Not implemented |
| Saved addresses, current location by permission | Implemented and verified |
| Routing adapter, conservative fallback | Implemented and verified |
| Road routing (OSRM) | Requires external configuration |
| Live traffic, Google/Mapbox/HERE adapters | Not implemented |
| Unified availability and no-overlap protection (salon, queue, Work, home) | Implemented and verified |
| Salon minimum-staff and queue protection | Implemented and verified |
| Instant and scheduled booking, holds, dynamic slots | Implemented and verified |
| Multi-service and several people with one professional | Implemented and verified |
| Parallel services by several professionals in one booking (booked as separate appointments, stated before checkout) | Not implemented |
| Matching, explainable reasons, blocking | Implemented and verified |
| Sponsored listings | Not implemented |
| Dispatch: sequential, parallel, owner assign, admin invite, atomic accept | Implemented and verified |
| ETA windows, confidence, delay and at-risk notices | Implemented and verified |
| ETA improvement from history (confidence uses history; durations are recorded, not yet predicted) | Implemented but not verified |
| Location sharing: consent, staleness label, erase (server) | Implemented and verified |
| Location sharing on a physical phone browser | Implemented but not verified |
| Background GPS / native app (status-only fallback is shown) | Not implemented |
| Booking lifecycle, reschedule, replacement, no-show, interruption | Implemented and verified |
| Start/completion codes, QR display | Implemented and verified |
| Scanning the QR with a camera (code is typed) | Not implemented |
| Pricing lines, weekend/peak/area/travel, offers, packages, extras with approval | Implemented and verified |
| Tax lines, invoice documents, distance-based travel charge, premium/brand product choice | Not implemented |
| Salon stock consumption through the existing ledger | Implemented and verified |
| Independent professional's own inventory, stock reservation before a visit | Not implemented |
| Offline payment records, partial, tip, dispute, void | Implemented and verified |
| Guest booking (gating, secret link, cancel) | Implemented and verified |
| Guest SMS code delivery | Requires external configuration |
| Professional dashboard | Implemented and verified |
| Earnings and salon reports (payroll untouched) | Implemented and verified |
| Posting to FastQue Finance (kept separate to avoid double counting) | Not implemented |
| Customer account section, favourites, rebook, export, erase | Implemented and verified |
| Erase inside the existing account-deletion flow (separate button) | Not implemented |
| Recurring bookings, society campaigns | Implemented and verified |
| Memberships as a product (draft plans only, switched off) | Not implemented |
| Verification with private documents and honest badges | Implemented and verified |
| Hygiene checklists in the browser (API used in tests) | Implemented but not verified |
| Safety reports, trusted status link, block | Implemented and verified |
| Reviews: verified bookings only, no duplicates, private feedback rules | Implemented and verified |
| Review moderation, response and appeal screens | Implemented but not verified |
| Support tickets, internal notes, escalation, refund records | Implemented and verified |
| In-app notifications with dedupe and delivery ledger | Implemented and verified |
| Push | Implemented but not verified |
| SMS, email, WhatsApp notices | Requires external configuration |
| Appointment reminder notices | Not implemented |
| Admin FastQue Home: 23 sub-tabs, CSV export, audit (every tab opened; actions covered by API tests) | Implemented and verified |
| Dispatch map | Requires external configuration |
| Link to the platform inside the admin portal | Implemented and verified |
| Monetization, commissions, settlements (off) | Implemented and verified |
| Salon subscription, training sales, kit sales | Not implemented |
| Analytics from real records | Implemented and verified |
| Typed-request understanding, pricing/workforce/retention/risk advice (rules, not AI) | Implemented and verified |
| LLM agents, AI dispatch (flag reserved) | Not implemented |
| Hindi for customer and professional critical steps | Implemented and verified |
| Hindi for long help text, owner and admin screens | Not implemented |
| "At Salon / At Home" on the landing page | Implemented and verified |
| Deployment, production migration (needs approval) | Not implemented |
