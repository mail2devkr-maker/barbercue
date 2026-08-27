# BarberCue — Master State

Persistent source of truth across sessions. Last updated by Session 2 (handoff to Session 3) at
approximately 93% context usage. Every claim below was verified during this session — read this
file before doing anything else in a new session, and update it again before your own handoff.

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
  FedCM-based as of this session), staff/owner/admin email+password. Access tokens: short-lived
  signed JWT, held in browser memory only. Refresh tokens: opaque random string, SHA-256 hashed in
  DB (`refresh_tokens` table), httpOnly cookie, 30-day expiry, rotated on every use.
- **Photo storage**: pluggable `StorageDriver` behind `ObjectStorageService`
  (`apps/backend/src/storage/`). Launch driver is `LocalDiskStorageDriver`, backed by a Railway
  persistent Volume (`@barbercue/backend-volume`, mounted at `/data/salon-photos`, 500MB). An
  `S3CompatibleStorageDriver` (R2/S3) exists and is fully implemented but not in use.
- **Location data model**: `Country → Region → City → Locality`, with `CityAlias` for native-name
  translations. Source: `dr5hn/countries-states-cities-database` v3.2-export.7. Import script
  (`apps/backend/prisma/import-global-locations.ts`) is additive/idempotent (`upsert`), matches and
  protects the original 21 "legacy" India cities by a hardcoded key list, never invented data.

---

## 2. Current phase / status

Two parallel workstreams are mid-flight, both intentionally left incomplete for a clean handoff:

1. **Global location data import into production Neon** — running, not finished. See §6.
2. **Premium visual refresh of `apps/web`** — foundation + 4 surfaces done, committed locally
   (not pushed/deployed). See §3 and §5.

Everything else (auth, booking, queue, photo upload, backend APIs) is stable and was NOT touched
this session except where explicitly noted in §3.

---

## 3. Completed work (this session, verified)

### 3a. Railway deployment pipeline — fixed and deployed
- Root cause of a failed Railway web build: a prior commit (`9765747`, made by the user directly,
  not this session) changed `NEXT_PUBLIC_API_BASE_URL` to a relative `/api/v1` path so browser
  requests stay same-origin (fixes the httpOnly refresh-cookie reliability across Railway's split
  `*.up.railway.app` service domains). Two *other* call sites read that same variable and need an
  **absolute** URL: `apps/web/lib/discovery-api.ts` (server-side/build-time fetch — this is what
  actually broke the Next.js static build) and `apps/web/lib/realtime.ts` (the live-queue
  WebSocket, which must stay a direct cross-origin connection, never proxied). Fixed in commit
  `48c7ca6` by introducing `BACKEND_INTERNAL_URL` (server-only, private Railway DNS) for the first
  and `NEXT_PUBLIC_BACKEND_ORIGIN` (public) for the second. **Deployed and verified live.**
- Companion Railway config fix (already live): `BACKEND_INTERNAL_URL` on the web service was
  originally set to `http://barbercuebackend:8080` (missing the `.railway.internal` suffix Railway
  private networking requires) — corrected to
  `http://barbercuebackend.railway.internal:8080`. This is what was causing every `/api/v1/*`
  browser request to 500 even on a deployment that built successfully.
- **Known stray config**: `BACKEND_INTERNAL_URL` also exists as an (unused, harmless) variable on
  the **backend** service itself — an artifact of the Railway CLI silently targeting whatever
  service is `railway service link`-ed rather than honoring `--service` reliably (see §10). Safe
  to delete from the backend service whenever convenient; backend code never reads it.
- Google Sign-In FedCM fix (`use_fedcm_for_button: true` in
  `apps/web/app/(auth)/login/page.tsx`) — routes the button's sign-in through the browser's native
  FedCM API instead of a `window.open()` popup, which was failing under this environment's
  automated-browser popup policy and is a known general fragility point for GSI's popup mode.
  Included in commit `8d79332`, **deployed**.

### 3b. Global location registration flow — code deployed, data import in progress
Commit `8d79332` (pushed, deployed, Railway `SUCCESS` on both backend and web) shipped:
- Backend: `CountriesController`/`CountriesService` (new), `CitiesController` gains
  `GET cities/search`, `apps/backend/src/global-locations/` (dr5hn source parser + classification
  utilities, pure and unit-tested), the additive Prisma migration (`Country`/`Region`/`CityAlias`
  tables + nullable `City` enrichment columns — **applied to production Neon**, confirmed via
  direct query), a trigram-index migration for city-name search (**applied**), and the standalone
  `import-global-locations.ts` / `seed-cities.ts` data scripts.
- Frontend: `RegisterSalonForm.tsx` rewritten from `GET cities/all` (a ~16MB unfiltered dump) to
  the new `Country → Region → City-search` flow (`CitySearchField.tsx`, debounced, race-safe).
  `POST /salons` contract unchanged (`{countryCode, citySlug, localitySlug}`).
- **This code is live in production right now**, but the `Country`/`Region`/`City` tables it reads
  are only partially populated — see §6. Until the import finishes, the country dropdown on the
  live registration page will show an incomplete list.

### 3c. Photo upload (owner-side) — deployed, verified end-to-end in production
Commit `90a2441`, live: `POST dashboard/salons/:id/photos/upload` (multipart, magic-byte type
detection, 5MB cap), backed by the Railway-Volume `LocalDiskStorageDriver`. Verified with a real
upload → volume file → DB row → public URL → browser render → delete, all against production.

### 3d. Premium visual refresh — committed locally, NOT pushed/deployed
See §5 for exactly what's done and what remains. Commit `0911df0`, sitting on top of `8d79332` on
the local `master` branch. **This commit has not been pushed** — deliberately, since the work is
explicitly incomplete (see the instruction that produced this document). `git status` at end of
session: local `HEAD` is 1 commit ahead of `origin/master`, 0 behind.

---

## 4. In-progress work

- **Global location data import** — see §6. Running in a background shell process, must not be
  stopped per explicit standing instruction from the user across this entire session.
- Nothing else is mid-edit. The working tree is clean except for the pre-existing untracked files
  noted in §11.

---

## 5. Pending work — premium visual refresh

**Done, verified (typecheck clean, lint clean, production build succeeds, no console errors, no
mobile overflow at 375px, fonts confirmed loading, tested live against local dev with real data):**
- Foundation: `next/font` (Fraunces display + Work Sans body), expanded `--bc-*` design tokens
  (type/spacing/elevation/radius scales, a gold accent reserved for ratings/trust signals only)
  in `apps/web/app/globals.css`, elevated `Button`/`Card` shared primitives.
- Landing page (`apps/web/app/(public)/page.tsx` + `landing.module.css`).
- Salon profile page (`apps/web/app/(public)/[countryCode]/[citySlug]/[salonSlug]/page.tsx`) —
  added a hero cover-photo (previously absent entirely), elevated header/CTAs, Services/Hours/
  Reviews now in `Card`s, fixed stale "Photos coming soon" → "No photos yet" copy.
- Search results (`apps/web/app/(public)/search/SearchClient.tsx`) — results now a responsive
  card grid; `SalonCard` rewritten to actually render `coverPhotoUrl` (was text-only before).
- Customer header/footer wordmark (`customer-shell.module.css`) — affects every customer page.

**NOT started — do these next, in roughly this order of customer-facing impact:**
- Booking flow (`apps/web/components/booking/*` — `BookingFlow.tsx`, `ServiceStep.tsx`,
  `DateStep.tsx`, `SlotStep.tsx`, `StaffStep.tsx`, `CancelBookingDialog.tsx`).
- Queue experience (`apps/web/components/queue/*` — customer-facing `PublicQueueJoinFlow.tsx`,
  `WalkInJoinFlow.tsx`, `QueueStatusPanel.tsx`; owner-facing `DashboardQueueView.tsx`).
- Dashboard/owner pages (`apps/web/app/(dashboard)/**` — salons list, settings, services, chairs,
  staff, hours, photos management UI itself — note the *upload feature* is done, its visual
  presentation is not).
- Register-shop page (`RegisterSalonForm.tsx` already got the *functional* Phase 6B rewrite this
  session — it has NOT had the premium visual pass; still uses ad-hoc inline styles).
- Auth pages (`apps/web/app/(auth)/*` — login, owner/staff/admin login, forgot/reset password).
- Account pages (`apps/web/app/(customer)/account/*`).
- Anything else discovered during inspection — the instruction is explicit that this list is not
  exhaustive.

**Design direction to continue with** (unchanged from this session's brief): elevate the existing
warm/editorial cream-charcoal-terracotta identity — do not replace it. Fresha and Booksy are UX/UI
*pattern* references only (discovery, search, profile presentation, booking flow, trust signals,
mobile UX) — never copy their branding, assets, copy, or distinctive layouts. Target feeling: "a
premium modern barbershop brand powered by excellent technology," not a generic SaaS dashboard.
Preserve all business logic, APIs, auth, and DB integration — visual/UX changes only, unless a
functional change is genuinely required to support the improved UX.

---

## 6. Database / import status

**Read this section fresh at the start of the next session — it will be stale by then.**

As of this handoff:
```
Country: 250   (fully populated — DONE)
Region:  5308  (fully populated — DONE)
City:    51521 of ~99,797 target (21 legacy + 51,500 of 99,776 new rows)
Salon:   2     (unchanged — the original demo salon + one real test registration from this
                session's user, "Handsome Center"-equivalent in production; NOT touched by the
                import, which never writes to Salon)
User:    4     (unchanged)
```

**The import is a background shell process, still running, NOT deployed code** — it's a one-off
data migration script (`apps/backend/prisma/import-global-locations.ts`) run from a local machine
against production's `DATABASE_URL` via `railway run`, because its source data
(`apps/backend/prisma/data/dr5hn/*.sql`, ~108MB, gitignored) only exists locally.

**History of this run, for context**: the import failed and was restarted from scratch **four
times** before the currently-running attempt, each time with the error `Server has closed the
connection` (Neon closing the long-lived connection partway through — happened at row 10,000, then
51,500, then (on an unpooled-connection variant) 11,500, and the connection-string swap did not
reliably help). The script is `upsert`-based and genuinely idempotent/safe to fully restart from
row 1 at any time — confirmed via dry-run (`Matched 21/21 existing cities` every time) and by
direct DB inspection after each failure (no protected row ever changed; `Bengaluru`'s ID has been
verified byte-identical throughout: `dfcf4697-1c36-40a1-8659-586513ae4650`).

**Do not stop or restart this import merely because it is slow** — this was an explicit, repeated
instruction from the user this session. If it fails again, the safe, already-proven action is to
simply re-run the exact same command:
```bash
cd apps/backend
railway run -- npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/import-global-locations.ts
```
(Ensure `railway service link "@barbercue/backend"` first, or pass an explicit `--service`/
`--environment`/`--project` — see §10 for a real CLI targeting caveat.) A safe, non-disruptive way
to check progress without touching the running process:
```bash
cd apps/backend
railway run -- node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{console.log(JSON.stringify({City:await p.city.count()}));await p.$disconnect()})()"
```

**Once the import completes**, verify: `City` count should land at 99,797 (21 legacy + 99,776 new
— exact figure was confirmed via dry-run and does not change run to run), `Country` 250, `Region`
5308, `Salon`/`User`/`Locality` unchanged, `Bengaluru`'s row ID unchanged, and the live `/countries`,
`/countries/:id/regions`, `/cities/search` endpoints against production returning the full dataset
(they already exist and are deployed — see §3b — only the underlying data is incomplete).

---

## 7. Authentication / OAuth status

- **Google Sign-In**: working in production as of this session (FedCM fix, §3a). Not re-verified
  end-to-end by a real human click-through after the *latest* deploy in this session — the fix was
  validated locally before deploy and the deploy itself succeeded, but no one has clicked
  "Continue with Google" against the live production URL since `8d79332` went out.
- **Email/password (staff/owner/admin)**: confirmed working in production this session.
- **Phone OTP**: disabled in production (`{"phoneOtp":false}` from live `/auth/methods`) — no SMS
  provider configured. This is a known, pre-existing, unchanged state, not a regression.
- **Known open issue, NOT fixed this session**: "Invalid refresh token." can appear on the
  register-shop page immediately after a successful shop registration (the page's own
  `refreshSession()` call, which fires right after `POST /salons` succeeds). Root cause was
  narrowed to `TokenService.rotateRefreshToken()` having a genuine, reproduced, non-atomic
  check-then-revoke race condition (`apps/backend/src/auth/services/token.service.ts` — a
  `findFirst` followed by a separate `update`, not wrapped in a transaction or a conditional
  atomic update). A minimum-safe fix was proposed and approved in principle
  (make the revoke atomic via a conditional `updateMany`, and separately make the frontend's
  `refreshSession()` failure non-fatal to an already-successful registration) but **was not
  implemented** — the session moved to other P0 work before returning to it. See the conversation
  history for the full investigation if needed; do not re-investigate from scratch.

---

## 8. Frontend status

- `apps/web` builds clean (`npm run build --workspace=@barbercue/web`), typechecks clean, lints
  clean, as of the current commit (`0911df0`, local-only).
- No automated frontend test suite exists in this repo (confirmed by search this session) —
  verification is typecheck + lint + build + manual/browser check only.
- Visual refresh status: see §5.
- `apps/mobile` was not touched this session and was not visually refreshed — out of scope for the
  "premium visual refresh" instruction, which was scoped to the web app.

---

## 9. Backend / API status

- `apps/backend` — 390/390 tests passing, typecheck clean, at the current commit. `nest build`
  could not be verified locally this session due to a recurring, pre-existing, documented Windows
  file-lock issue (`EPERM ... query_engine-windows.dll.node`, caused by a live dev server holding
  the Prisma engine file) — this is environmental, not a code defect; `tsc --noEmit` passing is
  the real signal, and Railway's own container build (which is what actually matters for
  deployment) has succeeded on every push this session.
- No backend API code changes are pending/uncommitted — everything backend-side that was written
  this session is already committed and deployed (`90a2441`, `48c7ca6`, `8d79332`).
- New endpoints live in production: `GET /countries`, `GET /countries/:id/regions`,
  `GET /cities/search`, `POST /dashboard/salons/:id/photos/upload`.

---

## 10. Environment / configuration status (names only, no values)

**Backend service** (`@barbercue/backend`) — variables present:
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `GOOGLE_WEB_CLIENT_ID`, `LOCAL_STORAGE_DIR`,
`LOCAL_STORAGE_PUBLIC_BASE_URL`, `WEB_BASE_URL`, `NODE_ENV`, `BACKEND_INTERNAL_URL` (stray/unused,
see §3a), plus Railway's own auto-injected `RAILWAY_*` variables. **Not present**:
`GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` (no
admin account is seeded in production), any `OBJECT_STORAGE_*` (R2 driver exists in code but is
not configured/active).

**Web service** (`@barbercue/web`) — variables present: `NEXT_PUBLIC_API_BASE_URL` (relative,
`/api/v1` — intentional, see §3a), `BACKEND_INTERNAL_URL` (private, server-only), 
`NEXT_PUBLIC_BACKEND_ORIGIN` (public, for the WebSocket), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, plus
Railway's own `RAILWAY_*` variables.

**Real caveat for whoever runs Railway CLI commands next**: `railway variable`/`railway run`
**do not reliably honor `--service <id-or-name>`** in this environment — they silently operate on
whichever service is currently `railway service link`-ed instead, regardless of what `--service`
says. This caused at least one real mistake this session (a variable fix landing on the wrong
service, silently, with the CLI reporting success). **Always explicitly `railway service link
"@barbercue/<name>"` immediately before any `variable`/`run` command, and verify with
`railway variable list --json | grep RAILWAY_SERVICE_NAME` afterward** — do not trust `--service`
alone. `railway logs`, `railway service list`, and `railway service status` did NOT show this
problem (they correctly honored explicit IDs).

Session was linked to `@barbercue/backend` at handoff time (the original default from before this
session started).

---

## 11. Git status

- Branch: `master`. Working tree clean (only the pre-existing untracked files below) once this
  document's own edits are committed.
- Local `HEAD` is **2 commits ahead of `origin/master` (`8d79332`), 0 behind**: `0911df0` (the
  premium visual refresh) plus a docs-only commit adding/updating this file. Run `git log
  --oneline -3` for the exact current hashes — this file cannot reliably record its own final
  commit hash (editing it to add that hash changes the hash again).
- **Neither of those 2 commits has been pushed.** `0911df0` is kept local because it is explicitly
  incomplete work, per the instruction that produced this document. The docs commit is left
  unpushed alongside it simply to keep the push decision as one deliberate action for a future
  session/human, rather than assumed here.
- Commit history this session, newest first (docs commit hash omitted — see above):
  ```
  (docs)   docs: add BARBERCUE_MASTER_STATE.md as the persistent handoff checkpoint              [LOCAL ONLY]
  0911df0  feat(web): premium visual refresh — foundation + landing/salon/search (in progress)   [LOCAL ONLY]
  8d79332  feat(location): global Country -> Region -> City-search registration flow              [pushed, deployed]
  48c7ca6  fix(web): resolve absolute URLs for server-side and WebSocket use                       [pushed, deployed]
  9765747  fix(web): make Railway auth and uploads same-origin           [made by the user directly, not this session]
  90a2441  feat(salon): let owners upload shop photos from their device                            [pushed, deployed]
  ```
- Untracked files present, intentionally never committed (all pre-existing from earlier work, not
  created this session's visual-refresh work):
  - `BARBERCUE_HANDOFF.md` — a prior session's handoff doc (superseded by this file; safe to
    delete, or keep as historical record — your call).
  - `apps/backend/import-global-locations-report.json` — generated manual-review report from the
    import script (regenerated every run, gitignore candidate, ~470KB).
  - `apps/backend/prisma/data/` — the ~108MB downloaded dr5hn source SQL files the import script
    reads. **Required for the import to work.** Never commit this (already effectively excluded by
    size/convention, though not yet added to `.gitignore` by name).
- `apps/mobile` has a separate remote branch, `origin/fix/railway-same-origin-auth` — appeared via
  `git fetch` this session, never merged or investigated. Unknown contents/purpose. Do not assume
  it's related to the visual refresh or the import; check it fresh if it becomes relevant.

---

## 12. Latest relevant commit/hash

- **Local `HEAD` (not pushed to remote)**: the docs commit adding this file, on top of `0911df0`
  (the visual refresh) — run `git log --oneline -1` for its exact hash (see §11 for why it isn't
  hardcoded here).
- **`origin/master` / currently deployed to Railway (backend + web)**: `8d79332312c22360d7094ba6c42e62f45dffc529`
- **Deployed to Railway mobile service**: `c94dbe398dc1da4611446f2f7327e6bd8dd4c380` (older; mobile
  only rebuilds on `apps/mobile/**` changes, none occurred this session)

---

## 13. Known issues

1. **"Invalid refresh token." on register-shop, right after a successful registration** — root
   cause identified (non-atomic refresh-token rotation race in `token.service.ts`), fix proposed
   and approved, NOT implemented. See §7.
2. **Global location import is incomplete in production** — see §6. Not a bug, just unfinished; the
   country dropdown on the live site will show a partial list until it finishes.
3. **Stray `BACKEND_INTERNAL_URL` variable on the backend service** — harmless (unread by backend
   code), safe cleanup item. See §3a/§10.
4. **Google Sign-In not re-verified live after the latest deploy** — see §7. Should be a quick
   manual check, not a re-investigation.
5. **`nest build` unverifiable locally on Windows** due to a recurring `EPERM` file lock — known,
   pre-existing, documented, not a code issue (see §9).
6. **Unrelated remote branch** `origin/fix/railway-same-origin-auth` of unknown status — see §11.
7. **Premium visual refresh is genuinely partial** — see §5's pending list. Do not present it as
   done; several major surfaces (booking, queue, dashboard, register-shop's own visuals, auth
   pages) have had zero visual work.

---

## 14. Important architectural decisions (do not silently revisit)

- **Photo storage**: local-disk driver backed by a Railway Volume is the deliberate *launch*
  choice over S3/R2 — ties storage to one instance/volume, accepted tradeoff for now. The
  `StorageDriver` abstraction exists specifically so switching to R2 later needs zero Photo-model
  or frontend change, only new env vars. Do not "simplify" this back to a single hardcoded driver.
- **API calls are same-origin by design** (`NEXT_PUBLIC_API_BASE_URL` = relative `/api/v1` in
  production) — this is intentional, for httpOnly refresh-cookie reliability across Railway's
  split service domains, not an accident to "fix" back to an absolute URL. Any new code that needs
  to reach the backend from a *server* context (Next.js Server Component, build-time, middleware)
  must use `BACKEND_INTERNAL_URL`, never `NEXT_PUBLIC_API_BASE_URL` directly — see
  `discovery-api.ts` for the established pattern. Any new code needing a *public, browser-facing*
  backend origin (e.g. another WebSocket-style direct connection) should use
  `NEXT_PUBLIC_BACKEND_ORIGIN`, following `realtime.ts`'s pattern.
- **The 21 "legacy" India cities are permanently protected** by the hardcoded `LEGACY_CITY_KEYS`
  list in `global-locations.util.ts`, matched by `(countryCode, slug)`, never by `sourceDataset`
  or any other heuristic. `Bengaluru`'s specific ID
  (`dfcf4697-1c36-40a1-8659-586513ae4650` in production) must never change — it's referenced by
  real, live production data (the demo salon and at least one real user registration).
- **The import script is intentionally never run automatically** — no CI hook, no deploy step, no
  cron. It requires a human to explicitly invoke it, every time, per its own file header. Do not
  wire it into any automated pipeline.
- **Visual refresh preserves the warm/editorial identity** — cream/charcoal/terracotta is the
  brand, Fraunces/Work Sans is the new typography, gold is a sparingly-used accent for trust
  signals only. This was an explicit, deliberate direction choice this session (user picked
  "elevate the existing look" over a dark-luxury or SaaS-minimal alternative that were also
  offered) — do not switch direction without asking again.

---

## 15. Exact next steps

1. **Read this file fully before doing anything else.**
2. Check the import's live status (read-only, see §6's exact command) — do not disturb it if still
   running; if it has since failed, simply re-run the same idempotent command again.
3. Confirm the `0911df0` visual-refresh commit is still local-only and intentionally unpushed
   (`git log --oneline -1`, `git status`) — do not assume it needs re-doing.
4. Continue the visual refresh systematically down §5's pending list, in the given priority order
   (booking flow → queue → dashboard/owner pages → register-shop's own visuals → auth pages →
   account pages), using the same verification bar as this session: typecheck, lint, build, live
   browser check (console errors, mobile overflow at 375px) after each surface.
5. Do not push/deploy the visual refresh until it's either complete or the user explicitly asks for
   an intermediate deploy — no instruction to deploy it exists yet.
6. Once the import finishes, verify it per §6's checklist, then do a real (human, not automated —
   see the FedCM/popup limitation documented earlier this session) click-through of Google Sign-In
   and the full registration flow against production.
7. When ready, address the known refresh-token race condition (§7/§13.1) — the fix was already
   scoped and approved in principle; implement, test, and get approval to deploy.

---

## 16. Do NOT redo

- Do NOT re-investigate the Railway build-failure root cause — it's fixed, deployed, and verified
  (§3a). Re-reading §3a/§13 is enough context if something related comes up.
- Do NOT re-run the global-location import from a cold assumption that it hasn't started — check
  §6's live count first. It may have completed since this document was written.
- Do NOT re-diagnose the "Invalid refresh token" issue from scratch — the root cause and fix are
  already known (§7/§13.1); just implement the already-approved fix.
- Do NOT re-do the FedCM Google Sign-In investigation — it's diagnosed, fixed, and deployed. A
  quick live click-through is enough, not a new investigation.
- Do NOT re-litigate the visual design direction — "elevate the existing warm/editorial look" was
  explicitly chosen over alternatives this session; proceed with it rather than asking again.
- Do NOT assume the local dev database and production Neon are in the same state — they have
  diverged in specific, documented ways this session (production has 2 salons vs whatever local
  has; production's location import may be at a different point than local's, which is complete).
- Do NOT delete or "clean up" `apps/backend/prisma/data/` — the import script needs it, and it's
  a slow, manual process to re-obtain (not something to casually regenerate).
