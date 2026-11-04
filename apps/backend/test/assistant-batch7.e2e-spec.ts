import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SalonStatus, SessionAudience, UserStatus, type AssistantTurnDto } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Action Assistant batch 7 (issue #362) on a DISPOSABLE local database: platform reads with the
 * admin routes' own audiences. The verification queue is admin/co-founder only; the CRM overview
 * adds HR and sales. Both need an ADMIN-audience session. Submitter contact details never appear,
 * and nothing is decided or written.
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

maybe('Action Assistant batch 7 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, surface: 'admin' | 'shop' = 'admin') =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, r: r.body.result })}`);
        return r.body as AssistantTurnDto;
      });
  async function user(label: string, role: Role, audience: SessionAudience, salonId: string | null = null) {
    const u = await prisma.user.create({
      data: { email: `asst7-${run}-${label}@example.test`, phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE },
    });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    for (const [label, role] of [['admin', Role.PLATFORM_ADMIN], ['cofounder', Role.CO_FOUNDER], ['hr', Role.HR_ADMIN], ['sales', Role.SALES_ADMIN], ['viewer', Role.PLATFORM_VIEWER]] as const) {
      await user(label, role, SessionAudience.ADMIN);
    }
    const weak = await prisma.user.create({ data: { email: `asst7-${run}-weak@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: weak.id, role: Role.PLATFORM_ADMIN, salonId: null } });
    tok.adminWrongAudience = tokens.signAccessToken(weak.id, [Role.PLATFORM_ADMIN], SessionAudience.STAFF);

    const owner = await user('owner', Role.SALON_OWNER, SessionAudience.STAFF);
    const city = await prisma.city.create({ data: { name: `Asst7 ${run}`, slug: `asst7-${run}`, state: 'Synthetic', country: 'India', countryCode: 'IN' } });
    const salon = await prisma.salon.create({
      data: { ownerUserId: owner.id, name: `Asst7 Pending Shop ${run}`, slug: `asst7-${run}`, cityId: city.id, addressLine: 'Synthetic', timezone: 'Asia/Kolkata', currency: 'INR', status: SalonStatus.PENDING },
    });
    ids.salon = salon.id;
    ids.request = (await prisma.verificationRequest.create({ data: { subjectType: 'SHOP', salonId: salon.id, submittedByUserId: owner.id, evidenceUrls: [] } })).id;

    const fe = await prisma.user.create({ data: { email: `asst7-${run}-fe@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: fe.id, role: Role.FIELD_EXECUTIVE, salonId: null } });
    const profile = await prisma.employeeProfile.create({ data: { userId: fe.id, employeeCode: `A7-${run}`, fullName: `Field Agent ${run}` } });
    await prisma.employeeCrmLead.create({ data: { employeeProfileId: profile.id, shopName: `Lead ${run}`, status: 'NEW' } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('admin and co-founder see the pending verification queue, without submitter contacts', async () => {
    for (const who of ['admin', 'cofounder']) {
      const r = await say(who, 'pending verification dikhao');
      expect(r.status).toBe('DONE');
      expect(r.result?.items?.map((i) => i.title)).toContain(`Asst7 Pending Shop ${run}`);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: ids.owner } });
      expect(JSON.stringify(r)).not.toContain(owner.email!);
      expect(JSON.stringify(r)).not.toContain(owner.phone!);
    }
    expect((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: ids.request } })).status).toBe('SUBMITTED');
  });

  it('HR, sales and the viewer cannot read the verification queue; a non-admin session cannot either', async () => {
    for (const who of ['hr', 'sales', 'viewer', 'adminWrongAudience']) {
      const r = await say(who, 'pending verification dikhao');
      expect({ who, status: r.status }).toEqual({ who, status: 'DENIED' });
    }
    // A shop owner asking from the shop screen never reaches the platform queue.
    const owner = await say('owner', 'pending verification dikhao', 'shop');
    expect(JSON.stringify(owner)).not.toContain(`Asst7 Pending Shop ${run}`);
  });

  it('the CRM overview is for admin, co-founder, HR and sales - not the viewer', async () => {
    for (const who of ['admin', 'cofounder', 'hr', 'sales']) {
      const r = await say(who, 'sales team ka kaam dikhao');
      expect({ who, status: r.status }).toEqual({ who, status: 'DONE' });
      expect(r.result?.items?.map((i) => i.title)).toContain(`Field Agent ${run}`);
    }
    expect((await say('viewer', 'sales team ka kaam dikhao')).status).toBe('DENIED');
    expect((await say('adminWrongAudience', 'CRM overview')).status).toBe('DENIED');
  });
});
