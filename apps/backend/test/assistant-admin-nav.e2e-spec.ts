import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Admin voice navigation through the real turn endpoint, per role (disposable database). */
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

maybe('Assistant admin navigation (e2e, disposable database)', () => {
  const run = randomUUID().slice(0, 8);
  const saved = Object.fromEntries(GATE.map((k) => [k, process.env[k]]));
  let app: INestApplication<App>;
  const tok: Record<string, string> = {};
  const turn = (who: string, text: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: 'admin' });

  beforeAll(async () => {
    for (const k of GATE) delete process.env[k];
    Object.assign(process.env, {
      ASSISTANT_MODE: 'all',
      ASSISTANT_WRITES: 'off',
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
    const prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    for (const [label, role, audience] of [
      ['cofounder', Role.CO_FOUNDER, SessionAudience.ADMIN],
      ['hr', Role.HR_ADMIN, SessionAudience.ADMIN],
      ['cofounderStaff', Role.CO_FOUNDER, SessionAudience.STAFF],
    ] as const) {
      const u = await prisma.user.create({
        data: {
          email: `anav-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({
        data: { userId: u.id, role, salonId: null },
      });
      tok[label] = tokens.signAccessToken(u.id, [role], audience);
    }
  });

  afterAll(async () => {
    await app?.close();
    for (const k of GATE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('a Co-Founder opens admin pages by voice on the main screen', async () => {
    const r = (
      await turn('cofounder', 'live queue monitoring kholo').expect(200)
    ).body;
    expect(r).toMatchObject({
      status: 'DONE',
      navigateTo: '/dashboard/admin/live-queue',
    });
    expect(
      (await turn('cofounder', 'all bookings kholo').expect(200)).body
        .navigateTo,
    ).toBe('/dashboard/admin/bookings');
  });

  it('a page the role cannot open is refused with a plain answer, never navigated to', async () => {
    const r = (await turn('hr', 'all bookings kholo').expect(200)).body;
    expect(r.status).toBe('DENIED');
    expect(r.navigateTo).toBeUndefined();
    expect(
      (await turn('hr', 'employees kholo').expect(200)).body.navigateTo,
    ).toBe('/dashboard/admin/employees');
  });

  it('platform navigation needs an admin (TOTP) session', async () => {
    const r = (
      await turn('cofounderStaff', 'live queue monitoring kholo').expect(200)
    ).body;
    expect(r.status).toBe('DENIED');
    expect(r.navigateTo).toBeUndefined();
  });
});
