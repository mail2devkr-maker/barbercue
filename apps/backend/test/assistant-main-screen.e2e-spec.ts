import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Voice -> understand -> open the page on the MAIN screen -> select the record -> preview -> on-screen
 * confirmation -> execute -> page refresh, through the real endpoints on a DISPOSABLE database.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const parsed = (() => {
  try {
    return new URL(DATABASE_URL);
  } catch {
    return null;
  }
})();
const DISPOSABLE =
  !!parsed &&
  ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
  (parsed.pathname.endsWith('_e2e') || parsed.pathname === '/owner_ops_chain');
const maybe = DISPOSABLE ? describe : describe.skip;
const GATE = [
  'ASSISTANT_MODE',
  'ASSISTANT_WRITES',
  'ASSISTANT_COHORT_USER_IDS',
  'ASSISTANT_WRITE_SALON_IDS',
  'ASSISTANT_WRITE_ACTIONS',
] as const;

maybe('Assistant main-screen workflow (e2e, disposable database)', () => {
  const run = randomUUID().slice(0, 8);
  const saved = Object.fromEntries(GATE.map((k) => [k, process.env[k]]));
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token = '';
  let salonId = '';
  let ownerId = '';
  const chairs: Record<string, string> = {};
  let serviceId = '';

  const turn = (text: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({ text, surface: 'shop', salonId })
      .expect(200)
      .then((r) => r.body);
  const confirm = (t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: t, decision: 'confirm', acknowledged: true })
      .expect(200)
      .then((r) => r.body);
  const chairStatus = async (label: string) =>
    (await prisma.chair.findUniqueOrThrow({ where: { id: chairs[label] } }))
      .status;

  beforeAll(async () => {
    for (const k of GATE) delete process.env[k];
    // Disposable database only: every action and shop is allowlisted to exercise the write path.
    Object.assign(process.env, {
      ASSISTANT_MODE: 'all',
      ASSISTANT_WRITES: 'all',
      ASSISTANT_WRITE_SALON_IDS: '*',
      ASSISTANT_WRITE_ACTIONS: '*',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const city = await prisma.city.create({
      data: {
        name: `MS ${run}`,
        slug: `ms-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    ownerId = (
      await prisma.user.create({
        data: {
          email: `ms-${run}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      })
    ).id;
    const s = await prisma.salon.create({
      data: {
        ownerUserId: ownerId,
        name: `MS ${run}`,
        slug: `ms-${run}`,
        cityId: city.id,
        addressLine: 'Synthetic',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: SalonStatus.ACTIVE,
      },
    });
    salonId = s.id;
    await prisma.userRole.create({
      data: { userId: ownerId, role: Role.SALON_OWNER, salonId },
    });
    token = app
      .get(TokenService)
      .signAccessToken(ownerId, [Role.SALON_OWNER], SessionAudience.STAFF);
    for (const label of ['Chair 1', 'Chair 2', 'Chair 3'])
      chairs[label] = (
        await prisma.chair.create({ data: { salonId, label } })
      ).id;
    serviceId = (
      await prisma.service.create({
        data: { salonId, name: 'Haircut', price: 200, durationMinutes: 30 },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
    for (const k of GATE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('"Chair number 2 band kar do": Chairs opens, Chair 2 is previewed, nothing changes until Confirm', async () => {
    const p = await turn('Chair number 2 band kar do');
    expect(p.status).toBe('NEEDS_CONFIRMATION');
    expect(p.mainScreen).toBe(true);
    expect(p.navigateTo).toBe(`/dashboard/salons/${salonId}/chairs`);
    expect(p.preview.rows[0]).toMatchObject({ label: 'Chair 2' });
    expect(await chairStatus('Chair 2')).toBe('ACTIVE');
    // "haan" never confirms.
    const yes = await turn('haan');
    expect(yes.status).not.toBe('DONE');
    expect(await chairStatus('Chair 2')).toBe('ACTIVE');
    const done = await confirm(p.confirmation.token);
    expect(done.status).toBe('DONE');
    expect(done.mainScreen).toBe(true);
    expect(done.navigateTo).toContain(`/dashboard/salons/${salonId}/chairs`);
    expect(done.refresh).toContain('chairs');
    expect(await chairStatus('Chair 2')).toBe('INACTIVE');
    expect(await chairStatus('Chair 1')).toBe('ACTIVE');
    // Replaying the same confirmation changes nothing again.
    expect((await confirm(p.confirmation.token)).status).not.toBe('DONE');
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: ownerId, action: 'ASSISTANT_ACTION' },
      }),
    ).toBeGreaterThan(0);
  });

  it('"Doosri chair chalu karo" and "Chair do ..." select Chair 2 by number', async () => {
    const p = await turn('Doosri chair chalu karo');
    expect(p.preview.rows[0]).toMatchObject({
      label: 'Chair 2',
      before: expect.any(String),
      after: expect.any(String),
    });
    await confirm(p.confirmation.token);
    expect(await chairStatus('Chair 2')).toBe('ACTIVE');
    const q = await turn('Chair do band karo');
    expect(q.preview.rows[0].label).toBe('Chair 2');
  });

  it('"Haircut ka price 250 kar do": Services opens, ₹200 -> ₹250 previewed, saved only on Confirm', async () => {
    const p = await turn('Haircut ka price 250 kar do');
    expect(p.status).toBe('NEEDS_CONFIRMATION');
    expect(p.navigateTo).toBe(`/dashboard/salons/${salonId}/services`);
    expect(JSON.stringify(p.preview.rows)).toMatch(/200/);
    expect(JSON.stringify(p.preview.rows)).toMatch(/250/);
    expect(
      Number(
        (await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }))
          .price,
      ),
    ).toBe(200);
    const done = await confirm(p.confirmation.token);
    expect(done.status).toBe('DONE');
    expect(done.navigateTo).toContain('/services');
    expect(
      Number(
        (await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }))
          .price,
      ),
    ).toBe(250);
  });

  it('an unclear chair number asks instead of guessing', async () => {
    const p = await turn('chair 12 band karo');
    expect(p.status).toBe('NEEDS_INPUT');
    expect(p.navigateTo).toBe(`/dashboard/salons/${salonId}/chairs`);
  });

  it('reads open their page; a period opens Bookings filtered to that period', async () => {
    expect((await turn('Aaj ki revenue dikhao')).navigateTo).toBe(
      `/dashboard/salons/${salonId}/revenue`,
    );
    const r = await turn('Is mahine ki bookings dikhao');
    expect(r.mainScreen).toBe(true);
    expect(r.navigateTo).toMatch(
      new RegExp(
        `^/dashboard/salons/${salonId}/bookings\\?from=.+&to=.+&period=.+&filter=all$`,
      ),
    );
    expect((await turn('Ramesh ka schedule dikhao')).status).not.toBe('DONE'); // no such staff: asks whose
  });
});
