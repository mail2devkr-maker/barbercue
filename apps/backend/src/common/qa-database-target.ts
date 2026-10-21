/**
 * Fail-closed target guard for local QA fixture scripts. This is deliberately not an application
 * service and must never be used to authorize runtime requests.
 */
export interface QaFixtureEnvironment {
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
  NODE_ENV?: string;
  QA_PLATFORM_ADMIN_FIXTURE?: string;
  QA_DISPOSABLE_DATABASE_NAME?: string;
  RAILWAY_ENVIRONMENT?: string;
  RAILWAY_PROJECT_ID?: string;
  NEON_PROJECT_ID?: string;
}

interface ParsedLocalQaTarget {
  hostname: string;
  port: string;
  databaseName: string;
}

function parseLocalQaTarget(value: string | undefined): ParsedLocalQaTarget {
  if (!value) throw new Error('A database URL is required for the QA fixture.');

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('The QA fixture database URL is invalid.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
    throw new Error('The QA fixture only permits a loopback database host.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  // The migration-chain CI database has a fixed name and is created inside a fresh
  // disposable PostgreSQL service container for each job.
  const explicitlyDisposableDatabase =
    /(^|[-_])(qa|test|e2e|scratch|disposable)([-_]|$)/i.test(databaseName) ||
    databaseName === 'owner_ops_chain';
  if (!explicitlyDisposableDatabase) {
    throw new Error(
      'The database name must identify a disposable QA/test database.',
    );
  }

  return { hostname, port: parsed.port || '5432', databaseName };
}

/** Validate both Prisma URLs before a test fixture is allowed to create any rows. */
export function assertLocalDisposableQaDatabase(
  env: QaFixtureEnvironment,
): ParsedLocalQaTarget {
  if (env.QA_PLATFORM_ADMIN_FIXTURE !== '1') {
    throw new Error(
      'Set QA_PLATFORM_ADMIN_FIXTURE=1 to enable the test-only fixture.',
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('The QA fixture is disabled when NODE_ENV=production.');
  }
  if (
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_PROJECT_ID ||
    env.NEON_PROJECT_ID
  ) {
    throw new Error(
      'The QA fixture is disabled in configured cloud environments.',
    );
  }

  const target = parseLocalQaTarget(env.DATABASE_URL);
  if (env.QA_DISPOSABLE_DATABASE_NAME !== target.databaseName) {
    throw new Error(
      'Set QA_DISPOSABLE_DATABASE_NAME to the exact disposable database name before enabling the fixture.',
    );
  }
  if (env.DIRECT_DATABASE_URL) {
    const direct = parseLocalQaTarget(env.DIRECT_DATABASE_URL);
    if (
      direct.hostname !== target.hostname ||
      direct.port !== target.port ||
      direct.databaseName !== target.databaseName
    ) {
      throw new Error(
        'DATABASE_URL and DIRECT_DATABASE_URL must identify the same local QA database.',
      );
    }
  }
  return target;
}
