#!/usr/bin/env node
/**
 * Migration checksum verification (run AFTER `prisma migrate deploy` on a disposable database).
 *
 *  1. Every migration Prisma recorded as applied has the checksum of the file in the repository -
 *     i.e. no committed migration was edited after it was applied.
 *  2. The owner-operations migrations match the checksums pinned in
 *     prisma/owner-ops-migration-checksums.json (computed over the LF-normalised committed bytes), so
 *     editing one of them later is a visible, reviewed change rather than a silent one.
 *
 * Reads DATABASE_URL (a disposable database only).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const dir = path.join(__dirname, '..', 'prisma', 'migrations');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

(async () => {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name');
    const onDisk = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'migration.sql'))).sort();
    let bad = 0;
    for (const name of onDisk) {
      const row = rows.find((r) => r.migration_name === name);
      if (!row || !row.finished_at || row.rolled_back_at) {
        console.log(`MISSING/UNFINISHED  ${name}`);
        bad += 1;
        continue;
      }
      const file = fs.readFileSync(path.join(dir, name, 'migration.sql'));
      // The database recorded whatever bytes it applied; accept the raw or the LF-normalised form so a
      // Windows checkout (CRLF) is compared fairly with a Linux one.
      if (row.checksum !== sha(file) && row.checksum !== sha(lf(file))) {
        console.log(`CHECKSUM MISMATCH   ${name}`);
        bad += 1;
      }
    }
    const extra = rows.filter((r) => !onDisk.includes(r.migration_name));
    for (const r of extra) {
      console.log(`APPLIED BUT NOT IN REPO  ${r.migration_name}`);
      bad += 1;
    }
    console.log(`${onDisk.length} migrations on disk, ${rows.length} recorded as applied, ${bad} problem(s)`);

    const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'prisma', 'owner-ops-migration-checksums.json'), 'utf8'));
    for (const [name, expected] of Object.entries(pinned.migrations)) {
      const actual = sha(lf(fs.readFileSync(path.join(dir, name, 'migration.sql'))));
      const ok = actual === expected;
      console.log(`${ok ? 'PINNED OK    ' : 'PINNED CHANGED'}  ${name}${ok ? '' : `  (expected ${expected}, got ${actual})`}`);
      if (!ok) bad += 1;
    }
    process.exit(bad === 0 ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
