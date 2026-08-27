# BarberCue — Master State

Persistent source of truth across sessions. Last updated at the end of the session that finished
the premium visual refresh, fixed two backend route-shadowing bugs, and consolidated/pushed
everything to `origin/master`. Every claim below was verified during this session — read this file
before doing anything else in a new session, and update it again before your own handoff.

---

## 1. Architecture

- **Monorepo**: npm workspaces — `apps/backend` (NestJS + Prisma + Postgres), `apps/web` (Next.js
  16, App Router, Turbopack), `apps/mobile` (Expo/React Native), `packages/shared` (Zod schemas,
  types, path constants shared by backend and both clients).
- **Database**: Neon Postgres (production), local Postgres for dev. Prisma ORM.
- **Hosting**: Railway. Three services in one project (`triumphant-unity`, project ID
  `0a338e79-e96a-4aac-99c9-8e94d48a2f03`, environment `production`, environment ID
  `41bff3cc-5c98-4c6d-9aa6-33cc519badb1`):
  - `@barbercue/backend` — service ID `7cd12053-1973-4622-9cdd-91656a9b5e92`, public URL
    `https://barbercuebackend-production.up.railway.app`, private DNS
    `barbercuebackend.railway.internal`, internal port `8080`.
  - `@barbercue/web` — service ID `23e368ec-d309-48fc-a697-b4968ed567cf`, public URL
    `https://barbercueweb-production.up.railway.app`.
  - `@barbercue/mobile` — service ID `ec65e522-7565-41e6-aee1-12b8e00686cf` (web build of the
    Expo app; not touched this session, still on an older commit — see §11).
- **Auth**: phone-OTP (disabled in production — no SMS provider configured), Google Sign-In (GSI,
  FedCM-based), staff/owner/admin email+password. Access tokens: short-lived signed JWT, held in
  browser memory only. Refresh tokens: opaque random string, SHA-256 hashed in DB
  (`refresh_tokens` table), httpOnly cookie, 30-day expiry, rotated on every use.
- **Photo storage**: pluggable `StorageDriver` behind `ObjectStorageService`
  (`apps/backend/src/storage/`). Launch driver is `LocalDiskStorageDriver`, backed by a Railway
  persistent Volume (`@barbercue/backend-volume`, mounted at `/data/salon-photos`, 500MB). An
  `S3CompatibleStorageDriver` (R2/S3) exists and is fully implemented but not in use.
- **Location data model**: `Country → Region → City → Locality`, with `CityAlias` for native-name
  translations. Source: `dr5hn/countries-states-cities-database` v3.2-export.7. Import script
  (`apps/backend/prisma/import-global-locations.ts`) is additive/idempotent (`upsert`), matches and
  protects the original 21 "legacy" India cities by a hardcoded key list, never invented data.
- **Route registration order matters** for any controller mounted under `salons/:salonId/...`:
  `SalonsController`'s public discovery route (`GET salons/:countryCode/:citySlug/:salonSlug`) is
  a fully-wildcard 3-segment pattern that Nest/Express will match for ANY 3-segment `salons/*`
  request if its module is registered first. `BookingsModule` and `QueueModule` are therefore
  imported before `SalonsModule` in `apps/backend/src/app.module.ts` — see §9 and §14. Any new
  `salons/:salonId/<literal>/...` controller must follow the same rule.

---

## 2. Current phase / status

1. **Global location data import into production Neon** — still running/retrying, not finished.
   See §6. Untouched by this session per explicit instruction — read-only status checks only.
2. **Premium visual refresh of `apps/web`** — **complete** across every surface identified in the
   brief: foundation, landing, salon profile, search, customer shell, booking flow, queue
   experience (customer + owner), owner/staff dashboard (shop list, settings, services, staff,
   chairs, hours, photos, setup checklist, QR panel), shop registration, auth pages, and customer
   account pages. See §5. All of it is committed and, as of this update, pushed to `origin/master`
   — confirm with `git status` / `git log --oneline origin/master..HEAD` (should show 0 ahead).
3. **Two backend routing bugs found and fixed** during visual-refresh verification — see §9.

Everything else (core auth, booking/queue business logic, photo upload, realtime, backend APIs)
was **not** rewritten — this was a visual/UX pass plus two small, isolated routing fixes.

---

## 3. Completed work (this and prior sessions, verified)

### 3a. Railway deployment pipeline, global-location registration flow, photo upload
Deployed and verified in earlier sessions — see git history (`8d79332`, `48c7ca6`, `90a2441`,
`9765747`) if the detail is ever needed. Not re-touched this session except where noted below.

### 3b. Two production-affecting routing bugs — found, fixed, isolated commits
Both root-caused to the same mechanism: `SalonsModule` was imported before `BookingsModule`/
`QueueModule` in `app.module.ts`, so `SalonsController`'s fully-wildcard 3-segment discovery route
(`salons/:countryCode/:citySlug/:salonSlug`) intercepted every `salons/:salonId/<literal>/...`
request before it reached the real controller (Nest/Express matches by registration order, not
pattern specificity).

- **Booking routes** (`GET salons/:salonId/booking/{staff,availability,cancellation-policy}`) —
  were 404ing. Fixed in `b8566ba` (`BookingsModule` moved before `SalonsModule`). Verified live:
  full Service → Staff → Date → Slot → Confirm flow walked in the browser with real data.
- **Queue routes** (`GET/POST salons/:salonId/queue/{status,join}`) — were 404ing (with a
  `CITY_NOT_FOUND` body, since the discovery route was treating `queue` as a citySlug). Fixed in
  `93a32c9` (`QueueModule` moved before `SalonsModule` too). Verified live: joined the queue as a
  customer, watched it appear in the owner dashboard, called/cancelled it.

Both fixes: typecheck clean, 390/390 backend tests passing, no regression to the discovery route
itself. `apps/backend/src/app.module.ts`'s own comment documents the rule for future controllers.

### 3c. Premium visual refresh — now complete, four commits
- `b6ddec1` — booking flow (`BookingFlow`, `ServiceStep`, `StaffStep`, `DateStep`, `SlotStep`,
  `CancelBookingDialog`, new `booking.module.css`, step-progress indicator).
- `49afc36` — queue experience (`QueueStatusPanel` "ticket", `WalkInJoinFlow`,
  `PublicQueueJoinFlow`, `CheckInPanel`, `DashboardQueueView`, new `queue.module.css`).
- `bcfa0e1` — dashboard/owner pages (shop list, settings, services, staff, chairs, hours, photos,
  setup checklist, QR panel, admin placeholder; new `dashboard.module.css`), shop registration
  (`RegisterSalonForm`, `CitySearchField`, `form-styles.ts` — Country→Region→City-search flow and
  the `POST /salons` contract are unchanged), auth (`AuthCard`, `CustomerAuthCard`,
  `EmailPasswordLoginForm`, the customer login page's local styles), and a handful of remaining raw
  hex colors in the account pages (which had already been substantially refreshed earlier — see
  §16, this was previously mis-recorded in this file as "not started").
- Foundation/landing/salon-profile/search/customer-shell were completed and verified in an earlier
  session (`0911df0`).

All four: web typecheck clean, web lint clean, production build succeeds (`next build`, all
routes). See §8 for the full verification list.

---

## 4. In-progress work

- **Global location data import** — see §6. A retry of this (started earlier in this session,
  before the instruction to leave it untouched) completed *on its own* during this session's work
  and failed again with the same known `Server has closed the connection` error, after re-walking
  ~31,000 already-inserted rows (net city count unchanged — see §6). This session did not start,
  stop, or otherwise act on the import; only read-only count checks were performed, exactly as
  instructed.
- Nothing else is mid-edit. The working tree is clean except for the two files ignored in §11.

---

## 5. Premium visual refresh — final status

**Complete, verified (typecheck clean, lint clean, production build succeeds, no console errors
introduced, no horizontal overflow at 375px, tested live against local dev with real data as both
an owner and a customer account):**
- Foundation: `next/font` (Fraunces display + Work Sans body), `--bc-*` design tokens
  (type/spacing/elevation/radius scales, a gold accent for ratings/trust signals), elevated
  `Button`/`Card` shared primitives.
- Landing page, salon profile page, search results, customer header/footer shell.
- Booking flow (all steps + cancel dialog + step-progress indicator).
- Queue experience: customer ticket/join flows (authenticated walk-in join, QR scan-and-join,
  post-booking check-in) and the owner/staff live-queue dashboard.
- Owner/staff dashboard: shop list, settings hub + setup checklist + queue-QR panel, services,
  staff, chairs, hours, photos, admin placeholder.
- Shop registration (`RegisterSalonForm`, `CitySearchField`) — functional Country→Region→
  City-search flow from an earlier phase, visual pass done this session.
- Auth: customer login (phone-OTP + Google), owner/staff/admin login, forgot/reset password —
  all via the shared `AuthCard`/`CustomerAuthCard`/`EmailPasswordLoginForm` components.
- Customer account: profile (sessions list) and booking-history/home pages — these were already
  substantially refreshed (Card/Button, dedicated CSS modules, empty states with icons) before this
  session; only a few leftover raw hex colors and two native buttons were brought in line.

**Explicitly NOT touched (outside the stated "web app" scope, or not part of the named surfaces):**
- `apps/mobile` (Expo app) — never in scope for this refresh.
- `apps/web/app/(customer)/account/premium` and `.../style-advisor` — separate features, not named
  in the refresh brief; `premium.module.css` already used tokens when checked, `style-advisor` was
  not inspected at all this session.
- The refresh-token rotation race condition (§7) — a functional bug, not visual; still not fixed.

**Design direction used throughout** (unchanged across all sessions): elevate the existing
warm/editorial cream-charcoal-terracotta identity — never replaced it. Fresha and Booksy were UX/UI
*pattern* references only, never copied. Target feeling: "a premium modern barbershop brand powered
by excellent technology," not a generic SaaS dashboard. No business logic, API calls, auth flow, or
booking/queue behavior changed anywhere in the refresh — visual/UX only, plus the two isolated
routing fixes in §3b/§9 (found *during* refresh verification, fixed in their own commits).

---

## 6. Database / import status

**Read this section fresh at the start of the next session — it will be stale by then.** Use this
non-disruptive check (does not touch the running/failed process):
```bash
cd apps/backend
railway service link "@barbercue/backend"   # then verify: railway variable list --json | grep RAILWAY_SERVICE_NAME
railway run -- node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{console.log(JSON.stringify({Country:await p.country.count(),Region:await p.region.count(),City:await p.city.count(),Salon:await p.salon.count(),User:await p.user.count()}));await p.$disconnect()})()"
```

As of this handoff:
```
Country: 250   (fully populated — DONE)
Region:  5308  (fully populated — DONE)
City:    51521 of ~99,797 target (21 legacy + 51,500 of 99,776 new rows) — UNCHANGED since the
                previous handoff, across multiple checks this session.
Salon:   2     (unchanged, untouched by the import)
User:    4     (unchanged)
```

**History, for context**: this run has now failed at least **five** times with the identical
`Server has closed the connection` error (Neon closing the long-lived connection partway through),
most recently after re-walking ~31,000 rows without net progress (those rows were already inserted
by earlier attempts, so re-upserting them was a no-op — not data loss, just no forward progress
this attempt). The script is `upsert`-based and genuinely idempotent/safe to fully restart from row
1 at any time — confirmed repeatedly via dry-run (`Matched 21/21 existing cities` every time) and
direct DB inspection (no protected row ever changed; `Bengaluru`'s ID has been verified
byte-identical throughout: `dfcf4697-1c36-40a1-8659-586513ae4650`).

**Do not stop or restart this import merely because it is slow or has failed again** unless the
user explicitly asks — this was an explicit, repeated instruction across multiple sessions now. If
you do get explicit approval to retry, the safe, already-proven action is to simply re-run the
exact same command:
```bash
cd apps/backend
railway run -- npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/import-global-locations.ts
```
(Link the service first — see the snippet above; `--service` is not reliable, see §10.)

**Once the import completes**, verify: `City` count should land at 99,797 (21 legacy + 99,776 new),
`Country` 250, `Region` 5308, `Salon`/`User`/`Locality` unchanged, `Bengaluru`'s row ID unchanged,
and the live `/countries`, `/countries/:id/regions`, `/cities/search` endpoints against production
returning the full dataset (they're already deployed — only the underlying data is incomplete).

---

## 7. Authentication / OAuth status

- **Google Sign-In**: FedCM fix deployed and previously verified locally. **Not re-verified against
  the live production URL after this session's commits are deployed** — do a real (human, not
  automated — FedCM/popup fragility in automated browsers) click-through once Railway finishes
  redeploying (see §10 note on auto-deploy-on-push).
- **Email/password (staff/owner/admin)**: working — used extensively this session against local
  dev (owner login, staff barbers, etc.). Not specifically re-verified against production this
  session, but no code in this path changed beyond visual styling.
- **Phone OTP**: disabled in production (no SMS provider configured) — pre-existing, unchanged.
  Used extensively against local dev this session (`ConsoleOtpSender` logs the code) to verify the
  customer booking/queue/account flows.
- **Known open issue, still NOT fixed**: "Invalid refresh token." can appear on the register-shop
  page immediately after a successful shop registration. Root cause: `TokenService
  .rotateRefreshToken()` has a non-atomic check-then-revoke race
  (`apps/backend/src/auth/services/token.service.ts`). A minimum-safe fix was scoped and approved
  in principle in an earlier session (atomic conditional `updateMany`, plus making the frontend's
  `refreshSession()` failure non-fatal to an already-successful registration) but has never been
  implemented. Do not re-diagnose from scratch — implement the already-approved fix when picked up.

---

## 8. Frontend status

- `apps/web`: `tsc --noEmit` clean, `eslint` clean, `next build` succeeds (all routes) — verified
  multiple times this session, most recently at the final commit before push.
- No automated frontend test suite exists in this repo — verification is typecheck + lint + build +
  manual/browser check only.
- Visual refresh: complete — see §5.
- Live-browser verification this session covered, as both an owner account
  (`owner@barbercue-demo.com` / `DemoPass123!`, from `prisma/seed.ts`) and a customer account
  (phone OTP via `ConsoleOtpSender`, logged to the backend's console): landing, search, salon
  profile, booking flow end-to-end, queue join/status/call/cancel end-to-end, dashboard shop
  list/settings/services/staff/chairs/hours/photos, shop registration form, owner login, the QR
  scan-and-join page (both authenticated and OTP branches), and account/profile + account/bookings.
  No console errors introduced by this session's changes (the recurring 401/404/`ERR_CONNECTION_
  REFUSED` entries seen throughout are the pre-existing auth-refresh cycle, stale pre-fix log
  entries, and a WebSocket-upgrade-falls-back-to-polling artifact — not regressions).
- `apps/mobile` was not touched — out of scope for this refresh (web-only, per the original brief).

---

## 9. Backend / API status

- `apps/backend` — 390/390 tests passing, typecheck clean, at the current commit. `nest build`
  could not be verified locally this session due to a recurring, pre-existing, documented Windows
  file-lock issue (`EPERM ... query_engine-windows.dll.node`) — environmental, not a code defect;
  `tsc --noEmit` + the test suite are the real local signal, and Railway's own container build is
  authoritative for deployment.
- Two isolated backend fixes this session — see §3b: `b8566ba` (bookings routing) and `93a32c9`
  (queue routing). Both are two-line `app.module.ts` import-order changes plus a doc-comment
  correction each; no route paths, business logic, or schema touched.
- No other backend API code changed this session.

---

## 10. Environment / configuration status (names only, no values)

Unchanged from prior sessions — see git history for the full prior write-up if needed. No Railway
variables were changed this session.

**Real caveat for whoever runs Railway CLI commands next**: `railway variable`/`railway run` **do
not reliably honor `--service <id-or-name>`** — they silently operate on whichever service is
currently `railway service link`-ed instead. Always explicitly `railway service link
"@barbercue/<name>"` immediately before any `variable`/`run` command, and verify with `railway
variable list --json | grep RAILWAY_SERVICE_NAME` afterward.

**Auto-deploy on push**: this repo has a Railway GitHub integration — pushing to `origin/master`
(done at the end of this session, see §11) is expected to trigger backend and/or web deployments
automatically. Do not manually trigger an additional deployment on top of that; check Railway's own
deployment list for the result instead.

---

## 11. Git status

- Branch: `master`.
- **As of the end of this session, `master` has been pushed to `origin/master` and the two should
  match exactly (0 ahead, 0 behind).** Don't trust a hardcoded SHA in this document (it goes stale
  the instant this file is edited and committed) — get ground truth with:
  ```bash
  git status
  git log --oneline -10
  git rev-parse HEAD
  git rev-parse origin/master
  ```
- Commits pushed this session, oldest first (on top of `2472aab`, the previous handoff-doc fix):
  ```
  b8566ba  fix(bookings): register BookingsModule before SalonsModule to fix route shadowing
  93a32c9  fix(queue): register QueueModule before SalonsModule to fix route shadowing
  b6ddec1  feat(web): premium visual refresh for the booking flow
  49afc36  feat(web): premium visual refresh for the queue experience
  bcfa0e1  feat(web): premium visual refresh for dashboard, register-shop, auth, and account
  cb42ba1  chore: commit the location-architecture handoff doc, ignore import data/report
  ```
  (plus this file's own update commit, on top — check `git log` for its real hash, same
  self-reference caveat as always.)
- Untracked/ignored files, explained:
  - `apps/backend/prisma/data/` — the ~108MB dr5hn source SQL the import script reads. Added to
    `.gitignore` this session. **Required for the import to work — never delete it.**
  - `apps/backend/import-global-locations-report.json` — regenerated-every-run manual-review
    report. Added to `.gitignore` this session.
  - `BARBERCUE_HANDOFF.md` — previously untracked; **committed this session** (`cb42ba1`) since it
    carries genuine, non-duplicated Global Location Architecture decisions not reproduced at this
    depth elsewhere. No longer an untracked file.
- `apps/mobile` has a separate remote branch, `origin/fix/railway-same-origin-auth` — unrelated to
  this session's work, unmerged, unknown status. Check fresh if it becomes relevant.

---

## 12. Latest relevant commit/hash

Run `git rev-parse HEAD` and `git rev-parse origin/master` for ground truth — both should be equal
after this session's push (see §11). Do not trust a hardcoded SHA in this section.

---

## 13. Known issues

1. **"Invalid refresh token." on register-shop, right after a successful registration** — root
   cause identified, fix approved in principle, still NOT implemented. See §7.
2. **Global location import is incomplete in production** — see §6. Not a bug, just unfinished;
   has now failed 5 times with the same Neon connection-drop error. The country dropdown on the
   live site will show a partial list until it finishes.
3. **Stray `BACKEND_INTERNAL_URL` variable on the backend service** — harmless (unread by backend
   code), safe cleanup item, unchanged from prior sessions.
4. **Google Sign-In not re-verified live after this session's deploy** — see §7. Quick manual
   check needed, not a re-investigation.
5. **`nest build` unverifiable locally on Windows** due to a recurring `EPERM` file lock — known,
   pre-existing, documented, not a code issue (see §9).
6. **Unrelated remote branch** `origin/fix/railway-same-origin-auth` of unknown status — see §11.
7. ~~Premium visual refresh partial~~ — **resolved this session**, see §5.
8. ~~Booking/queue routes 404ing~~ — **resolved this session**, see §3b/§9.

---

## 14. Important architectural decisions (do not silently revisit)

- **Photo storage**: local-disk driver backed by a Railway Volume is the deliberate *launch*
  choice over S3/R2. The `StorageDriver` abstraction exists specifically so switching to R2 later
  needs zero Photo-model or frontend change, only new env vars. Do not "simplify" this back to a
  single hardcoded driver.
- **API calls are same-origin by design** (`NEXT_PUBLIC_API_BASE_URL` = relative `/api/v1` in
  production) — intentional, for httpOnly refresh-cookie reliability. Server-context code uses
  `BACKEND_INTERNAL_URL` (see `discovery-api.ts`); public browser-facing direct connections use
  `NEXT_PUBLIC_BACKEND_ORIGIN` (see `realtime.ts`).
- **The 21 "legacy" India cities are permanently protected** by the hardcoded `LEGACY_CITY_KEYS`
  list in `global-locations.util.ts`, matched by `(countryCode, slug)`, never by `sourceDataset` or
  any other heuristic. `Bengaluru`'s specific ID (`dfcf4697-1c36-40a1-8659-586513ae4650`) must
  never change.
- **The import script is intentionally never run automatically** — no CI hook, no deploy step, no
  cron. Requires an explicit human invocation every time.
- **Visual refresh preserves the warm/editorial identity** — cream/charcoal/terracotta is the
  brand, Fraunces/Work Sans is the typography, gold is a sparingly-used accent for trust signals
  only. Do not switch direction without asking again.
- **`app.module.ts` import order is load-bearing, not cosmetic** (new this session): any controller
  mounted at `salons/:salonId/<literal>/...` must have its module imported before `SalonsModule`,
  or `SalonsController`'s wildcard discovery route will silently intercept its requests (see §3b,
  §9, and the comment in `app.module.ts` itself). `BookingsModule` and `QueueModule` are already
  correctly ordered; any *new* such controller needs the same treatment.

---

## 15. Exact next steps

1. **Read this file fully before doing anything else.**
2. Check the import's live status (read-only, §6's exact command) — do not disturb it unless the
   user explicitly approves a retry.
3. Confirm this session's push landed (`git status`, `git log`) — don't assume, verify.
4. Do a real human click-through of Google Sign-In and the full registration flow against
   production once Railway's auto-deploy from this push finishes (see §10).
5. When ready, implement the already-approved refresh-token race-condition fix (§7/§13.1).
6. If further visual polish is wanted: `apps/mobile` was never in scope for this refresh and
   remains fully untouched; `account/premium` and `account/style-advisor` were not inspected this
   session and may or may not need work.

---

## 16. Do NOT redo

- Do NOT re-investigate the Railway build-failure root cause, the global-location registration
  flow, or the photo-upload feature — all fixed/shipped in earlier sessions, unrelated to this
  session's work.
- Do NOT re-run the global-location import from a cold assumption that it hasn't started — check
  §6's live count first.
- Do NOT re-diagnose the "Invalid refresh token" issue from scratch — root cause and fix are known
  (§7/§13.1); just implement it.
- Do NOT re-do the FedCM Google Sign-In investigation — diagnosed and fixed; a live click-through
  after deploy is enough.
- Do NOT re-litigate the visual design direction — "elevate the existing warm/editorial look" was
  explicitly chosen and has now been fully executed across every named surface.
- Do NOT re-diagnose the booking/queue routing 404s — root cause and fix are documented in §3b/§9/
  the `app.module.ts` comment. If a *new* `salons/:salonId/...` controller 404s, it's almost
  certainly the same registration-order issue — check `app.module.ts`'s import order first.
- Do NOT delete or "clean up" `apps/backend/prisma/data/` — the import script needs it.
- Do NOT assume `BARBERCUE_HANDOFF.md` is redundant/deletable — it's committed source control now,
  carrying detail not reproduced in this file.
