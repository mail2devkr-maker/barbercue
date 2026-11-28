# FastQue Connect: status, setup, costs and rollout

Branch `feature/fastque-connect` (local commits only; nothing pushed, deployed or run against production).
Requirement: [FASTQUE_CONNECT_SPEC.md](FASTQUE_CONNECT_SPEC.md). Design: [ARCHITECTURE_AND_PLAN.md](ARCHITECTURE_AND_PLAN.md).

Everything is **off by default**. With `FASTQUE_CONNECT_ENABLED` unset, every `/connect` route answers 404, no conversation is created, the event listener returns immediately, and no web menu entry or button is rendered.

## Feature matrix

Legend: **Done** = built, with an automated test proving it · **Built, not verified** = built, but no automated test and not checked in a browser · **Needs config** = works only with an external service or key · **Not built**.

| Spec § | Feature | Status |
|---|---|---|
| 2 | Automatic conversation on booking creation (appointments, live queue walk-ins) | Done (e2e) |
| 2 | Home service / freelancer / group bookings | Built, not verified (code path exists, ensured on demand; no e2e) |
| 2 | Multi-service bookings | Done (card lists every service) |
| 2 | Live booking card from the booking record (reference, salon, stylist, services, time, status, queue position, wait, duration, total, payment) | Done (e2e) |
| 3 | Customer Messages page; Chat with Salon on appointments, booking confirmation, live queue ticket, home tracking | Done (UI); completed bookings follow the config rule |
| 3 | Text, emoji, replies, reactions, edit with audit history (15 min), delete own message, receipts, unread counts, search, mute, archive, block, report, quick templates, free text | Done (e2e) |
| 3 | Images and PDFs (magic-byte validation, unsafe-PDF refusal, signed 5-minute viewer-bound URLs) | Done (e2e) |
| 3 | Voice messages (recorded in the browser, stored as audio) | Built, not verified |
| 3 | Voice-to-text transcription | Not built (needs a speech provider) |
| 3 | Typing indicator; online/last-active (hidden by default, privacy settings) | Built, not verified (typing lock is e2e-tested) |
| 4 | 3/4-panel inbox, 13 categories, customer/booking-ID/token/tag search, date filters, assignment, transfer history, priority, tags, internal notes, saved replies, customer history (permission-limited), AI summary | Done (API e2e); UI built |
| 4 | RBAC: owner, manager, receptionist, stylist (assigned only) | Done (e2e) |
| 4 | Collision prevention (90 s replying lock + stale-reply refusal) | Done (e2e) |
| 5 | Mode A suggested replies, Mode B automatic replies for low-risk intents from verified data, Mode C escalation; AI replies labelled | Done (e2e) |
| 5 | Never invents prices/offers/waits: deterministic answers from salon records; model drafts dropped if any number is not in the facts | Done (e2e + unit) |
| 6 | Intent detection (15 spec intents + human request, location, hours, on-the-way, arrived), English/Hindi/Hinglish rules | Done (unit) |
| 7, 9 | Reschedule (real availability, customer choice + salon approval, existing booking engine), cancellation (explicit customer confirmation), late arrival (no one displaced), add service (Live Queue add-on engine), audit trail | Done (e2e) |
| 7 | Remove service, change stylist, join other slot, family member | Request + approval only; staff apply it in Bookings / Live Queue (no booking API exists for these) |
| 8 | Event-driven queue messages with thresholds (position step, turn approaching, wait increase, called, started, completed); no extra push (existing queue pushes stay) | Done (unit + e2e) |
| 10 | Photo consultations (photos in chat, quotation reply) | Done (photos). AI photo classification: Not built |
| 11 | Quotation cards: server-computed totals, discount, tax, validity, terms, versions, accept/decline/changes, stale-version refusal | Done (e2e) |
| 11 | Accepted quotation → booking/payment | Not built (acceptance is recorded; staff create the booking) |
| 12 | Translation with cache, view-original, language detection by script | Done with a test model (e2e). **Needs config** for real use (AI provider) |
| 13 | Location sharing: consent, 5–120 min expiry, stop anytime, participants only | Built, not verified (no e2e). ETA comes from FastQue Home |
| 14 | Advisory sentiment, priority alerts | Done (rules; unit + e2e) |
| 15 | Follow-ups (thanks, feedback, aftercare transactional; rebook promotional only with consent; STOP opt-out) | Built; STOP opt-out e2e-tested, scheduler not verified end to end |
| 16 | Central notifications (in-app + push via existing ledger), dedupe per conversation, no message text unless previews on | Done (e2e) |
| 16 | Email / WhatsApp / SMS | Not built (needs approved providers and consent) |
| 17 | Complaint → existing SupportTicket (ticket number, booking ref, category, salon, context without notes, priority, SLA), customer tracking | Done (e2e). Assignment and resolution happen in the existing CRM ticket tools |
| 18 | Salon analytics with definitions, CSV export (formula-safe) | Done (e2e); UI built |
| 19 | Admin: aggregate metrics, AI tokens/cost per conversation and salon, config with guard rails, moderation, purpose-limited audited access, reopen | Done (e2e). Admin login needs TOTP, so not browser-checked |
| 20 | Tenant isolation (404 for non-participants), backend auth on every route, rate limits, prompt-injection flagging, audit log, data export | Done (e2e) |
| 20 | Malware scanning | Needs config (records `NOT_SCANNED`; active PDFs refused) |
| 20 | Encryption at rest, TLS | Infrastructure (database/storage/hosting), not app code |
| 20 | Automatic retention purge, account deletion cascade | Not built (retention days are recorded as policy) |
| 21 | Lifecycle (active, 7 days after visit, shorter after cancel, read-only, reopen, complaints stay open) | Done (e2e) |
| 22 | Redis / horizontal fan-out | Not needed yet; see the scale path in the plan |
| 27 | Entitlement tiers without prices | Done (config); no subscription assigns tiers yet |

## Tests

* Unit (`apps/backend/src/connect/connect.spec.ts`): 28 passing.
* E2E/security (`apps/backend/test/connect.e2e-spec.ts`, real AppModule, disposable `connect_e2e` database): 19 passing. Covers cross-salon isolation, RBAC, collisions, duplicates, media, AI hallucination/injection/cost, actions, quotations, complaints, admin access, lifecycle and 30 concurrent sends.
* Full suites compared to the baseline taken before any change:
  * Shared: 788/788 before and after.
  * Web: 5 failures before (ArrivalAlertOverlay) and the same 5 after.
  * Backend: the baseline had 6 failures in 4 suites that time out under full-run load. After the change, a different set of 3 suites times out under load (5 tests). The two that newly failed, `object-storage` and `db-deadline-scheduler`, pass when run alone (12/12).

## Browser check (local demo data)

* Checked: owner sign-in, the FastQue Connect tab (folders with counts, conversation list with priority/tag badges, opening a thread, the live booking card, Connect AI suggestion with detected intent and the honest "no AI provider" note) on desktop width, in the dark owner theme.
* Not checked in a browser: the customer Messages page (demo customers need an OTP provider to sign in), phone width, light mode, the Settings/Analytics tabs and the admin section (admin sign-in needs TOTP). The APIs behind them are covered by the e2e tests.
* Seen at about 800 px wide: the context panel drops below the thread. That is usable, but the layout needs a polish pass.

## Environment

Backend (all optional; off unless `"true"`): `FASTQUE_CONNECT_ENABLED`, `CONNECT_AI_ENABLED`, `CONNECT_AI_LLM_ENABLED`, `CONNECT_BOOKING_ACTIONS_ENABLED`, `CONNECT_QUEUE_MESSAGES_ENABLED`, `CONNECT_QUOTATIONS_ENABLED`, `CONNECT_TRANSLATION_ENABLED`, `CONNECT_LOCATION_SHARING_ENABLED`, `CONNECT_FOLLOWUPS_ENABLED`.
Model (only if you want paid AI): `CONNECT_AI_LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `CONNECT_AI_FAST_MODEL` plus `CONNECT_AI_FAST_INPUT_USD_PER_MTOK` / `_OUTPUT_USD_PER_MTOK` (no price means no call), the same for `QUALITY`, and `CONNECT_AI_DAILY_BUDGET_USD` (default 1).
Optional: `CONNECT_MEDIA_SECRET` (falls back to a key derived from the JWT secret). Private file storage reuses `PRIVATE_STORAGE_DIR` or `OBJECT_STORAGE_PRIVATE_BUCKET`.
Web: `NEXT_PUBLIC_FASTQUE_CONNECT_ENABLED=true`.

## API (all under `/api/v1/connect`)

`GET status` (public) · `GET media/:id?u&e&s` (signed) · `me/conversations` (GET list, POST ensure `{bookingId|queueEntryId|homeBookingId|homeBookingCode}`) · `me/unread` · `me/prefs` · `me/export` · `conversations/:id` (GET detail, PATCH priority/tags/resolved) and its sub-routes `messages` (GET `?before|after|limit`, POST), `messages/:mid` (PUT, DELETE), `/history`, `/reactions`, `/translate`, `attachments`, `read`, `typing`, `prefs`, `report`, `complaints`, `assign`, `notes`, `history`, `suggestions`, `summary`, `actions` (+ `/:aid/decision`), `quotations` (+ `/:qid/revise`, `/:qid/decision`), `location` · `salons/:salonId/{inbox,saved-replies,staff,settings,analytics,analytics.csv}` · `provider/inbox` · `admin/{overview,config,reports,reports/:id/review,conversations/:id/access,conversations/:id/reopen,audit}`.

## Cost estimate (assumptions stated; nothing is activated)

* Infrastructure: no new service. It uses the existing Postgres, API and Socket.IO. Rough growth: about 1 KB per message row. At 10,000 salons × 50 messages/day that is about 0.5 GB/day before indexes. Media dominates storage: photos average about 300 KB, so 2% of messages carrying a photo adds about 3 GB/day. Object storage at about US$0.02/GB-month is the main new line.
* AI with no provider (the default): US$0. Intents, verified answers, escalation, sentiment, summaries and queue messages are all rules.
* AI with a provider: one suggestion is about 1,500 input + 150 output tokens. At an illustrative small-model price of US$1 / US$5 per million tokens, that is about US$0.0023 per suggestion; a translation is about US$0.0006 and is cached. 1,000 salons × 40 suggestions/day ≈ US$92/day. The default daily cap of US$1 stops calls far below that. Set real prices in env; costs are logged per call in `connect_ai_interactions`.

## Deployment and rollback (needs your approval; not done)

1. Merge, then `npx prisma migrate deploy`. The migration `20261129090000_fastque_connect` only creates `connect_*` tables and enums.
2. Deploy with every flag off, and confirm behaviour is unchanged.
3. Turn on `FASTQUE_CONNECT_ENABLED` and `NEXT_PUBLIC_FASTQUE_CONNECT_ENABLED` for a pilot, then the sub-flags one by one.

Rollback: turn the flags off (instant; data is kept). Full removal: revert the code, then drop the `connect_*` tables and `Connect*` enums. No existing table depends on them.

## Local demo

1. Create a local database and run `prisma migrate deploy`.
2. Run `prisma/seed-connect-demo.ts`. It refuses anything except local `connect_dev` and needs `CONNECT_DEMO_PASSWORD`.
3. Run the API with the flags above and the web with `NEXT_PUBLIC_FASTQUE_CONNECT_ENABLED=true`.

Owner sign-in: `connect-demo-owner@example.test` at `/owner/login` with the password you set. Demo customers sign in by phone OTP, which needs an OTP provider locally.

## Known limitations

Voice-to-text, AI photo classification, quote-to-booking conversion, email/WhatsApp/SMS, malware scanning, retention purge and the subscription assignment of tiers are not built. The mobile app has no Connect screens yet; the API is ready for them.
