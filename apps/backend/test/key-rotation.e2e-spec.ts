import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { TotpService } from '../src/auth/services/totp.service';
import { deriveKey, open, seal, tryOpen } from '../src/ops/key-rotation/cipher';
import { prismaRunner } from '../src/ops/key-rotation/prisma-runner';
import {
  UnreadableValuesError,
  applyRotation,
  planRotation,
  verifyRotation,
  type RotationTarget,
} from '../src/ops/key-rotation/rotate';
import { TOTP_SECRETS_TARGET } from '../src/ops/key-rotation/targets';

/**
 * TOTP_ENCRYPTION_KEY rotation, proven end to end on a disposable database with SYNTHETIC administrators:
 * a real Nest application is booted under each key configuration of the cut-over, and the TOTP-gated
 * "reserved employee ID" operation (which decrypts the caller's authenticator secret) is exercised in every phase.
 * Administrator access must never break at any step, and the old key must be retired cleanly.
 *
 * SAFETY: it refuses to run on anything but a local database and only touches rows it created (email prefix).
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

const OLD = `old-${randomUUID()}${randomUUID()}`.replace(/-/g, '');
const NEW = `new-${randomUUID()}${randomUUID()}`.replace(/-/g, '');
const THIRD = `third-${randomUUID()}${randomUUID()}`.replace(/-/g, '');
const PASSWORD = 'Synthetic-Pass-1';

maybe('TOTP encryption key rotation (e2e, disposable local database)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (label: string) => `rot-${run}-${label}@example.test`;
  const target: RotationTarget = {
    ...TOTP_SECRETS_TARGET,
    where: `"email" LIKE 'rot-${run}-%'`,
  };

  const secrets: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const savedEnv = {
    key: process.env.TOTP_ENCRYPTION_KEY,
    secondary: process.env.TOTP_ENCRYPTION_KEY_SECONDARY,
  };
  let live: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let free: number[] = [];

  async function boot(key: string, secondary?: string) {
    await live?.close();
    process.env.TOTP_ENCRYPTION_KEY = key;
    if (secondary) process.env.TOTP_ENCRYPTION_KEY_SECONDARY = secondary;
    else delete process.env.TOTP_ENCRYPTION_KEY_SECONDARY;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = module.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    live = app;
    prisma = app.get(PrismaService);
    return app;
  }

  async function makeAdmin(label: string, role: Role, plaintext: string | null, sealedWith: string | null) {
    const user = await prisma.user.create({
      data: {
        email: email(label),
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        twoFactorEnabled: plaintext !== null,
        totpSecret: plaintext && sealedWith ? seal(deriveKey(sealedWith), plaintext) : null,
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, role, salonId: null } });
    ids[label] = user.id;
    if (plaintext) secrets[label] = plaintext;
    return user;
  }

  /** The TOTP-gated operation: decrypts the caller's authenticator secret, then reserves a permanent employee ID. */
  async function reserveAs(label: string, expectStatus = 201) {
    const app = live as INestApplication<App>;
    const token = app
      .get(TokenService)
      .signAccessToken(ids[label], [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    const code = await app.get(TotpService).generateToken(secrets[label]);
    const number = free.shift() as number;
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/employees/special')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        fullName: `Rotation Probe ${run} ${number}`,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        employeeNumber: number,
        totpCode: code,
      });
    expect(res.status).toBe(expectStatus);
    return res;
  }

  const stored = async (label: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: ids[label] }, select: { totpSecret: true } })).totpSecret;
  const runner = () => prismaRunner(prisma);

  beforeAll(async () => {
    await boot(OLD);
    const taken = new Set(
      (await prisma.employeeProfile.findMany({ select: { employeeCode: true } })).map((p) =>
        Number(p.employeeCode.replace('FQ-FE-', '')),
      ),
    );
    free = Array.from({ length: 100 }, (_, i) => i + 1).filter((n) => !taken.has(n));
    expect(free.length).toBeGreaterThanOrEqual(12);

    const totp = (live as INestApplication<App>).get(TotpService);
    await makeAdmin('adminA', Role.PLATFORM_ADMIN, totp.generateSecret(), OLD);
    await makeAdmin('adminB', Role.CO_FOUNDER, totp.generateSecret(), OLD);
    await makeAdmin('adminC', Role.CO_FOUNDER, null, null); // an administrator who has not enrolled 2FA
  }, 180_000);

  afterAll(async () => {
    await live?.close();
    if (savedEnv.key === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = savedEnv.key;
    if (savedEnv.secondary === undefined) delete process.env.TOTP_ENCRYPTION_KEY_SECONDARY;
    else process.env.TOTP_ENCRYPTION_KEY_SECONDARY = savedEnv.secondary;
  });

  it('baseline: the TOTP-gated operation works under the current key', async () => {
    await reserveAs('adminA');
  });

  it('step A: rolling out the incoming key as a decrypt-only secondary changes nothing for anyone', async () => {
    await boot(OLD, NEW);
    await reserveAs('adminA');
  });

  it('plan is read-only and refuses to proceed when a value is readable by neither key', async () => {
    const before = [await stored('adminA'), await stored('adminB'), await stored('adminC')];
    const [plan] = await planRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(plan).toMatchObject({ rows: 3, empty: 1, pending: 2, rotated: 0, changed: 0 });
    expect([await stored('adminA'), await stored('adminB'), await stored('adminC')]).toEqual(before);

    // A value sealed with some third key (e.g. a mistyped OLD key) must stop the run with nothing written.
    await makeAdmin('adminX', Role.CO_FOUNDER, 'JBSWY3DPEHPK3PXP', THIRD);
    const bad = await planRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(bad[0].unreadable).toEqual([ids.adminX]);
    await expect(applyRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW })).rejects.toBeInstanceOf(
      UnreadableValuesError,
    );
    expect([await stored('adminA'), await stored('adminB'), await stored('adminC')]).toEqual(before);
    await prisma.userRole.deleteMany({ where: { userId: ids.adminX } });
    await prisma.user.delete({ where: { id: ids.adminX } });
  });

  it('step B: re-encryption preserves every authenticator secret and leaves no value readable by the old key', async () => {
    const before = { a: await stored('adminA'), b: await stored('adminB'), c: await stored('adminC') };
    const [report] = await applyRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(report).toMatchObject({ rows: 3, changed: 2, pending: 2, empty: 1 });

    for (const label of ['adminA', 'adminB'] as const) {
      const now = (await stored(label)) as string;
      expect(now).not.toBe(before[label === 'adminA' ? 'a' : 'b']);
      expect(open(deriveKey(NEW), now)).toBe(secrets[label]); // the very same authenticator secret
      expect(tryOpen(deriveKey(OLD), now)).toBeNull();
    }
    expect(await stored('adminC')).toBeNull(); // untouched
  });

  it('no lockout window: instances still on the OLD primary key keep working against rotated rows', async () => {
    // Same configuration as step A (OLD primary, NEW secondary), now after the rows were re-encrypted.
    await reserveAs('adminA');
  });

  it('a value written under the old key during the window is picked up by the next run, and nothing else moves', async () => {
    await makeAdmin('adminD', Role.PLATFORM_ADMIN, (live as INestApplication<App>).get(TotpService).generateSecret(), OLD);
    const settledA = await stored('adminA');
    const [plan] = await planRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(plan).toMatchObject({ pending: 1, rotated: 2 });

    await boot(NEW, OLD); // step C: incoming key becomes primary, outgoing key stays readable
    await reserveAs('adminD'); // sealed with OLD: read through the secondary
    await reserveAs('adminA');

    const [again] = await applyRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(again.changed).toBe(1);
    expect(await stored('adminA')).toBe(settledA); // already-rotated rows are byte-identical
    const [idle] = await applyRotation(runner(), [target], { oldSecret: OLD, newSecret: NEW });
    expect(idle.changed).toBe(0);
  });

  it('step E: with the old key retired everything verifies and still works', async () => {
    await boot(NEW);
    await reserveAs('adminA');
    await reserveAs('adminD');
    const [report] = await verifyRotation(runner(), [target], { newSecret: NEW });
    expect(report).toMatchObject({ rows: 4, rotated: 3, empty: 1, pending: 0 });
    expect(report.unreadable).toEqual([]);
  });

  it('a stale instance that still has only the old key is refused cleanly (no crash, no partial write)', async () => {
    const employeesBefore = await prisma.employeeProfile.count();
    await boot(OLD);
    const res = await reserveAs('adminA', 403);
    expect(res.body.error.code).toBe('TOTP_SETUP_REQUIRED');
    expect(await prisma.employeeProfile.count()).toBe(employeesBefore);
  });

  it('rollback: swapping the keys restores access under the old key with the same authenticator secrets', async () => {
    const [report] = await applyRotation(runner(), [target], { oldSecret: NEW, newSecret: OLD });
    expect(report.changed).toBe(3); // adminA, adminB, adminD
    await boot(OLD);
    await reserveAs('adminA');
    await reserveAs('adminD');
    await verifyRotation(runner(), [target], { newSecret: OLD });
    expect(open(deriveKey(OLD), (await stored('adminA')) as string)).toBe(secrets.adminA);
  });
});
