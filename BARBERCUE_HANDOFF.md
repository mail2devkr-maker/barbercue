# BarberCue — Project Handoff

Status snapshot as of 2026-08-26. Covers the Global Location Architecture initiative (Phases 0–6A.6) currently in progress. Read this before continuing any location-related work, and update it at the end of future sessions.

---

## 1. Launch Objective

BarberCue is a barbershop discovery/booking/queue-management platform (phone-OTP + staff/owner/admin auth, appointment booking, live queue/check-in with realtime updates — already built and deployed for India). The current initiative is making the platform's **location model genuinely global** rather than India-only, so BarberCue can expand into any country without a developer hand-editing a city list. This is prerequisite work for self-serve shop registration at scale; it does not itself add new customer-facing features.

A separate, larger "major upgrade" plan exists (Google Sign-In, shop public IDs, self-serve shop registration, landing page redesign, AI Style Advisor) — see the plan file `eager-leaping-starlight.md` if resuming that track. **This handoff covers only the Global Location Architecture work**, which is a dependency of that plan's shop-registration phase, not the full plan itself.

---

## 2. Approved Architectural Decisions (in force — do not silently revisit)

- **Model:** `Country → Region → City → Locality`. `Region` is nullable per city (not every country has one). No `Region.parentRegionId` (real evidence of nesting exists — 23.9% of source regions have a parent — but this was explicitly deferred, not implemented).
- **Master data source:** `dr5hn/countries-states-cities-database`, release **v3.2-export.7**. Never fetched live during import — pre-extracted SQL files read from `apps/backend/prisma/data/dr5hn/`.
- **`hasSubdivisions`** on `Country`: deliberately left at its schema default (`false`) for every row. **Never derive it mechanically** ("has ≥1 Region" was considered and rejected — breaks for city-states like Singapore). No consumer reads it yet; a real value requires a future, explicit product decision once a consumer exists.
- **City type classification:** explicit allowlist (`city, capital, municipality, town, village, locality, settlement, township, gov_seat, cities`) vs. exclusion list (`adm1-5, district, county, province, regency, prefecture, oblast, banner, section, region, administrative zone, area, historical, destroyed, abandoned, religious, historical_capital`). Anything on neither list → manual review. Never silently expand either list.
- **Slug hierarchy (approved, currently 2 tiers + blocked 3rd):**
  1. Bare city-name slug.
  2. On same-bare-name collision: city-name + region-**name** slug.
  3. **BLOCKED** — region ISO-3166-2 code as a 3rd tier was attempted (Phase 6A.6) and found to not work safely for 3 of the 4 known real cases (colliding cities can share the identical region, making a code-based suffix mathematically unable to distinguish them) and to risk changing an *already-live* city's slug for the 4th case. See §5.
  4. Otherwise: `unresolved-collision` → manual review. Never auto-merge, never invent an arbitrary suffix, never let write-order pick a winner.
- **Global cross-group collision detection (Phase 6A.3, implemented and validated):** slug uniqueness is checked across the *entire* per-country candidate set, not just within one same-name group — this was a real, proven defect (see §5) that has been fixed at the stages-1–2 level.
- **Legacy-city identity:** the 21 original BarberCue cities are identified **only** by the hardcoded `LEGACY_CITY_KEYS` allowlist (`countryCode`+`slug` pairs) in `global-locations.util.ts` — **never** by `sourceDataset` (it's `'dr5hn'` on all 99,797 rows after the real import, legacy and imported alike — this was a real bug, now fixed) and never by scanning the whole `City` table.
- **Kochi/Cochin:** approved, permanent override — dr5hn's "Cochin" (Kerala, sourceId 131617, wikiDataId Q1800) is the same real place as BarberCue's existing "Kochi" row. Backfill only; **never rename** the existing row.
- **`wikiDataId`:** stored as metadata, **never used as a sole matching key** — proven non-unique in the source (17,494 groups of unrelated cities share one Q-id in the worst case).
- **Existing registration contract preserved throughout:** `{countryCode, citySlug, localitySlug}` → `POST /salons`. Every phase of this work has been additive; `SalonsService.registerSalon`, `findCityBySlugOrThrow`, `findCityByCountryAndSlugOrThrow`, the B9 public URL structure (`/{countryCode}/{citySlug}/{salonSlug}`), and `RegisterSalonForm.tsx` have **not been touched**.
- **CityAlias scope:** native-name only, populated from dr5hn's `translations`/`native` fields where they differ from the display name. Not all ~19 available languages (would be millions of rows for no current consumer).
- **Search:** Postgres `pg_trgm` + a plain (non-`CONCURRENTLY`) GIN index on `City.name` — `CONCURRENTLY` was attempted first but fails inside Prisma's transaction wrapper on this Prisma version; a production deployment of the same table would need `CONCURRENTLY` run outside that wrapper (e.g. a separate `prisma db execute` step) — not yet designed.

---

## 3. Current Implementation Status

**Local database (`localhost:5432/barbercue_dev`) — populated, real import already run once:**

| Table | Count |
|---|---|
| Country | 250 |
| Region | 5,308 |
| City | 99,797 (21 legacy + 99,776 imported) |
| CityAlias | 21 |
| Salon | 1 (demo) |
| Locality | 1 (demo, "Indiranagar") |

**Backend code — implemented, tested, working:**
- `apps/backend/src/global-locations/` — `dr5hn-sql-parser.ts`, `dr5hn-types.ts`, `global-locations.util.ts` (classification, slug assignment, legacy matching — all pure, unit-tested), plus their `.spec.ts` files.
- `apps/backend/prisma/import-global-locations.ts` — the standalone importer (dry-run + real modes), separate from `seed.ts`/`seed-cities.ts`.
- `apps/backend/prisma/migrations/20260826151700_add_global_location_master_data/` — additive schema migration (Country/Region/CityAlias tables + nullable City columns). Applied to local DB.
- `apps/backend/prisma/migrations/20260826183132_add_city_name_trigram_index/` — `pg_trgm` + GIN index. Applied to local DB.
- New discovery APIs, additive, all existing routes untouched:
  - `GET /countries` — lean, sorted, ~250 rows.
  - `GET /countries/:countryId/regions` — bounded per country; `[]` for a region-less country (never fabricated).
  - `GET /cities/search?countryId=&regionId=&q=&limit=` — trigram-indexed, min 2-char query, default limit 20/max 50, ranked by exact-prefix → population → similarity → name. Live-verified: sub-2ms queries against the real 99,797-row table, correctly index-accelerated (confirmed via `EXPLAIN ANALYZE`).
- New shared types/schemas: `CountryDto`, `RegionDto`, `CitySearchResultDto`, `citySearchQuerySchema`, `COUNTRY_PATHS`, `DISCOVERY_PATHS.citySearch`.

**Not yet done:**
- Frontend (`RegisterSalonForm.tsx`) still uses the old `GET /cities/all` + client-side filtering. **This must not go into production as-is** — at 99,797 rows the endpoint returns a payload of many megabytes. Rework is Phase 6B, currently blocked (see §5).
- `GET /cities/all` has not been capped or retired (deliberately deferred, per explicit instruction — kept for compatibility until the frontend stops depending on it).

**Environments:** all work has been local-only. **Neon, Railway, and production have not been touched at any point in this entire initiative.**

---

## 4. Protected Data (never modify without a fresh, explicit approval)

**The 21 legacy cities** (hardcoded in `LEGACY_CITY_KEYS`, `global-locations.util.ts`) — `id`, `name`, `slug`, `countryCode` must never change:

Ahmedabad, Bengaluru, Bhubaneswar, Chandigarh, Chennai, Coimbatore, Delhi, Gurugram, Guwahati, Hyderabad, Indore, Jaipur, **Kochi** (never renamed to "Cochin"), Kolkata, Lucknow, Mumbai, Nagpur, Noida, Pune, Surat, Visakhapatnam — all `countryCode: 'IN'`.

Bengaluru's `City.id` specifically: `028c26d5-05c5-4f9c-bb95-bd72ed947b1f` (referenced by the demo Salon and the "Indiranagar" Locality — both must keep pointing at it).

**Also protected:** the B9 public URL structure, the existing 5 `cities.controller.ts` routes' response contracts, `registerSalonSchema`'s `{countryCode, citySlug, localitySlug}` shape.

---

## 5. Known Blockers

**BLOCKER — 4 real source cities missing from the database, recovery approach rejected (Phase 6A.6, currently open):**

| sourceId | name | country | region |
|---|---|---|---|
| 54097 | Las Vegas Santa Barbara | Honduras | Santa Bárbara |
| 54311 | Santa Rita Copan | Honduras | Copán |
| 73280 | San Andrés Hidalgo | Mexico | Oaxaca |
| 142523 | Emiliano Zapata Jalisco | Mexico | Jalisco |

**Root cause (proven, not theoretical):** the original import's slug-assignment algorithm let a short city name's region-disambiguated slug (e.g. "Las Vegas" + region "Santa Bárbara" → `las-vegas-santa-barbara`) coincide with an unrelated city's own bare name (e.g. "Las Vegas Santa Barbara" → `las-vegas-santa-barbara`). The importer's idempotent `upsert` silently treated the second arrival as a no-op update against the first — the city disappeared with no error and no manual-review entry. Fixed at the detection level (Phase 6A.3: a global, cross-group collision pass now correctly identifies all such cases and routes them to manual review instead of silently dropping them — validated via corrected dry-run, Phase 6A.4).

**The recovery attempt (Phase 6A.6) is blocked:** a 3rd slug tier using the region's ISO-3166-2 code was implemented and tested, but:
- For 3 of the 4 cases, the colliding cities are in the **identical region** — a region-code suffix is mathematically unable to distinguish them (both would compute the same suffixed string). They remain in manual review with no algorithmic fix possible via this approach.
- For the 4th case (San Andrés — different regions), the algorithm *can* produce two distinct slugs, but only by **changing the already-live database row's slug** (`73265`'s current slug `san-andres-hidalgo` would become `san-andres-hidalgo-mx-hid`) — violating the explicit "never modify an existing city slug" rule, because the pure candidate-based algorithm has no awareness of which candidate already has a live database row to protect.

**Decision required from the user** (options presented, not decided): (1) accept 0 recovery, leave all 4 in permanent manual review; (2) redesign the algorithm to accept a "protected slugs already in the database" input so only the *new* candidate in a pair may take a suffixed slug; (3) a hand-approved, one-off identity override for exactly these 4 sourceIds (same pattern as the Kochi/Cochin override); (4) something else. **Phase 6B (frontend rework) is blocked until this is resolved or explicitly deferred.**

**Cosmetic (not fixed, low priority):** the manual-review report's static reason string ("same name, same region as another source city") is inaccurate for cross-group collisions where the two cities are in *different* regions (e.g. San Andrés/Hidalgo vs. San Andrés Hidalgo/Oaxaca). Distinguishing stage-1 vs. stage-2/3 collisions in the report requires a small additive code change, not yet done.

**Recurring environment issue (not a data problem):** on Windows, `prisma generate` intermittently fails with `EPERM ... query_engine-windows.dll.node` when a previous dev-server or ts-node process is still holding the file. Resolved each time by stopping the specific stray Node process (never required user's data to be touched) — expect this to recur.

---

## 6. Deferred Items (explicitly out of scope for now, not forgotten)

- `hasSubdivisions` real computation — needs a `/countries`-consuming frontend to exist first, plus a curated exception list for city-states.
- `Region.parentRegionId` — real nesting exists in source data (24% of regions), not modeled.
- `CityAlias` beyond native-name (transliterations in other major languages) — deferred, no consumer yet.
- GeoNames as a secondary enrichment source for locality-level depth — not started.
- Retiring/capping `GET /cities/all` — kept for compatibility; frontend must stop using it first.
- `CREATE INDEX CONCURRENTLY` for a production-safe version of the trigram index migration — local migration uses a plain (briefly-locking) `CREATE INDEX` instead, fine for a single-developer local DB, not yet designed for production.
- Frontend rework of `RegisterSalonForm.tsx` (Country → Region → City-search → Locality flow) — Phase 6B, blocked by §5.
- The separate "major upgrade" plan (Google Sign-In, shop public IDs, self-serve registration, landing page, AI Style Advisor) — untouched this initiative, tracked separately.

---

## 7. Files Touched This Initiative (all local, none deployed)

```
apps/backend/prisma/schema.prisma                                    (modified — additive)
apps/backend/prisma/migrations/20260826151700_.../migration.sql      (new)
apps/backend/prisma/migrations/20260826183132_.../migration.sql      (new)
apps/backend/prisma/import-global-locations.ts                       (new)
apps/backend/prisma/seed-cities.ts                                   (new, pre-existing from earlier phase)
apps/backend/prisma/data/dr5hn/{countries,states,cities}.sql         (new — downloaded source data, gitignore candidate)
apps/backend/import-global-locations-report.json                     (new — generated output, gitignore candidate)
apps/backend/src/global-locations/*.ts + *.spec.ts                   (new)
apps/backend/src/salons/cities.controller.ts                         (modified — additive route)
apps/backend/src/salons/cities.service.ts                            (modified — additive method)
apps/backend/src/salons/cities.service.spec.ts                       (modified — additive tests)
apps/backend/src/salons/countries.controller.ts + .service.ts + .spec.ts (new)
apps/backend/src/salons/salons.module.ts                             (modified — registered new controller/service)
packages/shared/src/{types,schemas,constants}/index.ts                (modified — additive only)
```
**Nothing has been committed.** Recommend excluding `prisma/data/dr5hn/*` and `import-global-locations-report.json` from any future commit (generated/downloaded artifacts, not source).

---

## 8. Immediate Next Step

Resolve the §5 blocker decision, then either (a) proceed to Phase 6B (frontend rework) once the 4-city question is settled, or (b) explicitly defer it and move to Phase 6B leaving the 4 cities in manual review permanently.
