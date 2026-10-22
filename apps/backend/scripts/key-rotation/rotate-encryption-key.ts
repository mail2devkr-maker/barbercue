/**
 * Re-encrypts every value sealed with TOTP_ENCRYPTION_KEY from an old key to a new one.
 * Procedure, order of operations and rollback: docs/release/ENCRYPTION_KEY_ROTATION.md
 *
 *   plan    read-only report (default)          needs OLD_ and NEW_TOTP_ENCRYPTION_KEY
 *   apply   all-or-nothing re-encryption         needs both keys, --backup-verified and --confirm-host=<db host>
 *   verify  every value opens with the NEW key   needs NEW_TOTP_ENCRYPTION_KEY only
 *
 * Keys come ONLY from the environment (never arguments, never logged). The database is DATABASE_URL (a direct,
 * non-pooled URL is preferred: set DIRECT_DATABASE_URL and it is used instead). Output is counts and row ids only.
 *
 *   npx ts-node --transpile-only scripts/key-rotation/rotate-encryption-key.ts plan
 */
import { PrismaClient } from '@prisma/client';
import { prismaRunner } from '../../src/ops/key-rotation/prisma-runner';
import {
  UnreadableValuesError,
  VerificationError,
  applyRotation,
  planRotation,
  verifyRotation,
  type TargetReport,
} from '../../src/ops/key-rotation/rotate';
import { ROTATION_TARGETS } from '../../src/ops/key-rotation/targets';

const MIN_KEY_LENGTH = 32;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(3).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return fail(2, 'DATABASE_URL is not a valid URL.');
  }
}

function print(reports: TargetReport[]): void {
  for (const r of reports) {
    console.log(
      JSON.stringify({
        target: r.name,
        present: r.present,
        rows: r.rows,
        empty: r.empty,
        pending: r.pending,
        rotated: r.rotated,
        unreadable: r.unreadable.length,
        unreadableIds: r.unreadable,
        changed: r.changed,
      }),
    );
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'plan';
  if (!['plan', 'apply', 'verify'].includes(mode)) fail(2, 'Usage: rotate-encryption-key <plan|apply|verify>');

  const oldSecret = process.env.OLD_TOTP_ENCRYPTION_KEY ?? '';
  const newSecret = process.env.NEW_TOTP_ENCRYPTION_KEY ?? '';
  if (!newSecret) fail(2, 'NEW_TOTP_ENCRYPTION_KEY is required.');
  if (newSecret.length < MIN_KEY_LENGTH) fail(2, `NEW_TOTP_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters (use 64 hex characters).`);
  if (mode !== 'verify') {
    if (!oldSecret) fail(2, 'OLD_TOTP_ENCRYPTION_KEY is required.');
    if (oldSecret === newSecret) fail(2, 'The old and the new key are identical.');
  }

  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) fail(2, 'DATABASE_URL (or DIRECT_DATABASE_URL) is required.');
  const host = hostOf(url);
  console.log(`mode=${mode} database-host=${host}`);

  if (mode === 'apply') {
    if (arg('backup-verified') !== 'true') fail(2, 'apply requires --backup-verified (a restorable backup taken just before this run).');
    if (arg('confirm-host') !== host) fail(2, `apply requires --confirm-host=${host} (type the target host to confirm it).`);
    if (!LOOPBACK.has(host) && process.env.ROTATION_ALLOW_REMOTE !== 'yes') {
      fail(2, 'The target is not a loopback host: set ROTATION_ALLOW_REMOTE=yes only for an owner-approved production run.');
    }
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const db = prismaRunner(prisma);
  try {
    if (mode === 'plan') {
      const reports = await planRotation(db, ROTATION_TARGETS, { oldSecret, newSecret });
      print(reports);
      if (reports.some((r) => r.unreadable.length > 0)) fail(3, 'Some values are readable with neither key. Do not apply.');
      console.log('plan complete: nothing was written.');
    } else if (mode === 'apply') {
      const reports = await applyRotation(db, ROTATION_TARGETS, { oldSecret, newSecret });
      print(reports);
      console.log('apply complete: committed. Now deploy NEW as TOTP_ENCRYPTION_KEY, run verify, then retire the old key.');
    } else {
      const reports = await verifyRotation(db, ROTATION_TARGETS, { newSecret });
      print(reports);
      console.log('verify complete: every value opens with the new key.');
    }
  } catch (error) {
    if (error instanceof UnreadableValuesError) {
      print(error.reports);
      fail(3, `${error.message} Nothing was written.`);
    }
    if (error instanceof VerificationError) fail(4, `${error.message}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Never print the error object: driver errors can embed connection details.
  console.error(`rotation failed: ${error instanceof Error ? error.name : 'unknown error'}`);
  process.exit(1);
});
