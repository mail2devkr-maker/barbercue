# FastQue Connect: architecture audit and implementation plan

Requirement: [FASTQUE_CONNECT_SPEC.md](FASTQUE_CONNECT_SPEC.md) (the user's 30 sections). Branch `feature/fastque-connect`, cut from `upstream/master` at `f5a9cef2`.

## 1. What already exists and gets reused

| Need | Existing piece | How Connect uses it |
|---|---|---|
| Auth, sessions, roles | `auth/` JWT guards, `@CurrentUser`, `Role`, `SessionAudience` | Every Connect route sits behind the global JWT guard. Roles come from the token and are re-checked in the DB. |
| Salon tenant checks | `common/salon-access/SalonAccessService` (`assertAccess`, `getActorKind`) | Salon-side access = an owner or staff `UserRole` at that salon, plus a Connect staff grant for non-owners (section 4 RBAC). |
| Real time | `realtime/RealtimeGateway` (Socket.IO `/realtime`, JWT handshake, automatic `customer:{userId}` room per user) | Connect sends **ids only** to per-user rooms (never to the `salon:{id}` room, which anyone can join). Clients refetch over authorised REST. Typing and presence go through throttled REST calls, so the gateway needs no new socket handlers. |
| Booking and queue events | Every booking/queue change already ends in a `RealtimeGateway.emit*` call after commit | One additive hook: the gateway forwards those calls to registered in-process listeners. Connect listens only when its flag is on. Booking and queue code are unchanged. |
| Booking changes | `BookingsService.reschedule / cancel` (exported), `AvailabilityService.getAvailability` | Chat actions call these same engines after recorded approvals. There is no second booking engine. |
| Notifications | `NotificationDeliveryService.deliverToUser` (in-app + push, dedupe key, retries, expiry) and user preferences | All Connect notices go through it with dedupe keys and per-conversation throttling. The push body is generic unless the user turns previews on. |
| Files | `storage/PrivateObjectStorageService` (local disk or S3-compatible, private) | Attachments are stored privately. Downloads use short-lived HMAC-signed URLs tied to the viewer. |
| Support tickets | `SupportTicket` (CRM 2.0) with SLA, assignee and status | Customer complaints from a chat create a real `SupportTicket`. The customer tracks its status in the chat. |
| AI provider layer | `growth/model-router.ts` (`ModelProvider`, `AnthropicProvider`, priced tiers, budgets, usage table) | Connect reuses the provider classes with its own `CONNECT_AI_*` configuration, budget and usage log. With no provider configured (the default), everything runs on deterministic rules. |
| Scheduled work | `DbDeadlineSchedulerService` | Follow-ups and lifecycle transitions are scheduled on it (no polling loops). |
| FastQue Home | `HomeBooking`, `HomeProvider` | Home bookings get conversations too: tenant = provider's salon, or the independent provider's user. |
| Web shells | `components/customer-dashboard/DashboardShell.tsx`, `components/owner/owner-nav.ts`, admin layout, `lib/dashboard-flags.ts`, `lib/realtime.ts`, `lib/api.ts` | New nav entries appear only when `NEXT_PUBLIC_FASTQUE_CONNECT_ENABLED=true`. They reuse the existing theme variables, so light and dark mode follow the app. |

No new service, database or message broker. Redis is **not** added: presence is a `lastSeenAt` column (60 s window), and fan-out goes through the existing Socket.IO server. The scaling path is in section 6.

## 2. Feature flags (all off by default; off = current behaviour, byte for byte)

Backend (env, exactly `"true"` turns one on; every sub-flag also needs the master):

| Flag | Gates |
|---|---|
| `FASTQUE_CONNECT_ENABLED` | Master switch. Off: every `/connect` route answers 404, no conversation is created, and no event listener is registered. |
| `CONNECT_AI_ENABLED` | Intent detection, suggested replies, auto-replies, summaries and sentiment (rules engine). |
| `CONNECT_AI_LLM_ENABLED` | Allows paid model calls, only when `CONNECT_AI_LLM_PROVIDER`, a model **and its prices** are configured. |
| `CONNECT_BOOKING_ACTIONS_ENABLED` | Reschedule, cancel, late-arrival and change requests in chat. |
| `CONNECT_QUEUE_MESSAGES_ENABLED` | Event-driven live queue messages. |
| `CONNECT_QUOTATIONS_ENABLED` | Quotation cards. |
| `CONNECT_TRANSLATION_ENABLED` | Translation (needs the LLM; otherwise the original text is shown with a note). |
| `CONNECT_LOCATION_SHARING_ENABLED` | Consent-based, time-limited location sharing. |
| `CONNECT_FOLLOWUPS_ENABLED` | Post-service follow-ups. |

Web: `NEXT_PUBLIC_FASTQUE_CONNECT_ENABLED` (menu entries and "Chat with Salon" buttons).

## 3. Data model (one additive migration, `connect_*` tables only)

Existing tables are only referenced by foreign keys, never altered. Tables: conversations, participants, messages (per-conversation `seq` for ordering, `(conversationId, senderUserId, clientMessageId)` unique for duplicate prevention), message edits (audit), attachments, reactions, internal notes, saved replies, assignment events, staff grants (RBAC), AI interactions (tokens and cost), translations (cache), consent records, booking action requests, quotations and quotation versions, complaints (linked to `support_tickets`), moderation reports, analytics events, audit events, salon settings, platform config, location shares, follow-ups and user preferences. Cursor pagination is by `seq`. Every salon-side query is scoped by `salonId` (or `homeProviderId`) in the `WHERE` clause.

## 4. Security model

* **One gate** (`ConnectAccessService.load`) resolves the caller's relation to a conversation: customer participant, salon owner, granted staff, or home provider. Anything else gets **404**, the same answer as a missing id, so knowing a conversation id gives nothing away. Every route goes through this gate.
* Staff RBAC: the owner has everything. Staff need a Connect grant: `MANAGER` (all, assign), `RECEPTIONIST` (all, reply), or `STYLIST` (only conversations assigned to them).
* Collision prevention: a 90-second "replying" lock per conversation. Each send carries the `lastSeenSeq` it was written against, and a send from staff who have not seen a newer salon reply is rejected with `CONFLICT_NEWER_REPLY`.
* Attachments: an allowlist (JPEG, PNG, WebP, PDF, AAC/MP4/WebM/OGG audio), checked by magic bytes and not just the declared type. Size limits come from config, the SHA-256 is stored, and the scan status is recorded (`NOT_SCANNED` unless a scanner is configured; no paid scanner is activated). Signed URLs expire after 5 minutes and are bound to the viewer.
* Rate limits: the existing `@Throttle` per route, plus a per-conversation message rate in config.
* AI: customer text is passed only as JSON data, never inside instructions. An injection detector strips the obvious attacks and flags the turn. Every number, price or time in a model draft must match the verified fact set, or the draft is dropped. Actions are never executed by AI; it can only propose a card that people approve.
* Admins: no browsing of private conversations. Metrics are aggregates only. Reading one conversation needs a stated purpose (a support ticket, a report or legal), is time-boxed, and is written to the audit log.
* Text is stored as plain text and rendered as text by React (no `dangerouslySetInnerHTML`), so there is no XSS path. Prisma parameterises all queries. Bearer-token auth means no CSRF exposure on Connect routes.

## 5. Phases

1. **Core**: schema and migration, flags, access gate, conversations for scheduled, queue, home, multi-service and group bookings (lazy `ensure` + hook on booking creation), live booking card, messages (text, image, voice, PDF, location, reply, react, edit with audit, delete, receipts, typing, presence with privacy, search, mute, archive, block, report, templates), customer Messages page and "Chat with Salon" buttons, the owner 3-panel inbox (categories, filters, search, assignment, transfer, priority, tags, notes, saved replies, history), and notifications.
2. **Smart**: deterministic intent rules (English, Hindi, Hinglish), verified knowledge, suggested replies, auto-reply for low-risk intents, escalation, the optional LLM gateway with cost log, booking action workflows, event-driven queue messages with thresholds, and translation with cache.
3. **Business**: quotations with versions, complaints to support tickets, salon analytics with CSV export, follow-ups with consent (transactional separated from promotional, opt-out).
4. **Platform**: admin Communication Management (metrics, AI cost, config, moderation, purpose-limited access), home-service location sharing, sentiment alerts, summaries, lifecycle rules, entitlements (tier to feature mapping, no prices).

Each stable phase is a local commit. Nothing is pushed.

## 6. Scale path (not built now; no redesign needed)

* Several API instances: add the Socket.IO Redis adapter (one line in the gateway), and presence moves to Redis keys with a TTL.
* Message table: index `(conversationId, seq)`. Partition by month once it passes about 100M rows.
* AI: classification runs on rules first. The model is only for drafts and translation, with per-salon budgets.
