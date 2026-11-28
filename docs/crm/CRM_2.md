# FastQue Employee CRM 2.0

Mobile-first field sales CRM for FastQue's salon onboarding team. Employees use `/employee`;
sales managers and admins use **Admin → Regional Sales → Field CRM 2.0** (`/dashboard/admin/field-crm`)
and **Onboarding Review** (`/dashboard/admin/onboarding-review`). One API (`/api/v1/crm/*`) serves
both; the server decides what each person can see.

Every number on every screen comes from database rows. There is no demo data, no invented target and
no AI score unless a real AI provider produced it.

## What is in this release

| Area | Where | What it does |
| --- | --- | --- |
| Dashboard | `/employee` | 16 KPIs with Today / Yesterday / 7 / 30 days / This month, quick actions, upcoming meetings, pending and overdue calls, overdue tasks, onboarding in progress, recent lead activity. Hover a number to see how it is counted. |
| Leads | `/employee/leads` | Search, filter (status, priority, follow-up due, employee), sort, paging. Create/edit with duplicate detection (phone and name+city). Detail drawer: status (manual statuses only), tap-to-call, WhatsApp, log call, schedule call/meeting, task, start onboarding, notes and full timeline. Managers: bulk assign, reassign, CSV/XLSX import with column mapping, duplicate preview, then commit; downloadable template. |
| Tasks | `/employee/activity/tasks` | List and board views, filters (status, type, priority, overdue, employee), bulk complete/cancel, blocked reason, 14 task types. |
| Meetings | `/employee/activity/meetings` | Upcoming/past agenda grouped by day, confirm, reschedule, outcome (required to complete) with optional follow-up task, start a recorded conversation. |
| Calls | `/employee/activity/calls` | Queue (overdue, due, never-called leads), tap-to-dial, manual outcome log that moves the lead status (`leadStatusAfterCall`), 7-day history. FastQue does not place, record or monitor phone calls. |
| Salon onboarding | `/employee/onboarding`, wizard at `/employee/onboarding/new` and `/[id]` | 8-step wizard (ported from the unmerged onboarding branch and extended): GPS with accuracy, weak-fix warning (> 50 m), recapture, "captured at the entrance" check, map link; 13 camera photo slots — camera shots carry private capture time + GPS, gallery uploads carry none; services/pricing with menu OCR (only when configured) and per-row human confirmation; operations (wash stations, weekly holidays, amenities, QR readiness, marketplace interest, owner training); documented owner consent (method, who, role, evidence note — required to submit); review and submit. Lifecycle Draft → Submitted → Under review → Changes requested → Approved → Activated, plus Rejected/Suspended. A salon is published only after admin approval. |
| Sales conversations | `/employee/conversations` | Consent screen (method, people present, language, explicit statement) → MediaRecorder record / pause / resume / stop → playback → upload (idempotent `submissionKey`, retry keeps the audio) → private storage. List, private playback, delete audio (record kept for audit). Manager review of AI reports. Automatic deletion after the retention period. |
| AI sales coach | inside Conversations | Provider abstraction (`sales-coach.provider.ts`), keys server-side only, enable/disable switch, status, retry, cost estimate, 13-criterion rubric with evidence quotes. **With no provider configured every screen shows "AI Analysis Not Configured" and no score exists anywhere.** |
| Support | `/employee/support` | 14 categories, priorities with SLA (4/24/48/96 h), statuses, comments, internal notes (staff only), image attachments (private), escalate, resolve, confirm & close, reopen. Employees see their own tickets; managers/admins work the queue and assign. |
| Analytics | `/employee/analytics`, admin tab | Filters (period incl. custom, employee, territory, city, source); headline KPIs, conversion rates, funnel, daily trend, employee ranking, sources, territories, onboarding quality, support and AI analytics (AI only when configured); every definition listed on the page. |
| Notifications | `/employee/notifications` | In-app, de-duplicated (`payload.dedupeKey`), deep links to the lead/task/meeting/ticket/recording; reminder sweep every 15 min (`CRM_REMINDERS_ENABLED`). CRM notifications are kept out of the general notification list. |
| Legacy field work | `/employee/field` | The previous employee page (visits, follow-ups, voice onboarding, ActionAssistant) — unchanged, moved here and linked from the CRM menu. |

## Roles (RBAC)

| CRM role | FastQue roles | Scope |
| --- | --- | --- |
| Field employee | `FIELD_EXECUTIVE` | Own leads, tasks, meetings, calls, recordings, tickets, analytics. |
| Sales manager | `SALES_ADMIN` | Whole field team (FastQue has one team today): assign, import, review recordings, work tickets. |
| Admin | `PLATFORM_ADMIN`, `CO_FOUNDER` | Everything a manager can do; onboarding approval/activation stays on the review page. |
| Viewer | `PLATFORM_VIEWER` | Organisation-wide, read only. |

Rules worth knowing:
- Employees can set only "manual" lead statuses. Onboarding started / Pending approval / Approved / Activated / Rejected are set by the onboarding workflow.
- A lead with voice visit logs cannot be reassigned (it would rewrite who made those visits); the assign result says which leads were skipped and why.
- Audio, ticket attachments and onboarding photos are served only through authenticated API routes, never public URLs. Photo GPS metadata is visible to admin reviewers only.

## KPI definitions

The single source is `CRM_KPI_DEFINITIONS` in `packages/shared/src/crm.ts` (shown on the analytics page).
Rates added by analytics: meeting conversion = meetings completed ÷ meetings scheduled; approval rate =
approved ÷ (approved + rejected); activation rate = activated ÷ approved; lead conversion = activated ÷
leads generated — all within the selected period and filters. Days are IST calendar days.

## Configuration

Nothing below is required to run the CRM. Without it the features that depend on it say so plainly.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SALES_COACH_PROVIDER` | `none` | `gemini` to enable the AI coach provider. |
| `GEMINI_API_KEY` | — | **Paid credential** (Google AI Studio / Vertex). Required for the AI coach (and for menu OCR, if enabled). Server-side only. |
| `SALES_COACH_ENABLED` | `false` | Master switch; `true` to allow analyses once a provider is configured. |
| `SALES_COACH_USD_PER_MILLION_TOKENS` | — | Price used for cost estimates. No price → no estimate shown. |
| `SALES_COACH_PRICING_NOTES` | — | Approved FastQue pricing text the coach may compare against. |
| `SALES_RECORDING_RETENTION_DAYS` | `180` | Audio older than this is deleted daily at 03:30 IST (record kept). |
| `CRM_REMINDERS_ENABLED` | `true` | Set `false` to stop the 15-minute reminder sweep. |
| `OBJECT_STORAGE_PRIVATE_BUCKET` (+ existing `OBJECT_STORAGE_*`) | — | **Paid/infra:** private bucket for audio, attachments and onboarding photos in production. Locally `PRIVATE_STORAGE_DIR` (or the default local storage dir) is used. |
| `ONBOARDING_ACTIVATION_ENABLED`, `ONBOARDING_MENU_EXTRACTION_ENABLED`, `ONBOARDING_INVITE_TTL_HOURS` | see onboarding module | Owner activation invites and menu OCR. |

## Database

Additive migrations only (no existing row is rewritten):
- `20261119090000_salon_onboarding` — onboarding tables (ported from the onboarding branch).
- `20261119100000_employee_crm_2` — new lead statuses/fields, tasks, meetings, calls, lead activity, import jobs, sales recordings + analyses, support tickets/comments/attachments, onboarding GPS/consent/operations columns, photo capture metadata, CHECK constraints (e.g. a recording row cannot exist without `consentGiven = true`).

Verified with `apps/backend/scripts/verify-migration-chain.sh` against a disposable database.

### Rolling back

1. Deploy the previous application build (the old code ignores the new tables and columns).
2. Only if the data must go too, on a backup-verified database: drop the new tables
   (`support_ticket_attachments`, `support_ticket_comments`, `support_tickets`, `sales_recording_analyses`,
   `sales_recordings`, `crm_calls`, `crm_meetings`, `crm_tasks`, `crm_lead_activities`, `crm_lead_import_jobs`)
   and the added columns listed in the migration. PostgreSQL cannot drop enum values; the added
   `CrmLeadStatus` / `OnboardingMediaCategory` values are harmless to old code. Leads moved to new
   statuses should be mapped back first (e.g. `ASSIGNED`/`CALL_PENDING` → `NEW`, `APPROVED` → `ONBOARDED`).
3. Delete private audio/attachments from the private bucket if required by policy.

## Tests

- `packages/shared/src/__tests__/crm.test.ts` — statuses, call → status rules, IST ranges, schemas (consent required).
- `apps/backend/src/crm/crm-helpers.spec.ts` — AI provider states (never a score when unconfigured), report parsing, import header mapping.
- `apps/backend/test/crm-2.e2e-spec.ts` — RBAC scoping, leads/duplicates/assignment, import, tasks/meetings/calls, recordings (consent, private audio, AI 409 not configured), tickets, analytics, notifications.
- `apps/backend/test/salon-onboarding.e2e-spec.ts` — onboarding lifecycle incl. consent rule and lead sync.
- `apps/web/lib/__tests__/crm.test.jsx` — date helpers, onboarding list fields, admin route access.

## Not in this release (deferred)

- Native mobile (Expo) screens — the web portal is mobile-first and works in the phone browser.
- Offline capture queue for photos/recordings (uploads retry in-session only).
- Targets/quotas, territories as managed entities, multiple sales teams (managers see the whole team).
- Push/WhatsApp/SMS notifications for CRM events (in-app only).
- Server-side transcoding of audio; AI analysis runs inline on request (no background queue/worker).
- Real-time OCR price comparison against approved pricing beyond the notes the coach receives.

## Feedback release (24 Nov 2026)

- Migration `20261124120000_intake_pause_and_ceo_message` (additive): `salons.queuePaused`, `salons.bookingsPaused`, table `crm_announcements`.
- `PINCODE_LOOKUP_ENABLED` (default on): the API asks India Post's public service (`api.postalpincode.in`) about a typed 6-digit PIN. Nothing else is sent; a failure only means manual entry.
- Private files: with neither `PRIVATE_STORAGE_DIR` nor `OBJECT_STORAGE_PRIVATE_BUCKET` set, the API uses the attached Railway volume (`RAILWAY_VOLUME_MOUNT_PATH`) in a folder that is never served. Without a volume, uploads stay off.
- Lead status: employees may change it until the salon is submitted; managers may always use manual statuses; admins may set any status. Changing a lead status never approves or publishes a salon.
- CEO message: Admin, Field CRM 2.0, "CEO message" (PLATFORM_ADMIN / CO_FOUNDER). Video up to 50 MB or an https link.
