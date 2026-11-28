# FastQue Visitor Intelligence

First-party, consent-aware visitor analytics and market intelligence inside the Admin Portal
(`/dashboard/admin/visitor-intelligence`). It answers who visits, from where (approximately), how they found
FastQue, what they search and view, why they leave, where demand exceeds salon supply, and how campaigns turn
into bookings. Core analytics runs on FastQue's own Postgres; GA4, Search Console, Google Ads, Meta and AI are
optional add-ons, all off by default.

Sections below are referenced from code comments as `README.md (SECTION)`.

---

## ARCHITECTURE

```
 customer browser                         NestJS backend (apps/backend/src/visitor-intel)            Postgres (vi_* tables)
 ─────────────────                        ───────────────────────────────────────────────            ──────────────────────
 ConsentBanner ──► POST /consent ───────► ViIngestService.recordConsent ──────────────────────────► vi_consent_records
 tracker.ts queue (4 s / 20 events /      POST /collect (public, zod, throttled 240/min/IP)
   tab hidden, fetch keepalive) ────────► ViIngestService.enqueue → in-memory queue → flush(500 ms) ─► vi_visitors, vi_sessions,
                                            · consent / bot / sampling gates                          vi_events, vi_search_events,
                                            · geo (CDN headers → optional mmdb → tz hint)              vi_conversions
                                            · dedupe by client UUID                                     
                                            · bookings/orders re-read for value (never trusted)
                                            · RealtimeGateway room vi:live ("changed" ping only)
 admin dashboards  ◄── GET /overview, /live, /geo, /search, /funnels, … (ViAccessService RBAC + scope)
                   ◄── socket.io vi.live.updated → refetch (polling fallback 10–60 s)
 crons: alerts */15 min · insights 07:00 IST · rollups + retention 00:45 IST · reports hourly · integration sync 04:00 IST
```

* **Ingestion** (`vi-ingest.service.ts`): validate → consent/bot/sampling gates → enqueue → 202. A single worker per
  instance drains in arrival order. Each batch: upsert visitor (pseudonymous key), upsert session (a session id can
  never move between browsers), insert only events whose client UUID is new, update session/visitor counters,
  write search rows (redacted + normalised), verify conversions, forward consented copies to GA4/Meta.
* **Standard event schema** (`vi_events`): event id, client event id (dedupe), visitor id, session id, user id (only
  after login, with consent), type, timestamp, module, path, entity type/id, salon id, approximate country/state/city,
  location source, channel, campaign id, device category, consent status, sanitised metadata (allow-listed keys).
  Page views are `page_view` events (one table, one index set).
* **Verified outcomes** (`vi_conversions`): a `booking_confirmed` event only counts if the booking exists, was created
  within 48 h and belongs to the signed-in visitor (when known); its value is `Σ BookingService.price − online discount`.
  Purchases use `CommerceOrder.total` (by order number). Funnel outcome steps also require a verified conversion.
* **Aggregation**: dashboards query `vi_sessions` (one row per visit, indexed on `startedAt`, city, channel, campaign).
  `vi_daily_metrics` holds nightly IST-day rollups (all/city/channel/device) that outlive raw-data retention.
* **Realtime**: the existing `/realtime` socket gateway gains a `join:visitor-intel` room for internal admins. It only
  ever emits a revision number; data always comes from the RBAC-checked REST endpoint. The page polls as a fallback.

## TRACKING

`apps/web/lib/visitor-intel/tracker.ts` + `components/analytics/VisitorIntelTracker.tsx` (root layout).

| Event | Where | Notes |
|---|---|---|
| `page_view`, `engagement` | every public route | visible time only; deduped within 1.5 s |
| `search` / `search_results` | `/search` | query (redacted server-side), city, result count, price/distance/rating/gender/open-now filters |
| `location_set`, `near_me` | search | Near Me sends rounded coords; the server keeps only the nearest city |
| `salon_view` | salon profile page | salon id |
| `booking_start` / `booking_confirmed` / `booking_failed` | `BookingFlow` | booking id only; failure reason code (e.g. `no_slots`) |
| `product_view`, `add_to_cart`, `checkout_start`, `purchase` | FastQue shop | order number only |
| `partner_registration_start`, `sign_up` | `/owner/register` | |
| `page_error` | global | count only, max 3 per page, no message text |

Not tracked: `/dashboard`, `/employee`, `/admin`, password pages. Never: keystrokes, form contents, screen
recordings, fingerprints. Defined but not yet sent (modules not live / unmerged): `queue_join`, `home_*`, `stylist_view`,
`job_*`, `staffing_request`, `loyalty_join`; their funnels show empty states until those modules call `viTrack`.

Campaign links: `https://<site>/c/<code>` → 302 to the landing page with UTMs and `fq_c=<code>` (`app/(public)/c/[code]/route.ts`).

## GEO

Order: (1) CDN headers — Cloudflare `cf-ipcountry/cf-ipcity/cf-region`, Vercel `x-vercel-ip-*`, or a proxy's
`x-geo-*`; (2) optional offline database: set `VI_GEOIP_MMDB_PATH` to a DB-IP Lite (CC-BY 4.0) or GeoLite2 `.mmdb`
and `npm i maxmind` in the backend; (3) browser timezone → country hint only. The visitor's own city choice
(`USER_SELECTED`) and explicit Near Me permission (`BROWSER_PERMISSION`) override IP data. The IP is used in memory
only, never stored or logged. Confidence: IP city = low, IP country = medium, chosen city = medium, Near Me = high.
Locations are always labelled approximate; locality is off unless enabled and then only from visitor choice.
**Railway (current host) adds no geo headers**, so until Cloudflare (free) fronts the site or an mmdb is installed,
location comes mainly from the city the visitor picks.

Market Opportunity (per city, `scoreViOpportunity` in shared):
`demand = searches + 0.3×visitors + 0.5×zero-result searches`, `pressure = demand ÷ max(1, active salons)`;
HIGH if demand ≥ 50 and pressure ≥ 25 (or no salons and demand ≥ 20), MEDIUM if demand ≥ 15 and pressure ≥ 8.
"Assign" creates a Field CRM task through `CrmActivityService.createTask` (CRM's own permission rules), with location,
metrics, recommended action, priority, owner and due date, and records `vi_opportunity_assignments`.

## RBAC

Enforced on every backend route by `ViAccessService` (roles = token roles ∩ roles still in `user_roles`).
No new `Role` enum values: additional responsibilities live in `vi_staff_roles`, grantable only to existing internal admins.

| Spec role | Mapped to | Capabilities (summary) | Scope |
|---|---|---|---|
| Super Admin | `PLATFORM_ADMIN` | everything incl. integrations, staff roles, privacy erasure | platform |
| (Co-founder) | `CO_FOUNDER` | all read + PII, campaigns, segments, insight decisions, exports, alerts, settings | platform |
| Analyst (read-only) | `PLATFORM_VIEWER` | all dashboards, no PII, no exports | platform |
| Sales Head | `SALES_ADMIN` or `vi_staff_roles.SALES_HEAD` | overview, live, geo, search, insights, ask, reports, export, assign opportunities | platform |
| Marketing Head | `vi_staff_roles.MARKETING_HEAD` | campaigns, attribution, segments, journeys, conversions, exports | platform |
| Operations Head | `vi_staff_roles.OPERATIONS_HEAD` | journeys/bottlenecks, conversions, search, geo | platform |
| Support | `vi_staff_roles.SUPPORT` | live, visitor history, session timelines (no PII unless also PII-capable) | platform |
| Field Sales Executive | `FIELD_EXECUTIVE` | overview, geo, search — **own territory cities only** (`EmployeeProfile.territory`, comma-separated) | territory |
| Salon Owner | `SALON_OWNER` | only `GET visitor-intel/salon/:id/summary` for salons they own (profile views, visitors, bookings, conversion, sources, searches before visiting) | salon |
| Distributor | — | **not implemented**: no distributor user/role exists yet | — |

PII (contact details, user ids) only with `pii`; viewing a registered visitor's profile or a timeline is audited
(`audit_logs`, `entityType = VISITOR_INTELLIGENCE`). The web mirrors this via `canOpenAdminPath` and hides tabs.

## PRIVACY

* Consent banner (`components/privacy/ConsentBanner.tsx`): Accept all / Reject non-essential / Customise, reopened
  from "Cookie preferences" in the footer. Policy version `2026-11`; a new version asks again. Notice: `/privacy/analytics`.
* Without analytics consent nothing is stored (not even a counter). Withdrawal clears marketing eligibility.
* Pseudonymous ids: `visitorKey = SHA-256(VI_VISITOR_PEPPER : browser UUID)`; guests are shown as "Guest #N".
* IP minimisation: never stored. User agents parsed to device/browser/OS and discarded. Search text redacted
  (emails, phones/cards/Aadhaar-length digit runs, PAN, UPI ids, anything after "password/otp/pin/cvv").
* Linking to an account happens only from a valid session token after login, only for consented browsers.
* Retention (configurable): raw events 180 d, sessions 395 d, daily totals 1825 d, alerts 365 d, consent records 3 y.
* DPDP access/erasure: Tracking Settings → Privacy requests (exports JSON / deletes all VI rows; bookings untouched).
* Rate limits (240 batches/min/IP on collect, 30/min on consent, 20/min on Ask), zod validation, bot filtering,
  formula-injection-safe CSV, server-side redaction.
* **Known decision for you**: the pre-existing `UniqueVisitorTracker` (site-metrics unique-visitor count, not part of
  this work) still sets its first-party id cookie without asking. It stores no IP/PII, but under a strict reading of
  DPDP/ePrivacy it should also wait for consent. Left unchanged here to avoid silently changing an existing feature.

## CAMPAIGNS

Types: UTM link, salon QR, sales-employee QR, influencer, society/city/pamphlet QR, online ad, referral. Each gets a
unique code, short link and print-ready QR PNG. Per campaign (last touch, for the selected period): visits, uniques,
registrations, searches, bookings, purchases, value; first-touch conversions; **spend = linked Finance expenses only**
(`vi_campaign_expense_links` → `finance_expenses`, counted when SUBMITTED…PAID); CAC = spend ÷ (registrations, else
bookings); ROI = (value − spend) ÷ spend. Compare up to 4 campaigns; channels ranked. Note "value" is salon booking
value, not FastQue revenue.

## SEGMENTS

10 system segments (new, returning, registered-no-booking, abandoned booking, abandoned cart, frequent, high value,
inactive, home-service interest, marketplace interest) plus saved custom rules (base + city + service interest +
lookback). Counts show members / marketing-consented / reachable registered. "Audience" lists only consented,
not-opted-out, not-suppressed members, masked unless PII-capable, and is audited. Opt-in/out per channel
(`vi_marketing_preferences`, customer self-service at `GET/PUT visitor-intel/me/marketing-preferences`). **Sending to
WhatsApp/email/push and Google/Meta audience upload are not automated** (needs approved providers + customer-match policy).

## AI

* **Intelligence Agent** (`vi-insights.service.ts`, daily 07:00 IST or "Run analysis now"): rules over the last 7 vs
  previous 7 days — traffic trend, high-demand/low-coverage cities, emerging markets, missing service categories
  (zero-result share), weak landing pages, biggest funnel drop-off, SEO keywords (Search Console or on-site demand),
  ad campaigns below break-even, product demand, retention, z-score anomalies, plus a weekly briefing. Each carries
  supporting data, period, impact, confidence, priority, action, department; accept / reject / dismiss / create CRM task.
* **LLM**: optional, only rephrases the briefing and Ask answers from aggregate numbers, and picks a whitelisted tool
  when rules cannot. Provider: Tracking Settings → `none` (default) | `gemini` (existing `GEMINI_API_KEY`) |
  `ollama` (`VI_OLLAMA_URL`, `VI_OLLAMA_MODEL`). Never receives events, ids or contact details; never spends ad budget.
* **Ask FastQue AI** (`vi-ask.service.ts`): tools `visitors, live_now, top_demand_cities, onboarding_targets,
  abandonment, compare_cities (city groups e.g. Delhi-NCR), top_searches, channels, conversion, revenue`, each gated by
  a capability and run with the caller's scope. No SQL is ever generated or executed by a model. Questions are audited.

## REPORTS

Activity, geo, search, campaigns, conversion, revenue, segments, salons, territories, AI recommendations — CSV (UTF-8
BOM, formula-safe), XLSX (existing `toXlsx`), PDF (built-in table renderer). Aggregates only. Every export audited.
Schedules: daily / weekly (Mon) / monthly at 08:00 IST, run with the creator's current rights; emailed only when VI
email is configured, otherwise recorded as "Generated; not emailed".

## INTEGRATIONS

Global switch `VI_INTEGRATIONS_ENABLED=true` **and** per-provider enable + credentials (Tracking Settings). Secrets are
AES-256-GCM encrypted with the existing `CryptoService` (`TOTP_ENCRYPTION_KEY`) and never returned.

| Provider | Direction | What |
|---|---|---|
| GA4 | browser tag (`NEXT_PUBLIC_GA4_ID`, after consent, Consent Mode v2 flags) + server Measurement Protocol | browser: page_view, search, view_item, add_to_cart, begin_checkout; server (verified only): sign_up, booking_complete, purchase with value. No PII. |
| Meta Pixel + CAPI | browser pixel (`NEXT_PUBLIC_META_PIXEL_ID`) + server CAPI, **marketing consent only** | PageView, ViewContent, Search, AddToCart, InitiateCheckout, CompleteRegistration, Schedule, Purchase; same `event_id` both sides for dedupe; only hashed pseudonymous `external_id` + UA |
| Search Console | import (service-account JSON) | queries × page × country: clicks, impressions, CTR, position → Traffic Sources + SEO insights |
| Google Ads | import (developer token + OAuth refresh token) | campaign spend, clicks, impressions, conversions, value (`vi_external_metrics`) |
| Meta Ads | import (`adAccountId` + token) | campaign spend, clicks, impressions, conversions |

Imported ad spend is stored for reference; campaign ROI uses Finance-linked expenses so spend is never double counted.

## API

All under `/api/v1/visitor-intel`. Public: `POST collect`, `POST consent`, `GET config/public`, `GET c/:code`.
Authenticated (capability in brackets): `me`; `overview`, `drilldown?dim=` [overview]; `live?window=` [live];
`visitors`, `visitors/:id` [history]; `sessions/:id/timeline` [timeline]; `geo?level=`, `opportunities` [geo];
`POST opportunities/assign` [assignOpportunity]; `search` [search]; `funnels?funnel=&split=` [journey]; `sources`;
`conversions`; `salon/:salonId/summary` (owner); `campaigns` CRUD, `campaigns/:id/expenses`, `campaigns/compare`,
`campaigns/finance-expenses`; `insights`, `insights/generate`, `insights/:id/decision|task`; `POST ask`;
`segments`, `segments/:id/audience`, `segments/preferences`, `me/marketing-preferences`; `alerts/rules|events|evaluate`;
`reports/export?type=&format=`, `reports/schedules`; `settings`, `settings/rollup`; `integrations/:provider[/sync]`;
`privacy`; `staff-roles`; `demo/seed`, `DELETE demo` (dev only). Common filters: `period` (today…year, custom +
`from`/`to`), `country`, `state`, `city`, `channel`, `device`, `visitorType`, `module`, `campaignId`, `salonId`.

## OPERATIONS

Crons (all no-ops when `VI_TRACKING_ENABLED=false`): alerts every 15 min; insights 01:30 UTC; rollups for the last
3 days + retention 19:15 UTC; scheduled reports hourly; integration sync 22:30 UTC. Pipeline health (accepted,
processed, queue, no-consent, bots, sampled, overload drops, errors) is on Tracking Settings. Graceful degradation:
settings fall back to defaults, the live push falls back to polling, integrations/AI failures never affect ingestion.

## DEPLOYMENT

1. Migration `20261127090000_visitor_intelligence` — additive (21 `vi_*` tables + enums, no changes to existing
   tables). Verified with `scripts/verify-migration-chain.sh` on an empty Postgres. Rollback: drop the `vi_*` tables
   and `Vi*` enums.
2. Code change outside the module: `CrmModule` exports `CrmAccessService`/`CrmActivityService`; `RealtimeGateway` adds
   `join:visitor-intel`; `app.module` registers `VisitorIntelModule`; admin nav gets one group; root layout mounts the
   consent banner + tracker; small `viTrack` calls in search, salon profile, booking flow, shop, owner register.

| Env var (backend) | Default | Purpose |
|---|---|---|
| `VI_TRACKING_ENABLED` | on (`false` = kill switch) | stop all ingestion and crons |
| `VI_VISITOR_PEPPER` | falls back to `JWT_ACCESS_SECRET` | pepper for pseudonymous keys — **set a dedicated stable value in prod** (changing it splits visitor history) |
| `VI_OWN_HOSTS` | `fastque.com,fastque.in,localhost,127.0.0.1` | referrers treated as internal |
| `WEB_PUBLIC_URL` | `WEB_BASE_URL` → `https://fastque.com` | base for short links / QR |
| `VI_GEOIP_MMDB_PATH` | unset | optional offline IP DB (plus `npm i maxmind`) |
| `VI_INTEGRATIONS_ENABLED` | off | global switch for GA4/Meta/Search Console/Ads |
| `TOTP_ENCRYPTION_KEY` | (existing) | encrypts integration secrets |
| `GEMINI_API_KEY`, `VI_GEMINI_MODEL` | (existing) / `gemini-2.5-flash` | optional LLM |
| `VI_OLLAMA_URL`, `VI_OLLAMA_MODEL` | `http://127.0.0.1:11434`, `llama3.1:8b` | optional local LLM |
| `VI_EMAIL_ENABLED`, `RESEND_API_KEY`, `VI_EMAIL_FROM` | off | alert / report email |
| `VI_DEMO_DATA_ENABLED` | off (never in production) | labelled demo data |

Web: `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_META_PIXEL_ID` (optional). Admin → Settings: grant `vi_staff_roles`.

## SCALE & COST (estimates, INR/month, excluding existing app hosting)

Assumes ~3 sessions/visitor, ~8 events/session, ~0.5 KB/event row incl. indexes, 180-day raw retention.

| Monthly visitors | Events/month | Hot storage | Architecture | Est. extra cost |
|---|---|---|---|---|
| 10k | ~0.25 M | ~0.75 GB | as built, existing Postgres | ₹0 (fits current DB) |
| 100k | ~2.5 M | ~7 GB | as built; add DB disk; keep sampling 1.0 | ₹500–1,500 (DB storage/IO) |
| 1M | ~25 M | ~70 GB | monthly-partition `vi_events`, overview on rollups for >30 d, read replica for dashboards, 2+ API instances (queue is per instance) | ₹6,000–15,000 (bigger DB + replica) |
| 10M | ~250 M | ~700 GB | sampling 0.2–0.5, durable queue (Redis/Kafka) instead of in-memory, ClickHouse/BigQuery for events, Postgres for rollups only | ₹40,000–1,20,000 |

AI: rules are free; Gemini Flash for one daily summary + a few hundred Ask phrasings ≈ ₹100–500/month; Ollama is
free but needs a host. GA4/Search Console free; Google/Meta ad APIs free (ad spend is yours). Cloudflare free plan
gives country/city headers.

---

## Completion matrix

| Area | Status |
|---|---|
| Schema + additive migration (21 tables), chain verified on empty DB | Implemented & verified |
| Ingestion API: consent/bot/sampling gates, dedupe, session hijack guard, redaction, verified conversions | Implemented & verified (integration tests + HTTP smoke + real browser events) |
| Consent banner, cookie preferences, privacy notice page | Implemented & verified in browser |
| Tracker on customer pages (page views, engagement, search, near me, salon view, booking, shop, partner register) | Implemented; search/page/engagement verified in browser; booking/shop/register hooks typechecked, not exercised end-to-end (no salons in QA DB) |
| Overview KPIs (+% vs previous), filters, trend, donuts, top cities, funnel, drill-down drawer | Implemented & verified in browser |
| Live visitors (socket push + polling, activity window, active vs inactive, timeline drawer) | Implemented & verified in browser |
| Visitor history (search, sort, paging, detail, registered profile with RBAC/masking, audit) | Implemented; anonymous verified; registered-profile path not exercised (no customer accounts in QA DB) |
| Geographic drill-down, demand map, opportunity scoring, assign → CRM task | Map/table/scoring verified; CRM assignment implemented, not exercised (no employee profiles in QA DB) |
| Search intelligence (top 100, trending, hourly/daily, city-wise, unfulfilled, high demand, kinds, filters, seasonal, synonyms) | Implemented & verified in browser |
| Journeys/funnels for every module + splits + observed vs inferred abandonment | Implemented & verified (salon booking); other modules show empty states until they send events |
| Traffic sources (first vs last touch, UTMs, referrers, landing pages, Search Console keywords) | Implemented; Search Console part needs external config |
| Conversion analytics | Implemented & verified |
| Campaigns, UTM links, QR codes, short-link redirect, Finance expense linking, CAC/ROI, compare, channel ranking | Create/QR/redirect verified in browser; expense linking implemented, not exercised (no expenses in QA DB) |
| Segments, consent-gated audiences, opt-in/out, suppression | Implemented; counts verified in tests; channel sending not implemented |
| Alerts (11 kinds, thresholds, cooldowns, in-app feed, email) | In-app verified in tests; email needs external config; WhatsApp not implemented |
| Intelligence Agent (rules + optional LLM summary), accept/reject/dismiss/CRM task | Rules verified in browser (10 recommendations on demo data); LLM path needs external config |
| Ask FastQue AI (whitelisted tools, scope, audit) | Verified in browser (compare, demand) and unit tests |
| Reports CSV/XLSX/PDF + schedules | Exports verified in browser; scheduled email needs external config |
| GA4 / Meta CAPI / Search Console / Google Ads / Meta Ads | Implemented, flag-gated — **needs external config**, not verified against live APIs |
| RBAC (capabilities, territory & salon scope, PII masking) | Scope verified in integration tests; capability map unit-tested; non-admin roles not clicked through in a browser |
| Salon-owner summary endpoint | Implemented, not verified (no owner UI page yet) |
| Retention, rollups, privacy access/erasure, demo data (dev-only, labelled) | Verified (retention/rollups/privacy in integration tests, demo data in browser) |
| Distributor scope | Not implemented (no distributor role) |
| Jobs / instant hiring / freelance stylist / loyalty journeys | Defined, empty until FastQue Talent etc. send events |

Tests: `packages/shared` 43 VI unit tests; backend `visitor-intel.unit.spec.ts` + `visitor-intel.integration.spec.ts`
(real Postgres, set `VI_TEST_DATABASE_URL`; includes a 2,000-event performance smoke: ~1.7–2.5 s locally);
web `lib/__tests__/visitor-intel-tracker.test.jsx`; existing admin-shell test updated for the new nav group.
Full suites on this branch: backend 2,327 passed / 9 skipped; web 1,545 passed, 5 failed — all 5 in
`components/bookings/__tests__/ArrivalAlertOverlay.test.jsx`, which fails identically on clean upstream master (pre-existing).

## Known limitations / future work

* In-memory ingestion queue per instance: a crash loses at most ~0.5 s of batches. Use Redis/Kafka at 1M+.
* Dashboards aggregate `vi_sessions` live; at 1M+ visitors move >30-day ranges to `vi_daily_metrics` and partition events.
* No IP geolocation on Railway without Cloudflare or an mmdb; city mostly from visitor choice.
* Visitors summed across cities in "compare" can double-count someone seen in two cities.
* Mobile app (React Native) is not instrumented; only fastque.com.
* No salon-owner dashboard page yet (API exists), no WhatsApp sender, no automated audience upload.
* Notifications: VI alerts live in their own feed; wiring into the global notification centre needs new types in
  `notifications.service.ts` + EN/HI labels.
