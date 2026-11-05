import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
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
 * Assistant role consistency on a DISPOSABLE database: the Assistant grants exactly what the
 * dashboard routes grant. A Co-Founder in a TOTP admin session can use shop reads on any shop (as the
 * Owner Dashboard allows since #382); platform roles never count from a non-admin session, so a
 * Super Admin or Co-Founder who also owns another shop cannot reach a foreign shop from a staff
 * session; owners stay confined to their own shop.
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

maybe('Assistant role consistency (e2e, disposable database)', () => {
  const run = randomUUID().slice(0, 8);
  const saved = Object.fromEntries(GATE.map((k) => [k, process.env[k]]));
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const turn = (
    who: string,
    salonId: string,
    text = 'auto assign on hai kya',
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: 'shop', salonId });

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
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const city = await prisma.city.create({
      data: {
        name: `AsstRole ${run}`,
        slug: `asstrole-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    const user = async (label: string, roles: Array<[Role, string | null]>) => {
      const u = await prisma.user.create({
        data: {
          email: `asstrole-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      for (const [role, salonId] of roles)
        await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
      ids[label] = u.id;
      return u.id;
    };
    for (const key of ['A', 'B']) {
      const owner = await user(`owner${key}`, []);
      const s = await prisma.salon.create({
        data: {
          ownerUserId: owner,
          name: `AsstRole ${key} ${run}`,
          slug: `asstrole-${key.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          status: SalonStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({
        data: { userId: owner, role: Role.SALON_OWNER, salonId: s.id },
      });
      tok[`owner${key}`] = tokens.signAccessToken(
        owner,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      ids[`shop${key}`] = s.id;
    }
    const cf = await user('cofounder', [[Role.CO_FOUNDER, null]]);
    tok.cofounderAdmin = tokens.signAccessToken(
      cf,
      [Role.CO_FOUNDER],
      SessionAudience.ADMIN,
    );
    tok.cofounderStaff = tokens.signAccessToken(
      cf,
      [Role.CO_FOUNDER],
      SessionAudience.STAFF,
    );
    // A Super Admin who ALSO owns shop A, signed in through the ordinary staff login.
    const dual = await user('dual', [
      [Role.PLATFORM_ADMIN, null],
      [Role.SALON_OWNER, ids.shopA],
    ]);
    tok.dualStaff = tokens.signAccessToken(
      dual,
      [Role.PLATFORM_ADMIN, Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    tok.dualAdmin = tokens.signAccessToken(
      dual,
      [Role.PLATFORM_ADMIN, Role.SALON_OWNER],
      SessionAudience.ADMIN,
    );
  });

  afterAll(async () => {
    await app?.close();
    for (const k of GATE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('a Co-Founder in a TOTP admin session can use shop reads on any shop, like the Owner Dashboard', async () => {
    for (const shop of [ids.shopA, ids.shopB]) {
      const r = (await turn('cofounderAdmin', shop).expect(200)).body;
      expect(r.status).toBe('DONE');
    }
  });

  it('the same Co-Founder from a non-admin session is denied', async () => {
    const r = (await turn('cofounderStaff', ids.shopB).expect(200)).body;
    expect(r.status).toBe('DENIED');
  });

  it('a Super Admin who also owns shop A cannot reach shop B from a staff session, but can from an admin session', async () => {
    expect((await turn('dualStaff', ids.shopA).expect(200)).body.status).toBe(
      'DONE',
    );
    expect((await turn('dualStaff', ids.shopB).expect(200)).body.status).toBe(
      'DENIED',
    );
    expect((await turn('dualAdmin', ids.shopB).expect(200)).body.status).toBe(
      'DONE',
    );
  });

  it('owners stay confined to their own shop', async () => {
    expect((await turn('ownerA', ids.shopA).expect(200)).body.status).toBe(
      'DONE',
    );
    expect((await turn('ownerA', ids.shopB).expect(200)).body.status).toBe(
      'DENIED',
    );
  });

  it('capabilities reflect the session: platform-only actions are DENIED outside an admin session', async () => {
    const caps = async (who: string) =>
      (
        (
          await request(app.getHttpServer())
            .get('/api/v1/assistant/capabilities')
            .set('Authorization', `Bearer ${tok[who]}`)
            .expect(200)
        ).body as { actions: Array<{ id: string; state: string }> }
      ).actions;
    const admin = await caps('cofounderAdmin');
    const staff = await caps('cofounderStaff');
    const platformIds = admin
      .filter((a) => a.state === 'SUPPORTED')
      .map((a) => a.id);
    expect(platformIds.length).toBeGreaterThan(0);
    expect(
      staff.filter(
        (a) => platformIds.includes(a.id) && a.state === 'SUPPORTED',
      ),
    ).toEqual([]);
  });
});
