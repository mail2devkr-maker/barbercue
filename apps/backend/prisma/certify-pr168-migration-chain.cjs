const { createHash, randomUUID } = require('node:crypto');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(__dirname, 'migrations');
const recoveryMigration = '20261008180000_recoverable_shop_deletion';
const bootstrapMigration = '20260830215000_ensure_primary_platform_admin';
const prismaCli = require.resolve('prisma/build/index.js');

class CertificationError extends Error {}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: result.status,
    text: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    error: result.error,
  };
}

function assert(condition, message) {
  if (!condition) throw new CertificationError(message);
}

async function main() {
  assert(process.env.DATABASE_URL, 'DATABASE_URL is required.');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert(
    ['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) &&
      databaseUrl.pathname === '/fastque_ci',
    'Certification database must be the isolated loopback fastque_ci database.',
  );

  let bootstrapRetried = false;
  let deploy = runPrisma([
    'migrate',
    'deploy',
    '--schema=apps/backend/prisma/schema.prisma',
  ]);
  if (deploy.status !== 0) {
    assert(
      deploy.text.includes('PRIMARY_PLATFORM_ADMIN_USER_MISSING'),
      'Full migration chain failed for a reason other than the documented synthetic bootstrap prerequisite.',
    );

    const bootstrapPrisma = new PrismaClient();
    try {
      const state = await bootstrapPrisma.$queryRaw`
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        WHERE migration_name = ${bootstrapMigration}
      `;
      assert(
        state.length === 1 &&
          state[0].finished_at === null &&
          state[0].rolled_back_at === null,
        'Bootstrap migration did not fail in the expected recorded state.',
      );

      const bootstrapUser = await bootstrapPrisma.$queryRaw`
        SELECT "id" FROM "users"
        WHERE lower("email") = lower('mail2dev.kr@gmail.com')
        LIMIT 1
      `;
      assert(
        bootstrapUser.length === 0,
        'Unexpected bootstrap identity already exists in the fresh CI database.',
      );
    } finally {
      await bootstrapPrisma.$disconnect();
    }

    const rollback = runPrisma([
      'migrate',
      'resolve',
      '--rolled-back',
      bootstrapMigration,
      '--schema=apps/backend/prisma/schema.prisma',
    ]);
    assert(
      rollback.status === 0,
      'Could not mark the failed bootstrap migration rolled back for a clean retry.',
    );

    const insertPrisma = new PrismaClient();
    try {
      // The documented migration requires this exact email. This synthetic row has no password,
      // TOTP secret, verified email, OAuth identity, or session; it cannot authenticate. It exists
      // only in this fresh disposable CI database and is never sourced from production.
      await insertPrisma.$executeRaw`
        INSERT INTO "users" ("id", "email", "status", "updatedAt")
        VALUES (${`pr168-ci-bootstrap-${randomUUID()}`}, 'mail2dev.kr@gmail.com', 'ACTIVE', CURRENT_TIMESTAMP)
      `;
    } finally {
      await insertPrisma.$disconnect();
    }

    deploy = runPrisma([
      'migrate',
      'deploy',
      '--schema=apps/backend/prisma/schema.prisma',
    ]);
    assert(
      deploy.status === 0,
      'Full migration chain failed after the documented synthetic bootstrap prerequisite was satisfied.',
    );
    bootstrapRetried = true;
    console.log(
      'PASS: documented missing-primary-admin prerequisite satisfied with a no-credential synthetic CI identity; migration was marked rolled-back, then actually rerun.',
    );
  } else {
    console.log(
      'PASS: full migration deployment completed without requiring the documented bootstrap prerequisite.',
    );
  }

  const dirs = (await readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expected = new Map();
  for (const name of dirs) {
    const sql = await readFile(path.join(migrationsDir, name, 'migration.sql'));
    expected.set(name, createHash('sha256').update(sql).digest('hex'));
  }
  assert(
    expected.has(recoveryMigration),
    'Expected recovery migration directory is missing.',
  );

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name IS NOT NULL
      ORDER BY migration_name
    `;
    const rolledBack = rows.filter((row) => row.rolled_back_at !== null);
    const finished = rows.filter(
      (row) => row.finished_at !== null && row.rolled_back_at === null,
    );
    assert(
      finished.length === expected.size,
      `Expected ${expected.size} finished migrations, found ${finished.length}.`,
    );
    assert(
      rolledBack.length === (bootstrapRetried ? 1 : 0) &&
        rolledBack.every((row) => row.migration_name === bootstrapMigration),
      'Migration history contains an unexpected failed or rolled-back migration.',
    );
    for (const row of [...finished, ...rolledBack]) {
      assert(
        expected.has(row.migration_name),
        `Unexpected migration history row ${row.migration_name}.`,
      );
      assert(
        row.checksum === expected.get(row.migration_name),
        `Migration checksum mismatch for ${row.migration_name}.`,
      );
    }
    assert(
      finished.some((row) => row.migration_name === recoveryMigration),
      'Recovery migration is absent from successful migration history.',
    );
    console.log(
      `PASS: ${finished.length}/${expected.size} migrations finished; every committed SQL checksum matches, including ${recoveryMigration}; bootstrap history is ${rolledBack.length ? 'explicitly rolled back then successfully retried' : 'clean'}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const safeMessage =
    error instanceof CertificationError
      ? error.message
      : `unexpected migration runtime failure (${typeof error?.code === 'string' ? error.code : 'details withheld'})`;
  console.error(`PR #168 migration-chain certification failed: ${safeMessage}`);
  process.exitCode = 1;
});
