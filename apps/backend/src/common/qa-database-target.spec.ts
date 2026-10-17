import { assertLocalDisposableQaDatabase } from './qa-database-target';

const base = {
  DATABASE_URL:
    'postgresql://qa:ignored@127.0.0.1:5432/owner_nav_qa?schema=public',
  NODE_ENV: 'test',
  QA_PLATFORM_ADMIN_FIXTURE: '1',
  QA_DISPOSABLE_DATABASE_NAME: 'owner_nav_qa',
};

describe('assertLocalDisposableQaDatabase', () => {
  it('accepts explicitly enabled loopback QA databases', () => {
    expect(assertLocalDisposableQaDatabase(base)).toEqual({
      hostname: '127.0.0.1',
      port: '5432',
      databaseName: 'owner_nav_qa',
    });
  });

  it('requires an explicit fixture opt-in', () => {
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        QA_PLATFORM_ADMIN_FIXTURE: undefined,
      }),
    ).toThrow('Set QA_PLATFORM_ADMIN_FIXTURE=1');
  });

  it('requires a second explicit acknowledgement of the exact database name', () => {
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        QA_DISPOSABLE_DATABASE_NAME: 'production',
      }),
    ).toThrow('exact disposable database name');
  });

  it('rejects production mode and cloud deployment markers', () => {
    expect(() =>
      assertLocalDisposableQaDatabase({ ...base, NODE_ENV: 'production' }),
    ).toThrow('disabled when NODE_ENV=production');
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        RAILWAY_ENVIRONMENT: 'production',
      }),
    ).toThrow('disabled in configured cloud environments');
    expect(() =>
      assertLocalDisposableQaDatabase({ ...base, NEON_PROJECT_ID: 'redacted' }),
    ).toThrow('disabled in configured cloud environments');
  });

  it('rejects non-loopback hosts and database names without a test marker', () => {
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        DATABASE_URL:
          'postgresql://qa:ignored@db.example.test:5432/owner_nav_qa',
      }),
    ).toThrow('loopback database host');
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        DATABASE_URL: 'postgresql://qa:ignored@127.0.0.1:5432/production',
      }),
    ).toThrow('disposable QA/test database');
  });

  it('requires direct and pooled Prisma URLs to identify the same database', () => {
    expect(() =>
      assertLocalDisposableQaDatabase({
        ...base,
        DIRECT_DATABASE_URL:
          'postgresql://qa:ignored@127.0.0.1:5433/owner_nav_qa',
      }),
    ).toThrow('same local QA database');
  });
});
