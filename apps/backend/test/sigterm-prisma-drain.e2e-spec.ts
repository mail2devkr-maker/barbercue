import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const WAIT_TIMEOUT_MS = 8_000;

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function within<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not reserve a local test port');
  }
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

async function waitForOutput(
  child: ReturnType<typeof spawn>,
  readOutput: () => string,
  marker: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readOutput().includes(marker)) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Shutdown probe exited before marker: ' + marker);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Shutdown probe did not emit marker: ' + marker);
}

async function waitForLockWait(
  prisma: PrismaClient,
  tableName: string,
): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const query =
    "SELECT count(*)::int AS count FROM pg_stat_activity " +
    "WHERE wait_event_type = 'Lock' AND query LIKE '%" +
    tableName +
    "%'";
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(query);
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Disposable PostgreSQL did not observe the blocked probe update');
}

describe('SIGTERM drains a real in-flight HTTP request and PostgreSQL transaction', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('This E2E requires the disposable PostgreSQL DATABASE_URL');
    }
    prisma = new PrismaClient();
    await prisma.$connect();
  }, 15_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    'completes the held database update and HTTP response before process exit',
    async () => {
      const runId = randomBytes(6).toString('hex');
      const tableName = 'sigterm_drain_' + runId;
      const quotedTable = 'public."' + tableName + '"';
      const updateSql =
        "UPDATE " +
        quotedTable +
        " SET value = 'drained' WHERE id = 1 /* " +
        runId +
        ' */';
      const releaseParentLock = deferred<void>();
      const parentLockAcquired = deferred<void>();
      let lockHolder: Promise<unknown> | undefined;
      let child: ReturnType<typeof spawn> | undefined;
      let output = '';
      let dropTable = false;

      await prisma.$executeRawUnsafe(
        'CREATE TABLE ' + quotedTable + ' (id integer PRIMARY KEY, value text NOT NULL)',
      );
      dropTable = true;
      await prisma.$executeRawUnsafe(
        'INSERT INTO ' + quotedTable + " (id, value) VALUES (1, 'waiting')",
      );

      try {
        lockHolder = prisma.$transaction(async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT id FROM ' + quotedTable + ' WHERE id = 1 FOR UPDATE',
          );
          parentLockAcquired.resolve();
          await releaseParentLock.promise;
        });
        await within(parentLockAcquired.promise, 'parent row lock');

        const port = await freePort();
        const childDatabaseUrl = new URL(process.env.DATABASE_URL!);
        const childScript = [
          "const { Module } = require('@nestjs/common');",
          "const { NestFactory } = require('@nestjs/core');",
          "const { MaintenanceModeService } = require('./dist/maintenance/maintenance-mode.service');",
          "const { PrismaService } = require('./dist/prisma/prisma.service');",
          'class ShutdownProbeModule {}',
          'Module({ providers: [MaintenanceModeService, PrismaService] })(ShutdownProbeModule);',
          'async function start() {',
          "  const app = await NestFactory.create(ShutdownProbeModule, { logger: false });",
          '  const prisma = app.get(PrismaService);',
          '  app.use("/drain-probe", async (_request, response) => {',
          '    try {',
          '      await prisma.$transaction(async (tx) => {',
          '        process.stdout.write("TX_STARTED\\n");',
          '        await tx.$executeRawUnsafe(' + JSON.stringify(updateSql) + ');',
          '      });',
          '      response.status(200).send("DRAINED");',
          '    } catch (_error) {',
          '      response.status(500).send("TX_FAILED");',
          '    }',
          '  });',
          '  process.on("SIGTERM", () => process.stdout.write("SIGTERM_SEEN\\n"));',
          '  app.enableShutdownHooks(["SIGTERM"]);',
          '  await app.listen(Number(process.env.PORT), "127.0.0.1");',
          '  process.stdout.write("READY\\n");',
          '}',
          'start().catch(() => { process.stderr.write("START_FAILED\\n"); process.exitCode = 1; });',
        ].join('\n');

        child = spawn(process.execPath, ['-e', childScript], {
          cwd: resolve(__dirname, '..'),
          env: {
            ...process.env,
            DATABASE_URL: childDatabaseUrl.toString(),
            FASTQUE_MAINTENANCE_MODE: 'false',
            PORT: String(port),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });

        await waitForOutput(child, () => output, 'READY');
        const responsePromise = fetch('http://127.0.0.1:' + port + '/drain-probe');
        void responsePromise.catch(() => undefined);
        await waitForOutput(child, () => output, 'TX_STARTED');
        await waitForLockWait(prisma, tableName);

        expect(child.kill('SIGTERM')).toBe(true);
        await waitForOutput(child, () => output, 'SIGTERM_SEEN');
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(child.exitCode).toBeNull();

        releaseParentLock.resolve();
        const response = await within(responsePromise, 'in-flight HTTP response', 10_000);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('DRAINED');

        await within(lockHolder, 'parent transaction completion', 5_000);
        const exitPromise = child.exitCode !== null
          ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
          : new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
              child?.once('exit', (code, signal) => resolveExit({ code, signal }));
            });
        const exit = await within(exitPromise, 'SIGTERM process shutdown', 5_000);
        expect(exit.code).toBe(0);

        const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
          'SELECT value FROM ' + quotedTable + ' WHERE id = 1',
        );
        expect(rows[0]?.value).toBe('drained');
      },
      30_000,
    );

  afterEach(async () => {
    // Test cleanup is scoped to the randomized table in the CI disposable PostgreSQL database.
  });
});