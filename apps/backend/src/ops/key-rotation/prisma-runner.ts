import type { PrismaClient } from '@prisma/client';
import type { SqlRunner } from './rotate';

type RawClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

function runnerFor(
  client: RawClient,
  begin?: SqlRunner['transaction'],
): SqlRunner {
  const self: SqlRunner = {
    query: async <T>(sql: string, params: unknown[] = []) =>
      await client.$queryRawUnsafe<T[]>(sql, ...params),
    execute: (sql, params = []) => client.$executeRawUnsafe(sql, ...params),
    // Inside an open transaction there is nothing to begin: run the work on the same connection.
    transaction: begin ?? (async (work) => work(self)),
  };
  return self;
}

/** SqlRunner over a PrismaClient: one interactive transaction for apply, plain reads for plan and verify. */
export function prismaRunner(client: PrismaClient): SqlRunner {
  return runnerFor(client, (work) =>
    client.$transaction(async (tx) => work(runnerFor(tx)), {
      maxWait: 15_000,
      timeout: 120_000,
    }),
  );
}
