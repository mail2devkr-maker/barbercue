# BarberCue — Master State

Persistent source of truth across sessions. Last updated at the end of a follow-up session whose
headline result was the **verified India `adm1` city override** (Patna and 16 other state
capitals/UTs now resolve correctly) — see §6. That session built directly on the prior session's
work (refresh-token rotation race fix, backend production-readiness audit, and the global-location
City import reaching 99,797/99,797). Every claim below was verified during one of these two
sessions — read this file before doing anything else in a new session, and update it again before
your own handoff.

---

## 1. Architecture

- **Monorepo**: npm workspaces — `apps/backend` (NestJS + Prisma + Postgres), `apps/web` (Next.js
  16, App Router, Turbopack), `apps/mobile` (Expo/React Native), `packages/shared` (Zod schemas,
  types, path constants shared by backend and both clients).
- **Database**: Neon Postgres (production, pooled endpoint — see §6 on the one known caveat this
  causes for `prisma migrate deploy`), local Postgres for dev. Prisma ORM.
- **Hosting**: Railway. Three services in one project (`triumphant-unity`, project ID
  `0a338e79-e96a-4aac-99c9-8e94d48a2f03`, environment `production`, environment ID
  `41bff3cc-5c98-4c6d-9aa6-33cc519badb1`):
  - `@barbercue/backend` — service ID `7cd12053-1973-4622-9cdd-91656a9b5e92`, public URL
    `https://barbercuebackend-production.up.railway.app`, private DNS
    `barbercuebackend.railway.internal`, internal port `8080`.
  - `@barbercue/web` — service ID `23e368ec-d309-48fc-a697-b4968ed567cf`, public URL
    `https://barbercueweb-production.up.railway.app`.
  - `@barbercue/mobile` — service ID `ec65e522-7565-41e6-aee1-12b8e00686cf` (web build of the
    Expo app; not touched this session, still on an older commit).
- **Auth**: phone-OTP (disabled in production — no SMS provider configured), Google Sign-In (GSI,
  FedCM-based), staff/owner/admin email+password. Access tokens: short-lived signed JWT, held in
  browser memory only. Refresh tokens: opaque random string, SHA-256 hashed in DB
  (`refresh_tokens` table, now indexed on `tokenHash` — see §9), httpOnly cookie, 30-day expiry,
  rotated atomically on every use (see §9 — the rotation race is fixed).
- **Photo storage**: pluggable `StorageDriver` behind `ObjectStorageService`
  (`apps/backend/src/storage/`). Launch driver is `LocalDiskStorageDriver`, backed by a Railway
  persistent Volume (`@barbercue/backend-volume`, mounted at `/data/salon-photos`, 500MB). An
  `S3CompatibleStorageDriver` (R2/S3) exists and is fully implemented but not in use.
- **Location data model**: `Country → Region → City → Locality`, with `CityAlias` for native-name
  translations. Source: `dr5hn/countries-states-cities-database` v3.2-export.7. **The import is now
  complete in production** — see §6. Import script (`apps/backend/prisma/import-global-locations.ts`)
  is additive/idempotent (`upsert`), safely resumable, and protects the original 21 "legacy" India
  cities by a hardcoded key list. Safe to re-run in the future (e.g. against a newer dr5hn release)
  without re-doing completed work.
- **Route registration order matters** for any controller mounted under `salons/:salonId/...`:
  `SalonsController`'s public discovery route (`GET salons/:countryCode/:citySlug/:salonSlug`) is
  a fully-wildcard 3-segment pattern that Nest/Express will match for ANY 3-segment `salons/*`
  request if its module is registered first. `BookingsModule` and `QueueModule` are therefore
  imported before `SalonsModule` in `apps/backend/src/app.module.ts`. Any new
  `salons/:salonId/<literal>/...` controller must follow the same rule.

---

## 2. Current phase / status

1. **India `adm1` city override — COMPLETE (latest session).** 17 human-reviewed state
   capital/UT-HQ rows (exact source IDs, not names) now classify as eligible cities. `City` =
   99,814 (99,797 + 17). Patna, India now resolves correctly (`India → Bihar (IN-BR) → Patna`,
   slug `patna`) via both direct lookup and search. See §6 for the full list, verification, and
   rationale.
2. **Global location City import — COMPLETE (prior session, unchanged this session except for the
   +17 above).** `CityAlias` = 21, `Country` = 250/250, `Region` = 5,308/5,308. All post-import
   safety checks passed (legacy cities intact, no duplicates, zero orphaned salons). See §6.
3. **Refresh-token rotation race condition — FIXED (prior session).** The previously-known "Invalid
   refresh token" bug's root cause (a non-atomic check-then-revoke race in
   `TokenService.rotateRefreshToken`) is fixed, tested, and verified live against real concurrent
   requests. See §7.
4. **Backend production-readiness audit performed (prior session)** — one dependency/index fix
   applied (`RefreshToken.tokenHash` index), two real findings documented but NOT fixed pending
   more information (CORS `origin:true`, missing Prisma `directUrl`) — see §9.
5. **Premium visual refresh of `apps/web`** — complete, from an earlier session in this same
   overall effort. See git history (`0911df0`, `b6ddec1`, `49afc36`, `bcfa0e1`, and the Style
   Advisor/Premium-plans pass) if the detail is ever needed. Not touched in either of the last two
   sessions (backend-only scope, per explicit standing instruction).
6. **Mission B (India-first country-selector ordering in `apps/web`) — NOT STARTED, paused on an
   unresolved scope conflict.** The latest session's request explicitly asked for this
   `apps/web`-touching UX change, but an earlier standing instruction in the same session had
   restricted scope to `apps/backend/**` only ("Codex will handle frontend/web work separately").
   That conflict was surfaced back to the user rather than silently resolved either way, and no
   follow-up has arrived yet. Do not start this without either an explicit go-ahead to touch
   `apps/web` or confirmation that Codex is handling it. See §15.

---

## 3. Completed work (all sessions, headline only — see git history for full detail)

- Railway deployment pipeline fixes, global-location registration flow (Country→Region→City-search),
  photo upload, two route-shadowing fixes (`b8566ba`, `93a32c9`), full premium visual refresh —
  all from earlier sessions, all deployed and stable.
- **Prior session**: refresh-token race fix + regression tests (`117c94a`), `RefreshToken.tokenHash`
  index (`e1c7c97`), global-location importer hardening (`4e201fa`), and the production import run
  itself (data-only, no code — see §6).
- **Latest session**: verified India `adm1` city override — `APPROVED_ADM1_CITY_OVERRIDES` (17
  exact source IDs) in `global-locations.util.ts`, 7 new tests, and the production re-run that
  added exactly 17 rows (`5e546e7`). See §6.

---

## 4. In-progress work

None. Working tree is clean, `HEAD` = `origin/master`, the import is finished (no background
process running), and every commit this session is pushed and deployed. See §11 for exact SHAs.

---

## 5. Premium visual refresh — status

Complete as of the prior session (foundation, landing, salon profile, search, customer shell,
booking, queue, dashboard, register-shop, auth, account, Style Advisor, Premium plans). Not
touched this session. `apps/mobile` remains out of scope / untouched.

---

## 6. Database / import status — COMPLETE (including the India `adm1` override)

**Final verified state (production, checked directly via Prisma against Neon, not just the
importer's own exit code):**
```
Country:   250 / 250     (unchanged — already complete before the prior session)
Region:    5,308 / 5,308 (unchanged — already complete before the prior session)
City:      99,814        (99,797 base import + 17 approved adm1-override cities, latest session)
CityAlias: 21
Salon:     2  (unchanged — 0 orphaned; both salons' cityId verified to resolve to a real City row)
User:      4  (unchanged)
Locality:  0  (unchanged)
```
Also verified: `Bengaluru`'s row (`dfcf4697-1c36-40a1-8659-586513ae4650`) byte-identical to before
the import ever started; `Kochi` intact with the approved Cochin/Kochi identity override
(`sourceId: 131617`); zero duplicate `(countryId, slug)` or `(countryCode, slug)` groups anywhere
in the table.

**Cross-country verification** (not just India): `GET /cities/search` returns correct real results
for the US (San Francisco, California), GB (London, Westminster), and JP (Tokyo, Tokyo) in addition
to India. `GET /countries/:id/regions` returns real subdivisions for the US (50 states + territories
confirmed present). The Country→Region→City-search registration flow is genuinely global now, not
India-only.

**Patna / India `adm1` finding — FIXED in the latest session.** Patna (Bihar, India — a state
capital) was previously absent because its dr5hn source row is tagged `type='adm1'`
(administrative-boundary level), the same tag used for genuine non-city rows (districts, urban
agglomerations, wards) that the general classification rule correctly excludes. Rather than
changing that general rule (which would have pulled in every non-city `adm1` row across the whole
dataset — explicitly rejected as an approach), a full manual audit was done of **all India `adm1`
rows**, and exactly **17 were confirmed to be genuine state capitals / union-territory HQs** that
the general rule was wrongly excluding. Those 17 — and only those 17 — are now allow-listed **by
exact source ID, not by name**, in `APPROVED_ADM1_CITY_OVERRIDES`
(`apps/backend/src/global-locations/global-locations.util.ts`), following the same
previously-approved Kochi/Cochin identity-override philosophy. The other India `adm1` rows
(districts/UAs such as Bengaluru Urban, Central Delhi, North Delhi, Andheri, Dharavi) remain
correctly excluded — spot-checked directly in production. Delhi and Bengaluru were deliberately
**not** added to the override list because they already exist via the legacy-city path.

The 17 approved source IDs (see the code comment for the full list with city/state names): `133386`
(Patna), `57600` (Agartala), `57995` (Bhopal), `131649` (Daman), `131676` (Dehradun), `131778`
(Dispur), `131900` (Gandhinagar), `131905` (Gangtok), `132178` (Itanagar), `132399` (Kargil),
`132432` (Kavaratti), `132549` (Kohima), `133342` (Panaji), `133482` (Port Blair), `133490`
(Puducherry), `133606` (Ranchi), `133870` (Shillong).

Production re-run of the (already-idempotent) importer added exactly these 17 rows — confirmed via
the importer's own resume-check log ("17/99793 candidates genuinely remain") and via direct
post-write DB verification: all 17 present with correct region codes, zero duplicate
`(countryId, slug)` groups, the 5 spot-checked excluded rows still correctly absent. Verified live
via the production API: `GET /api/v1/cities/IN/patna` → `200`, `{"state":"Bihar","country":"India",
"slug":"patna", ...}`; `GET /api/v1/cities/search?...q=patna` returns Patna as the top result;
Bhopal, Ranchi, Dehradun, Panaji, Shillong, and Port Blair all independently spot-checked the same
way. Commit `5e546e7`, deployment `0161bd2c` — `SUCCESS`.

**The import process itself no longer exists** — it was a one-off, human-invoked script, not
deployed code, and it has finished. Do not look for a "running importer" in any future session
unless someone explicitly starts a new one (e.g. against a newer dr5hn release).

**If the import is ever re-run** (e.g. a newer dr5hn export), the hardened script (see §3, commit
`4e201fa`) will resume correctly and cheaply from whatever the database already has — it no longer
needs to walk already-inserted rows from scratch. See the script's own header comments for the
retry/resume design if extending it further.

---

## 7. Authentication / OAuth status

- **Refresh-token rotation race — FIXED this session.** `TokenService.rotateRefreshToken()`
  previously did a `findFirst` (read) then a separate `update` (write) to revoke a token —
  concurrent callers presenting the same still-valid token could both pass the check before either
  write landed, both minting a new pair from one old token. Fixed with a single atomic conditional
  `updateMany` (`WHERE tokenHash AND revokedAt IS NULL AND expiresAt > now`) — only one concurrent
  claim can ever match (`count === 1`); every other caller sees `count === 0` and is rejected.
  **Verified against real concurrency**, not just mocks: fired two genuinely simultaneous
  `POST /auth/refresh` calls at the local backend/Postgres with the same cookie — exactly one
  `201`, one `401 "already been used"`, reproduced multiple times including after a full server
  restart. 10 new regression tests in `apps/backend/src/auth/services/token.service.spec.ts`
  (didn't exist before). Commit `117c94a`.
- **Google Sign-In**: FedCM fix deployed in an earlier session, not re-touched. Not re-verified via
  a live human click-through this session (backend-only scope) — still worth a quick manual check
  if picked up.
- **Email/password (staff/owner/admin)**: unchanged, working.
- **Phone OTP**: disabled in production (no SMS provider configured) — pre-existing, unchanged.

---

## 8. Frontend status

Unchanged this session (backend-only scope, explicitly instructed). See the prior session's
detailed verification list in git history if needed — full premium visual refresh, verified live
in-browser as both an owner and customer account, typecheck/lint/build all clean at that time.

---

## 9. Backend / API status

- `apps/backend` — **400/400 Jest tests passing** (390 + 10 new for the refresh-token fix),
  `tsc --noEmit` clean. `nest build` still unverifiable locally on Windows (pre-existing `EPERM`
  file-lock issue, environmental — Railway's own container build is authoritative).
- **This session's backend changes** (3 commits, each isolated and independently validated):
  - `117c94a` — atomic refresh-token rotation fix + tests (§7).
  - `e1c7c97` — added `@@index([tokenHash])` on `RefreshToken` (new migration
    `20260827000000_add_refresh_token_hash_index`). Every login/refresh/revoke/session-list call
    looks this table up by `tokenHash`; there was no index on it at all before — a full table scan
    on the single hottest query in the whole auth system. Purely additive, no behavior change.
  - `4e201fa` — hardened `import-global-locations.ts` for long-running-connection reliability (see
    §6). No application runtime code touched — this file is a standalone CLI script, never
    imported by `main.ts`/`app.module.ts`.
- **Dependency/security audit performed**: Railway's build log reported "18 vulnerabilities (10
  moderate, 8 high)". Root-cause investigation: **zero of them affect `apps/backend`** — all 18 are
  in `apps/mobile` (Expo/Metro toolchain) and `apps/web` (Next.js/postcss/sharp, all fixed by a
  same-major `next` upgrade Codex/web would need to apply). npm workspaces hoist all three
  services' dependencies into one shared root `node_modules`, so a root-level `npm audit` (which is
  what Railway's build log reflects) sees every workspace's deps even though the deployed backend
  container never executes any Expo/Metro/Next code. No backend dependency changes were needed or
  made.
- **Production-readiness audit findings — documented, NOT fixed this session** (real, but each
  needs either more information or carries more regression risk than was appropriate to take on
  unilaterally in this pass):
  - **CORS is `app.enableCors({ origin: true, credentials: true })`** in `main.ts` — reflects any
    origin with credentials enabled. Combined with the production refresh cookie being
    `SameSite=None` (required for the cross-origin web/backend Railway domain split), this is a
    real credential-exfiltration surface for browser-based clients: any third-party site could
    issue a credentialed `fetch` to `/api/v1/auth/refresh` and CORS would let it read the response.
    Already flagged in-code as "tightened per-environment in a later phase" — never done. Not
    fixed this session because a safe fix requires knowing every legitimate browser-facing origin,
    including the Expo mobile-web build's actual production URL, which wasn't confirmed. Recommended
    fix: allowlist `WEB_BASE_URL` (already a correctly-set env var) plus the mobile-web origin,
    replacing `origin: true`.
  - **No `directUrl` configured in `schema.prisma`'s datasource block** — `prisma migrate deploy`
    therefore runs entirely over Neon's *pooled* connection string. Session-level
    `pg_advisory_lock` (Prisma Migrate's own internal mutex) is documented to be unreliable under
    PgBouncer-style transaction pooling, independent of anything else running. This is the most
    likely root cause of an earlier `P1002` advisory-lock-timeout deploy failure (investigated in
    an earlier session; NOT proven to be the concurrently-running city importer, which never runs
    Prisma Migrate and so shouldn't hold this specific lock under normal operation). Recommended
    fix (not applied): add a `directUrl` pointing at Neon's direct/non-pooled connection string,
    Prisma's own documented pattern for this exact scenario — needs a new Railway secret that
    wasn't available/safe to guess.
  - Everything else checked came back clean and was left alone: error handling (`AllExceptionsFilter`
    already never leaks stack traces to clients), rate limiting (`AUTH_THROTTLE` already tighter
    than the global default on every sensitive auth/queue/style-advisor route), idempotency
    (`IdempotencyInterceptor` already atomic-claim + response-snapshot, well-built), atomic
    conditional updates for state transitions (queue `call()` already used the exact `updateMany`
    pattern the refresh-token fix now also uses). A known, already-self-documented N+1 in
    `SalonsService.search` (2 aggregate queries per salon per page) was left alone — a deliberate,
    previously-documented tradeoff at current scale (2 production salons), not something to rewrite
    speculatively.

---

## 10. Environment / configuration status (names only, no values)

Unchanged from prior sessions. No Railway variables were changed this session.

**Real caveat for whoever runs Railway CLI commands next**: `railway variable`/`railway run` **do
not reliably honor `--service <id-or-name>`** — they silently operate on whichever service is
currently `railway service link`-ed instead. Always explicitly `railway service link
"@barbercue/<name>"` immediately before any `variable`/`run` command, and verify with `railway
variable list --json | grep RAILWAY_SERVICE_NAME` afterward.

**Auto-deploy on push**: this repo has a Railway GitHub integration — every push to `origin/master`
triggers backend and/or web deployments automatically. Do not manually trigger an additional
deployment on top of that.

---

## 11. Git status

- Branch: `master`. Working tree clean. `HEAD` = `origin/master` as of the end of this session — get
  ground truth with `git status` / `git rev-parse HEAD` / `git rev-parse origin/master` rather than
  trusting a hardcoded SHA here (this file cannot reliably record its own final commit hash).
- Commits pushed across the prior + latest session, oldest first (on top of `8c09c748`):
  ```
  117c94a  fix(auth): make refresh-token rotation atomic, closing a check-then-act race
  e1c7c97  perf(db): add missing index on refresh_tokens.tokenHash
  4e201fa  feat(import): harden global-location importer for long-running Neon reliability
  5e546e7  feat(location): add verified India adm1 city override (17 state capitals/UT HQs)
  ```
- No untracked/ignored-file changes beyond what was already established (see prior sessions' git
  history for `apps/backend/prisma/data/`, `import-global-locations-report.json`, and
  `BARBERCUE_HANDOFF.md`'s status — unchanged).
- Mission B (India-first country-selector ordering, `apps/web`) is **not** in this commit list —
  it was not implemented. See §2.6 and §15.

---

## 12. Latest relevant commit/hash

Run `git rev-parse HEAD` and `git rev-parse origin/master` for ground truth (should be equal). Do
not trust a hardcoded SHA in this section.

---

## 13. Known issues

1. ~~"Invalid refresh token." race condition~~ — **FIXED this session**, see §7.
2. ~~Global location import incomplete~~ — **COMPLETE**, see §6.
2b. ~~Patna, India (and 16 other `adm1`-tagged state capitals/UT HQs) excluded by design~~ —
   **FIXED in the latest session** via a 17-entry verified override, see §6. City count now
   99,814.
3. **CORS `origin: true` + `credentials: true`** — real gap, documented, not fixed. See §9.
4. **No Prisma `directUrl`** — likely contributor to intermittent `migrate deploy` advisory-lock
   failures. Documented, not fixed (needs a new Railway secret). See §9.
5. **Stray `BACKEND_INTERNAL_URL` variable on the backend service** — harmless, unchanged.
6. **Google Sign-In not re-verified live** since the last frontend deploy — quick manual check
   needed, not a re-investigation.
7. **`nest build` unverifiable locally on Windows** — known, pre-existing, not a code issue.
8. **Unrelated remote branch** `origin/fix/railway-same-origin-auth` — unknown status, unrelated.
9. Known, self-documented N+1 in `SalonsService.search` — low priority at current scale (2
   production salons), deliberately left alone. See §9.
10. **Mission B (India-first country-selector ordering) not started** — requires touching
    `apps/web`, which conflicts with the standing backend-only scope restriction from earlier in
    the same session that requested it. Flagged back to the user, unresolved as of this writing.
    See §2.6/§15.

---

## 14. Important architectural decisions (do not silently revisit)

- **Photo storage**: local-disk driver backed by a Railway Volume is the deliberate *launch*
  choice over S3/R2. Do not "simplify" this back to a single hardcoded driver.
- **API calls are same-origin by design** in production (`NEXT_PUBLIC_API_BASE_URL` relative) —
  intentional, for httpOnly refresh-cookie reliability. Do not "fix" back to absolute.
- **The 21 "legacy" India cities are permanently protected** by `LEGACY_CITY_KEYS`, matched by
  `(countryCode, slug)` only. `Bengaluru`'s ID (`dfcf4697-1c36-40a1-8659-586513ae4650`) must never
  change.
- **The import script is intentionally never run automatically** — no CI hook, no deploy step, no
  cron.
- **Visual refresh preserves the warm/editorial identity** — cream/charcoal/terracotta, Fraunces/
  Work Sans, gold as a sparing trust-signal accent. Do not switch direction without asking.
- **`app.module.ts` import order is load-bearing, not cosmetic**: any controller mounted at
  `salons/:salonId/<literal>/...` must have its module imported before `SalonsModule`.
- **City classification (`adm1-5` = excluded) is a previously-reviewed, deliberate general rule**,
  see §6/§13.2b: do not weaken it to "fix" a missing city. The one sanctioned exception is
  `APPROVED_ADM1_CITY_OVERRIDES` — a fixed, human-audited list of exactly 17 source IDs (not names,
  not a pattern) for genuine India state capitals/UT HQs. Any future addition to that list needs
  the same explicit per-row human review the 17 got (and the Kochi/Cochin override before them) —
  never widen it to "all adm1 rows" or add entries by name-matching.
- **Refresh-token single-use is enforced by an atomic conditional `updateMany`, not a unique DB
  constraint** (new this session, see §7): `tokenHash` has an index for lookup speed, but
  intentionally no unique constraint — the application layer (the atomic claim) is what guarantees
  single-use. Do not add a unique constraint on `tokenHash` expecting it to do this job; it isn't
  needed and isn't what makes the fix correct.

---

## 15. Exact next steps

1. **Read this file fully before doing anything else.**
2. Confirm the latest push landed (`git status`, `git log`) — don't assume, verify.
3. **Resolve the Mission B scope question first if location/country-selector UX work comes up
   again**: does India-first country-selector ordering belong to this backend-focused workstream
   (touching `apps/web`), or is Codex handling frontend work as the earlier standing instruction
   said? Get an explicit answer before touching `apps/web` — don't silently pick either
   interpretation. See §2.6/§13.10.
4. If picking backend work back up: CORS hardening and the Prisma `directUrl` addition (§9/§13.3-4)
   are the two most valuable remaining items, both documented with exact recommended fixes, both
   blocked only on information (mobile-web origin URL; a new Neon direct connection string) rather
   than uncertainty about what to do.
5. A live human click-through of Google Sign-In against production is still a good idea whenever a
   frontend session next has capacity (§7) — not urgent, not a regression, just never re-verified
   since the FedCM fix's original deploy.

---

## 16. Do NOT redo

- Do NOT re-diagnose the refresh-token race condition — it's fixed, tested, and verified against
  real concurrency. See §7.
- Do NOT re-run the global-location import assuming it's incomplete — it finished. Check §6's
  counts fresh, but expect City = 99,814.
- Do NOT re-investigate Patna, Bhopal, Ranchi, Dehradun, Panaji, Shillong, Port Blair, or the other
  10 approved `adm1`-override cities as "missing" — they're fixed and verified. See §6.
- Do NOT widen `APPROVED_ADM1_CITY_OVERRIDES` to "all adm1 rows" or add new entries by
  name-matching — it's a fixed, human-audited list of exactly 17 source IDs. A genuinely new
  candidate needs the same per-row review process, not a shortcut. See §6/§14.
- Do NOT add a unique constraint on `RefreshToken.tokenHash` — the index (§9) is for lookup speed
  only; single-use is enforced at the application layer, by design (§14).
- Do NOT change the CORS config or add a Prisma `directUrl` without first getting the missing
  information each needs (§9/§13.3-4) — both are real, both are documented with the exact
  recommended fix, neither should be guessed at.
- Do NOT re-investigate the booking/queue routing fixes, the premium visual refresh, or any
  earlier-session work not mentioned as changed above — all stable, all deployed.
