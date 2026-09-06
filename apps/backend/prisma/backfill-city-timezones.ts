/**
 * One-off City.timezone backfill (Part 4, auto timezone selection).
 *
 * import-global-locations.ts now persists `timezone` for every city it inserts going forward,
 * but that importer's bulk-insert step is deliberately a no-op on conflict (`update: {}` --  see
 * its own comment on why: resume performance, never re-diffing rows the DB already proves are
 * done). That means the ~99,800 cities it already inserted in past runs never receive this column
 * just by re-running the importer. This script is the separate, explicitly-approved pass that
 * fills in ONLY the new `timezone` column for rows the importer already created -- it never
 * touches any other field, never creates or deletes a row, and never overwrites a `timezone`
 * value that's already set (so a value corrected by hand or by a future dataset version is never
 * clobbered by re-running this).
 *
 * SOURCE INPUT: identical convention to import-global-locations.ts -- reads a pre-extracted
 * `cities.sql` from the same local directory (default prisma/data/dr5hn, override with
 * --source-dir or DR5HN_SOURCE_DIR). Never downloads anything itself.
 *
 * USAGE (never run automatically -- requires explicit human approval each time, exactly like
 * import-global-locations.ts):
 *   Dry-run (no database writes at all):
 *     npx ts-node --compiler-options {"module":"CommonJS"} prisma/backfill-city-timezones.ts --dry-run
 *   Real backfill (writes to whatever DATABASE_URL currently points at -- verify it first):
 *     npx ts-node --compiler-options {"module":"CommonJS"} prisma/backfill-city-timezones.ts
 *
 * SAFETY MODEL:
 *   - Matches rows by (sourceDataset, sourceVersion, sourceId) only -- the same identity key the
 *     importer itself uses -- never by name/slug (which could coincidentally collide).
 *   - WHERE clause requires the existing row's timezone IS NULL: an already-populated value is
 *     never touched, by construction of the query, not just "checked afterward".
 *   - Only writes the single `timezone` column. No other field is read from the source row here.
 *   - Skips (does not write) any source row whose own `timezone` is null/empty -- there is
 *     nothing to backfill from, and writing null-over-null would be a wasted no-op write anyway.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { SOURCE_DATASET, SOURCE_VERSION } from '../src/global-locations/global-locations.util';
import { CITY_COLUMNS, type Dr5hnCityRow } from '../src/global-locations/dr5hn-types';
import { parseInsertStatements } from '../src/global-locations/dr5hn-sql-parser';

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sourceDirArg = args.find((a) => a.startsWith('--source-dir='))?.split('=')[1];
const SOURCE_DIR =
  sourceDirArg ?? process.env.DR5HN_SOURCE_DIR ?? path.join(__dirname, 'data', 'dr5hn');

function readSourceFile(filename: string): string {
  const full = path.join(SOURCE_DIR, filename);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Missing required source file: ${full}\n` +
        `Expected the same pre-extracted dr5hn cities.sql fragment import-global-locations.ts uses.`,
    );
  }
  return fs.readFileSync(full, 'utf8');
}

async function main() {
  console.log(`\n=== BarberCue City Timezone Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no database writes)' : 'REAL BACKFILL'}`);
  console.log(`Source dir: ${SOURCE_DIR}`);
  console.log(`Source: ${SOURCE_DATASET} ${SOURCE_VERSION}\n`);

  const cities = parseInsertStatements<Dr5hnCityRow>(readSourceFile('cities.sql'), 'cities', [
    ...CITY_COLUMNS,
  ]);
  const timezoneBySourceId = new Map<string, string>();
  for (const c of cities) {
    if (c.id && c.timezone) timezoneBySourceId.set(c.id, c.timezone);
  }
  console.log(
    `Parsed ${cities.length} source cities; ${timezoneBySourceId.size} carry a non-empty timezone.`,
  );

  const candidates = await prisma.city.findMany({
    where: {
      sourceDataset: SOURCE_DATASET,
      sourceVersion: SOURCE_VERSION,
      timezone: null,
      sourceId: { not: null },
    },
    select: { id: true, name: true, slug: true, countryCode: true, sourceId: true },
  });
  console.log(`Found ${candidates.length} existing city rows with sourceId set and timezone still NULL.`);

  const toUpdate = candidates
    .map((c) => ({ ...c, newTimezone: timezoneBySourceId.get(String(c.sourceId)) }))
    .filter((c): c is typeof c & { newTimezone: string } => Boolean(c.newTimezone));
  console.log(`${toUpdate.length}/${candidates.length} have a matching source timezone to backfill.`);

  if (DRY_RUN) {
    console.log(`\nDRY-RUN complete. No database writes were performed.`);
    console.log(`Sample (first 10):`, toUpdate.slice(0, 10).map((c) => `${c.name} (${c.countryCode}) -> ${c.newTimezone}`));
    return;
  }

  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((c) =>
        // updateMany (not update): lets the WHERE re-assert timezone: null at write time, not
        // just at the read above -- Prisma's single-row `update` only accepts a unique selector,
        // it cannot carry this extra guard condition.
        prisma.city.updateMany({
          where: { id: c.id, timezone: null },
          data: { timezone: c.newTimezone },
        }),
      ),
    );
    updated += batch.length;
    console.log(`  ...updated ${updated}/${toUpdate.length}`);
  }
  console.log(`\nBackfill complete. ${updated} city rows updated.`);
}

main()
  .catch((err) => {
    console.error('\nBACKFILL FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
