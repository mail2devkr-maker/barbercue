/**
 * Global location master-data importer (Country -> Region -> City, plus native-name CityAlias
 * rows) from dr5hn/countries-states-cities-database.
 *
 * Separate from prisma/seed.ts (demo/fixture data) and prisma/seed-cities.ts (the hand-written
 * 21-city India footprint) by design -- this is bulk, source-derived master data, not something
 * that belongs in either of those.
 *
 * SOURCE INPUT: this script never downloads data itself. It reads three pre-extracted SQL files
 * from a local directory (default: prisma/data/dr5hn, override with --source-dir or the
 * DR5HN_SOURCE_DIR env var):
 *   countries.sql  -- the `INSERT INTO \`countries\` VALUES ...;` statement(s) from dr5hn's
 *                      sql-world.sql.gz release asset
 *   states.sql     -- the `INSERT INTO \`states\` VALUES ...;` statement(s) from the same asset
 *   cities.sql     -- the full `INSERT INTO \`cities\` VALUES ...;` statement(s) from dr5hn's
 *                      sql-cities.sql.gz release asset
 * These are exactly the files produced by the extraction commands used during the Phase 0-2
 * investigation (`grep "^INSERT INTO \`countries\`" world.sql > countries.sql`, etc.) against
 * release v3.2-export.7. If the directory or any file is missing, this script fails loudly with
 * an explicit error rather than silently substituting another source.
 *
 * USAGE (never run automatically -- requires explicit human approval each time):
 *   Dry-run (no database writes at all):
 *     npx ts-node --compiler-options {"module":"CommonJS"} prisma/import-global-locations.ts --dry-run
 *   Real import (writes to whatever DATABASE_URL currently points at -- verify it first):
 *     npx ts-node --compiler-options {"module":"CommonJS"} prisma/import-global-locations.ts
 *
 * SAFETY MODEL:
 *   - The 21 existing BarberCue City rows are matched (never recreated) and only ever receive an
 *     UPDATE whose payload is restricted, by TypeScript's own type system (see
 *     `ExistingCityBackfillData` below), to the approved nullable enrichment fields. id / name /
 *     slug / countryCode are structurally impossible for this script to write to an existing row
 *     -- not just "checked afterward", the update payload type has no such fields at all.
 *   - A full pre-write snapshot of existing City/Salon/Locality state is taken and re-verified
 *     byte-for-byte after every write phase (see `assertNothingProtectedChanged`).
 *   - Every city that cannot be confidently classified or matched goes into a machine-readable
 *     manual-review report, never silently imported or silently discarded.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  LEGACY_CITY_KEYS,
  SOURCE_DATASET,
  SOURCE_VERSION,
  assignSlugsForCountry,
  classifyCityType,
  isLegacyCityKey,
  matchExistingCity,
  normalizeForSlug,
  slugify,
  type ExistingBarberCueCity,
  type SourceCityCandidate,
} from '../src/global-locations/global-locations.util';
import {
  COUNTRY_COLUMNS,
  STATE_COLUMNS,
  CITY_COLUMNS,
  type Dr5hnCountryRow,
  type Dr5hnStateRow,
  type Dr5hnCityRow,
} from '../src/global-locations/dr5hn-types';
import { parseInsertStatements } from '../src/global-locations/dr5hn-sql-parser';

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

// ---- CLI args ----
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sourceDirArg = args.find((a) => a.startsWith('--source-dir='))?.split('=')[1];
const SOURCE_DIR =
  sourceDirArg ?? process.env.DR5HN_SOURCE_DIR ?? path.join(__dirname, 'data', 'dr5hn');
const reportPathArg = args.find((a) => a.startsWith('--report-path='))?.split('=')[1];
const REPORT_PATH = reportPathArg ?? path.join(process.cwd(), 'import-global-locations-report.json');

// Only these fields may ever be written to an existing BarberCue City row. Structurally
// excludes id/name/slug/countryCode -- there is no way for a bug elsewhere in this file to leak
// a write to a protected field through this type.
interface ExistingCityBackfillData {
  countryId: string;
  regionId: string | null;
  nativeName: string | null;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  sourceDataset: string;
  sourceId: number;
  sourceVersion: string;
  wikiDataId: string | null;
}

interface ManualReviewEntry {
  sourceId: string;
  country: string;
  region: string | null;
  cityName: string;
  type: string | null;
  reason: string;
}

// The raw parser types (Dr5hn*Row) mark every column as `string | null` because any single
// column theoretically could be NULL in the dump. The VALIDATE step below rejects any row
// missing the specific fields this importer actually depends on -- these narrowed types make
// that guarantee visible to the type system afterward, instead of scattering non-null
// assertions (`!`) through every downstream use.
interface ValidatedCountryRow extends Dr5hnCountryRow {
  id: string;
  iso2: string;
  name: string;
}
interface ValidatedStateRow extends Dr5hnStateRow {
  id: string;
  name: string;
  country_id: string;
}
interface ValidatedCityRow extends Dr5hnCityRow {
  id: string;
  name: string;
  country_id: string;
  country_code: string;
}

function readSourceFile(filename: string): string {
  const full = path.join(SOURCE_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Missing required source file: ${full}\n` +
        `Expected a pre-extracted dr5hn ${SOURCE_VERSION} SQL fragment here. This script never ` +
        `downloads data itself -- see the file header for exactly how to produce this file.`,
    );
  }
  return fs.readFileSync(full, 'utf8');
}

function toNumberOrNull(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log(`\n=== BarberCue Global Location Importer ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no database writes)' : 'REAL IMPORT'}`);
  console.log(`Source dir: ${SOURCE_DIR}`);
  console.log(`Source: ${SOURCE_DATASET} ${SOURCE_VERSION}\n`);

  // ---- 1. LOAD + PARSE ----
  const countries = parseInsertStatements<Dr5hnCountryRow>(
    readSourceFile('countries.sql'),
    'countries',
    [...COUNTRY_COLUMNS],
  );
  const states = parseInsertStatements<Dr5hnStateRow>(readSourceFile('states.sql'), 'states', [
    ...STATE_COLUMNS,
  ]);
  const cities = parseInsertStatements<Dr5hnCityRow>(readSourceFile('cities.sql'), 'cities', [
    ...CITY_COLUMNS,
  ]);
  console.log(
    `Parsed from source: ${countries.length} countries, ${states.length} regions, ${cities.length} cities.`,
  );

  // ---- 2. VALIDATE ----
  const validationErrors: string[] = [];
  const validCountries = countries.filter((c): c is ValidatedCountryRow => {
    if (!c.id || !c.iso2 || !c.name) {
      validationErrors.push(`Country sourceId=${c.id}: missing id, iso2, or name`);
      return false;
    }
    return true;
  });
  const countryIdSet = new Set(validCountries.map((c) => c.id));
  const validStates = states.filter((s): s is ValidatedStateRow => {
    if (!s.id || !s.name || !s.country_id || !countryIdSet.has(s.country_id)) {
      validationErrors.push(`Region sourceId=${s.id}: missing id/name, or orphan country_id=${s.country_id}`);
      return false;
    }
    return true;
  });
  const validCities = cities.filter((c): c is ValidatedCityRow => {
    if (!c.id || !c.name || !c.country_id || !c.country_code || !countryIdSet.has(c.country_id)) {
      validationErrors.push(`City sourceId=${c.id}: missing id/name/country_code, or orphan country_id=${c.country_id}`);
      return false;
    }
    return true;
  });
  console.log(
    `Validation: countries ${validCountries.length}/${countries.length} valid, ` +
      `regions ${validStates.length}/${states.length} valid, ` +
      `cities ${validCities.length}/${cities.length} valid ` +
      `(${validationErrors.length} rejected).`,
  );

  // ---- 3. PRE-WRITE SNAPSHOT (safety assertions, decision #15) ----
  // Scoped explicitly to LEGACY_CITY_KEYS, never an unfiltered findMany(). A second run of this
  // importer (dry-run or real) sees a `cities` table that also contains every row THIS importer
  // already created -- an unfiltered snapshot would try to run existing-city reconciliation
  // against all of them too, which is exactly the Phase 4A bug (e.g. two legitimately distinct
  // same-named source rows like Armenia's two "Abovyan" entries getting misclassified as an
  // "ambiguous legacy match"). Only the 21 explicitly-approved legacy rows are ever reconciled;
  // everything else goes through the normal idempotent upsert path in step 8b.
  const existingCitiesSnapshot = await prisma.city.findMany({
    where: { OR: LEGACY_CITY_KEYS.map(({ countryCode, slug }) => ({ countryCode, slug })) },
    select: { id: true, name: true, slug: true, countryCode: true, state: true },
  });
  if (existingCitiesSnapshot.length !== LEGACY_CITY_KEYS.length) {
    throw new Error(
      `SAFETY STOP: expected exactly ${LEGACY_CITY_KEYS.length} legacy cities (one per ` +
        `LEGACY_CITY_KEYS entry) but found ${existingCitiesSnapshot.length} in the database. ` +
        `Refusing to continue -- investigate before re-running.`,
    );
  }
  const nonLegacyRow = existingCitiesSnapshot.find(
    (c) => !isLegacyCityKey(c.countryCode, c.slug),
  );
  if (nonLegacyRow) {
    throw new Error(
      `SAFETY STOP: query returned a row not present in LEGACY_CITY_KEYS ` +
        `(${nonLegacyRow.countryCode}/${nonLegacyRow.slug}). Refusing to continue.`,
    );
  }
  const salonCityIdsSnapshot = await prisma.salon.findMany({ select: { id: true, cityId: true } });
  const localityCityIdsSnapshot = await prisma.locality.findMany({
    select: { id: true, cityId: true },
  });
  const preCityCount = existingCitiesSnapshot.length;
  const preSalonCount = salonCityIdsSnapshot.length;
  const preLocalityCount = localityCityIdsSnapshot.length;
  console.log(
    `\nPre-write snapshot: ${preCityCount} existing cities, ${preSalonCount} salons, ${preLocalityCount} localities.`,
  );

  // ---- 4. CLASSIFY CITIES (type allowlist) ----
  let eligibleCount = 0;
  let excludedCount = 0;
  let reviewCount = 0;
  const manualReview: ManualReviewEntry[] = [];
  const countryById = new Map(validCountries.map((c) => [c.id, c]));
  const stateById = new Map(validStates.map((s) => [s.id, s]));
  const eligibleByCountry = new Map<string, ValidatedCityRow[]>();

  for (const city of validCities) {
    const classification = classifyCityType(city);
    if (classification === 'eligible') {
      eligibleCount++;
      if (!eligibleByCountry.has(city.country_id)) eligibleByCountry.set(city.country_id, []);
      eligibleByCountry.get(city.country_id)!.push(city);
    } else if (classification === 'excluded') {
      excludedCount++;
    } else {
      reviewCount++;
      manualReview.push({
        sourceId: city.id,
        country: countryById.get(city.country_id)?.name ?? city.country_code ?? 'unknown',
        region: stateById.get(city.state_id ?? '')?.name ?? null,
        cityName: city.name,
        type: city.type,
        reason: 'unrecognized-or-district-pattern-city-type',
      });
    }
  }
  console.log(
    `City classification: ${eligibleCount} eligible, ${excludedCount} excluded (admin-boundary/historical), ${reviewCount} manual review.`,
  );

  // ---- 5. EXISTING 21-CITY RECONCILIATION ----
  console.log(`\n=== Existing-city reconciliation ===`);
  let matchedCount = 0;
  const reconciliationPlan: {
    existing: ExistingBarberCueCity;
    source: SourceCityCandidate;
  }[] = [];
  for (const existing of existingCitiesSnapshot) {
    const country = validCountries.find((c) => c.iso2 === existing.countryCode);
    if (!country) {
      throw new Error(
        `SAFETY STOP: existing city "${existing.name}" (${existing.id}) has countryCode ` +
          `"${existing.countryCode}" which does not exist in the source dataset. Refusing to continue.`,
      );
    }
    const sourceCitiesInCountry: SourceCityCandidate[] = validCities
      .filter((c) => c.country_id === country.id)
      .map((c) => ({
        sourceId: c.id,
        name: c.name,
        countryCode: c.country_code ?? '',
        stateCode: c.state_code,
        wikiDataId: c.wikiDataId,
      }));
    const result = matchExistingCity(existing, sourceCitiesInCountry);
    if (result.kind === 'matched') {
      matchedCount++;
      reconciliationPlan.push({ existing, source: result.source });
    } else if (result.kind === 'unmatched') {
      manualReview.push({
        sourceId: '',
        country: country.name,
        region: existing.state,
        cityName: existing.name,
        type: null,
        reason: `EXISTING BARBERCUE CITY UNMATCHED against source -- requires explicit approval before any import proceeds`,
      });
      throw new Error(
        `SAFETY STOP: existing city "${existing.name}" could not be matched against the source ` +
          `dataset and no approved override exists for it. Add an approved override to ` +
          `APPROVED_IDENTITY_OVERRIDES (global-locations.util.ts) after explicit review, or ` +
          `investigate why the match disappeared. Refusing to continue.`,
      );
    } else {
      throw new Error(
        `SAFETY STOP: existing city "${existing.name}" matched ambiguously against ` +
          `${result.candidates.length} source rows. Refusing to continue -- this must be resolved ` +
          `by an explicit human decision, never automatically.`,
      );
    }
  }
  console.log(`Matched ${matchedCount}/${existingCitiesSnapshot.length} existing cities.`);

  // ---- 6. SLUG ASSIGNMENT FOR NEW CITIES (per-country, excluding already-claimed source rows) ----
  const claimedSourceIds = new Set(reconciliationPlan.map((r) => r.source.sourceId));
  const slugAssignmentByCountry = new Map<string, ReturnType<typeof assignSlugsForCountry>>();
  let unresolvedSlugCollisions = 0;
  for (const [countryId, list] of eligibleByCountry) {
    const candidates = list
      .filter((c) => !claimedSourceIds.has(c.id))
      .map((c) => ({
        sourceId: c.id,
        cityName: c.name,
        regionName: c.state_id ? stateById.get(c.state_id)?.name ?? null : null,
        regionCode: c.state_id ? stateById.get(c.state_id)?.iso3166_2 ?? null : null,
      }));
    const resolved = assignSlugsForCountry(candidates);
    for (const [sourceId, resolution] of resolved) {
      if (resolution.kind === 'unresolved-collision') {
        unresolvedSlugCollisions++;
        const city = list.find((c) => c.id === sourceId)!;
        manualReview.push({
          sourceId,
          country: countryById.get(countryId)?.name ?? 'unknown',
          region: city.state_id ? stateById.get(city.state_id)?.name ?? null : null,
          cityName: city.name,
          type: city.type,
          reason: 'unresolved-slug-collision (same name, same region as another source city)',
        });
      }
    }
    if (!slugAssignmentByCountry.has(countryId)) slugAssignmentByCountry.set(countryId, new Map());
    slugAssignmentByCountry.set(countryId, resolved);
  }
  console.log(
    `Slug assignment: ${unresolvedSlugCollisions} unresolved collisions sent to manual review.`,
  );

  // ---- 7. REPORT (dry-run stops here; real mode continues to writes below) ----
  const newCityInsertCandidates = [...eligibleByCountry.values()]
    .flat()
    .filter((c) => !claimedSourceIds.has(c.id))
    .filter((c) => {
      const res = slugAssignmentByCountry.get(c.country_id)?.get(c.id);
      return res?.kind === 'assigned';
    });

  console.log(`\n=== SUMMARY ===`);
  console.log(`COUNTRIES  source=${countries.length} valid=${validCountries.length}`);
  console.log(`REGIONS    source=${states.length} valid=${validStates.length}`);
  console.log(
    `CITIES     eligible=${eligibleCount} excluded=${excludedCount} review=${reviewCount} ` +
      `matched-existing=${matchedCount} would-insert-new=${newCityInsertCandidates.length}`,
  );
  console.log(`MANUAL REVIEW total entries: ${manualReview.length}`);

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), dryRun: DRY_RUN, manualReview }, null, 2));
  console.log(`Manual-review report written to: ${REPORT_PATH}`);

  if (DRY_RUN) {
    console.log(`\nDRY-RUN complete. No database writes were performed.`);
    return;
  }

  // ---- 8. REAL WRITES ----
  console.log(`\n=== Writing to database ===`);

  const countryIdMap = new Map<string, string>(); // dr5hn country.id -> BarberCue Country.id
  let countryInserted = 0, countryExisting = 0;
  for (const c of validCountries) {
    const found = await prisma.country.findUnique({ where: { isoCode2: c.iso2! } });
    if (found) {
      countryIdMap.set(c.id, found.id);
      countryExisting++;
      continue;
    }
    // hasSubdivisions is deliberately NOT derived here (e.g. "true iff >=1 Region row exists"
    // would be a plausible-looking but unreviewed product rule -- see the Phase 3 review: no
    // current code anywhere reads this field, and the mechanical rule breaks down for real
    // city-states like Singapore, which has 5 real ISO-3166-2 districts yet shouldn't force a
    // region picker in front of a shop owner). Left at the schema's own safe default until a
    // real consumer (a future /countries endpoint + frontend Region-step) exists and an explicit,
    // reviewed curation decision is made -- not decided unilaterally by this importer.
    const created = await prisma.country.create({
      data: {
        isoCode2: c.iso2!,
        isoCode3: c.iso3,
        name: c.name!,
        nativeName: c.native,
        phoneCode: c.phonecode,
        currencyCode: c.currency,
        slug: slugify(normalizeForSlug(c.name!)),
        postalCodeRegex: c.postal_code_regex,
        sourceDataset: SOURCE_DATASET,
        sourceId: toNumberOrNull(c.id),
        sourceVersion: SOURCE_VERSION,
        wikiDataId: c.wikiDataId,
      },
    });
    countryIdMap.set(c.id, created.id);
    countryInserted++;
  }
  console.log(`COUNTRIES inserted=${countryInserted} existing=${countryExisting}`);

  const regionIdMap = new Map<string, string>(); // dr5hn state.id -> BarberCue Region.id
  let regionInserted = 0, regionExisting = 0;
  for (const [countryId, list] of groupBy(validStates, (s) => s.country_id)) {
    const bcCountryId = countryIdMap.get(countryId);
    if (!bcCountryId) continue;

    // Region slug collisions (52 groups across 15 countries, verified in the Phase 3 review):
    // every case inspected is a genuinely distinct real-world place sharing a name with another
    // real-world place in the same country -- typically a first-level region/province/oblast and
    // a second-level city/district *within* it (e.g. Kazakhstan's Almaty region KZ-19 vs Almaty
    // city KZ-75; Bangladesh's Rangpur division BD-F vs Rangpur district BD-55, the latter's own
    // parent_id literally pointing at the former). These are never auto-merged. Since
    // Region.parentRegionId was explicitly not approved, disambiguation instead uses the
    // region's own ISO-3166-2 code (slugified) -- human-readable, semantically meaningful, and
    // guaranteed unique per country by the ISO-3166-2 standard itself (confirmed: all 52 groups
    // have a distinct, present iso3166_2 per row; `type` alone was checked and rejected as a
    // disambiguator -- e.g. Lithuania's "Kaunas" group has two rows both typed "district
    // municipality"). The source's own numeric sourceId is kept only as a final, extremely rare
    // fallback for the ~8/5,308 rows globally that lack an iso3166_2 at all.
    const bareGroups = new Map<string, ValidatedStateRow[]>();
    for (const s of list) {
      const bare = slugify(normalizeForSlug(s.name));
      if (!bareGroups.has(bare)) bareGroups.set(bare, []);
      bareGroups.get(bare)!.push(s);
    }
    const slugFor = new Map<string, string>(); // state.id -> final slug
    for (const [bareSlug, group] of bareGroups) {
      if (group.length === 1) {
        slugFor.set(group[0].id, bareSlug);
        continue;
      }
      const byDisambiguated = new Map<string, ValidatedStateRow[]>();
      for (const s of group) {
        const codeSlug = s.iso3166_2 ? slugify(normalizeForSlug(s.iso3166_2)) : null;
        const disambiguated = codeSlug ? `${bareSlug}-${codeSlug}` : `${bareSlug}-${s.id}`;
        if (!byDisambiguated.has(disambiguated)) byDisambiguated.set(disambiguated, []);
        byDisambiguated.get(disambiguated)!.push(s);
      }
      for (const [disambiguatedSlug, subGroup] of byDisambiguated) {
        if (subGroup.length === 1) {
          slugFor.set(subGroup[0].id, disambiguatedSlug);
        } else {
          // Extremely rare: iso3166_2 itself collided or was missing for >1 row in the same
          // group. Fall back to the source's own numeric id, which is always unique.
          for (const s of subGroup) slugFor.set(s.id, `${disambiguatedSlug}-${s.id}`);
        }
      }
    }

    for (const s of list) {
      const slug = slugFor.get(s.id)!;
      const found = await prisma.region.findFirst({ where: { countryId: bcCountryId, slug } });
      if (found) {
        regionIdMap.set(s.id, found.id);
        regionExisting++;
        continue;
      }
      const created = await prisma.region.create({
        data: {
          countryId: bcCountryId,
          code: s.iso3166_2,
          name: s.name,
          nativeName: s.native,
          kind: s.type,
          slug,
          sourceDataset: SOURCE_DATASET,
          sourceId: toNumberOrNull(s.id),
          sourceVersion: SOURCE_VERSION,
          wikiDataId: s.wikiDataId,
        },
      });
      regionIdMap.set(s.id, created.id);
      regionInserted++;
    }
  }
  console.log(`REGIONS inserted=${regionInserted} existing=${regionExisting}`);

  // ---- 8a. Backfill the reconciled existing 21 cities (structurally restricted payload) ----
  let backfilled = 0;
  for (const { existing, source } of reconciliationPlan) {
    const sourceCity = validCities.find((c) => c.id === source.sourceId)!;
    const bcCountryId = countryIdMap.get(sourceCity.country_id);
    const bcRegionId = sourceCity.state_id ? regionIdMap.get(sourceCity.state_id) ?? null : null;
    if (!bcCountryId) continue;
    const data: ExistingCityBackfillData = {
      countryId: bcCountryId,
      regionId: bcRegionId,
      nativeName: sourceCity.native,
      latitude: toNumberOrNull(sourceCity.latitude),
      longitude: toNumberOrNull(sourceCity.longitude),
      population: toNumberOrNull(sourceCity.population),
      sourceDataset: SOURCE_DATASET,
      sourceId: toNumberOrNull(sourceCity.id)!,
      sourceVersion: SOURCE_VERSION,
      wikiDataId: sourceCity.wikiDataId,
    };
    await prisma.city.update({ where: { id: existing.id }, data });
    backfilled++;
  }
  console.log(`EXISTING CITIES backfilled=${backfilled}`);

  // ---- 8b. Insert new eligible cities, batched ----
  let cityInserted = 0;
  for (let i = 0; i < newCityInsertCandidates.length; i += BATCH_SIZE) {
    const batch = newCityInsertCandidates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((c) => {
        const resolution = slugAssignmentByCountry.get(c.country_id)!.get(c.id)!;
        const slug = resolution.kind === 'assigned' ? resolution.slug : slugify(normalizeForSlug(c.name));
        const bcCountryId = countryIdMap.get(c.country_id)!;
        const bcRegionId = c.state_id ? regionIdMap.get(c.state_id) ?? null : null;
        return prisma.city.upsert({
          where: { countryId_slug: { countryId: bcCountryId, slug } },
          update: {},
          create: {
            name: c.name,
            slug,
            countryCode: c.country_code ?? '',
            state: c.state_id ? stateById.get(c.state_id)?.name ?? '' : '',
            country: countryById.get(c.country_id)?.name ?? '',
            countryId: bcCountryId,
            regionId: bcRegionId,
            nativeName: c.native,
            latitude: toNumberOrNull(c.latitude),
            longitude: toNumberOrNull(c.longitude),
            population: toNumberOrNull(c.population),
            sourceDataset: SOURCE_DATASET,
            sourceId: toNumberOrNull(c.id),
            sourceVersion: SOURCE_VERSION,
            wikiDataId: c.wikiDataId,
          },
        });
      }),
    );
    cityInserted += batch.length;
    console.log(`  ...cities processed: ${cityInserted}/${newCityInsertCandidates.length}`);
  }
  console.log(`CITIES inserted (idempotent upsert)=${cityInserted}`);

  // ---- 8c. Native-name aliases only (decision #6) ----
  let aliasInserted = 0, aliasExisting = 0, aliasSkipped = 0;
  for (const { existing, source } of reconciliationPlan) {
    const sourceCity = validCities.find((c) => c.id === source.sourceId)!;
    if (!sourceCity.native || sourceCity.native === existing.name) {
      aliasSkipped++;
      continue;
    }
    const found = await prisma.cityAlias.findFirst({
      where: { cityId: existing.id, name: sourceCity.native },
    });
    if (found) {
      aliasExisting++;
      continue;
    }
    await prisma.cityAlias.create({
      data: { cityId: existing.id, name: sourceCity.native, kind: 'NATIVE_NAME' },
    });
    aliasInserted++;
  }
  console.log(`ALIASES (existing-city backfill pass) inserted=${aliasInserted} existing=${aliasExisting} skipped=${aliasSkipped}`);

  // ---- 9. POST-WRITE SAFETY ASSERTIONS ----
  await assertNothingProtectedChanged({
    preCityCount,
    preSalonCount,
    preLocalityCount,
    existingCitiesSnapshot,
    salonCityIdsSnapshot,
    localityCityIdsSnapshot,
  });
  console.log(`\nAll post-write safety assertions passed.`);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

async function assertNothingProtectedChanged(args: {
  preCityCount: number;
  preSalonCount: number;
  preLocalityCount: number;
  existingCitiesSnapshot: { id: string; name: string; slug: string; countryCode: string; state: string }[];
  salonCityIdsSnapshot: { id: string; cityId: string }[];
  localityCityIdsSnapshot: { id: string; cityId: string }[];
}) {
  const {
    preCityCount,
    preSalonCount,
    preLocalityCount,
    existingCitiesSnapshot,
    salonCityIdsSnapshot,
    localityCityIdsSnapshot,
  } = args;

  const postCityCount = await prisma.city.count({
    where: { id: { in: existingCitiesSnapshot.map((c) => c.id) } },
  });
  if (postCityCount !== preCityCount) {
    throw new Error(
      `SAFETY VIOLATION: expected ${preCityCount} of the original existing City rows to still ` +
        `exist by id, found ${postCityCount}.`,
    );
  }

  for (const snap of existingCitiesSnapshot) {
    const now = await prisma.city.findUniqueOrThrow({ where: { id: snap.id } });
    if (now.name !== snap.name || now.slug !== snap.slug || now.countryCode !== snap.countryCode) {
      throw new Error(
        `SAFETY VIOLATION: existing city ${snap.id} changed a protected field. ` +
          `before=${JSON.stringify(snap)} after=${JSON.stringify({ name: now.name, slug: now.slug, countryCode: now.countryCode })}`,
      );
    }
  }

  const postSalonCount = await prisma.salon.count();
  if (postSalonCount !== preSalonCount) {
    throw new Error(`SAFETY VIOLATION: Salon count changed from ${preSalonCount} to ${postSalonCount}.`);
  }
  const postSalons = await prisma.salon.findMany({ select: { id: true, cityId: true } });
  for (const before of salonCityIdsSnapshot) {
    const after = postSalons.find((s) => s.id === before.id);
    if (!after || after.cityId !== before.cityId) {
      throw new Error(`SAFETY VIOLATION: Salon ${before.id}'s cityId changed.`);
    }
  }

  const postLocalityCount = await prisma.locality.count();
  if (postLocalityCount !== preLocalityCount) {
    throw new Error(
      `SAFETY VIOLATION: Locality count changed from ${preLocalityCount} to ${postLocalityCount}.`,
    );
  }
  const postLocalities = await prisma.locality.findMany({ select: { id: true, cityId: true } });
  for (const before of localityCityIdsSnapshot) {
    const after = postLocalities.find((l) => l.id === before.id);
    if (!after || after.cityId !== before.cityId) {
      throw new Error(`SAFETY VIOLATION: Locality ${before.id}'s cityId changed.`);
    }
  }
}

main()
  .catch((err) => {
    console.error('\nIMPORT FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
