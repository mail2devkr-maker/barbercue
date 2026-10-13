/**
 * Disposable-PostgreSQL release gate for the catalog-import transaction lock.
 * Creates NO salon or service rows. Fails if the lock is not actually held
 * across a transaction, or Prisma tries to decode PostgreSQL's void return.
 */
import { strict as assert } from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { CATALOG_IMPORT_ADVISORY_LOCK_SQL } from '../src/salon-setup/service-catalog-import.service';

async function certify() {
  const client = new PrismaClient();
  const key = 'catalog-lock-disposable-ci';
  try {
    await client.$connect();
    await client.$transaction(async (tx) => {
      // Must execute successfully with the actual Prisma engine and PostgreSQL.
      await tx.$executeRawUnsafe(CATALOG_IMPORT_ADVISORY_LOCK_SQL, key);
      const concurrent = await client.$transaction((other) =>
        other.$queryRawUnsafe<Array<{ locked: boolean }>>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', key,
        ),
      );
      assert.equal(concurrent[0]?.locked, false,
        'Concurrent transaction unexpectedly acquired the salon lock');
    }, { timeout: 15000 });

    const afterCommit = await client.$queryRawUnsafe<Array<{ locked: boolean }>>(
      'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', key,
    );
    assert.equal(afterCommit[0]?.locked, true, 'Transaction lock was not released');
    process.stdout.write('PASS: Prisma acquired the PostgreSQL advisory lock without decoding void; concurrent lock was denied; commit released lock.\\n');
  } finally {
    await client.$disconnect();
  }
}

certify().catch((error: unknown) => {
  process.stderr.write('Catalog advisory-lock integration smoke FAILED: ' +
    (error instanceof Error ? error.message : String(error)) + '\\n');
  process.exitCode = 1;
});
