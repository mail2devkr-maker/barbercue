import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { GrowthService } from '../src/growth/growth.service';
import { MockKeywordProvider } from '../src/growth/keyword-providers';

process.env.JWT_ACCESS_SECRET ??= 'growth-e2e-only-jwt-secret';
process.env.TOTP_ENCRYPTION_KEY ??= 'growth-e2e-only-encryption-secret';
const FLAGS = ['GROWTH_AI_ENABLED', 'GROWTH_AI_KEYWORDS_ENABLED', 'GROWTH_AI_CAMPAIGNS_ENABLED', 'GROWTH_AI_MEASUREMENT_ENABLED'];
const setFlags = (on: boolean) =>
  FLAGS.forEach((f) => {
    if (on) process.env[f] = 'true';
    else delete process.env[f];
  });

let disposable = false;
try {
  const u = new URL(process.env.DATABASE_URL ?? '');
  disposable = ['127.0.0.1', 'localhost'].includes(u.hostname) && u.pathname.replace(/^\//, '') === 'growth_ci';
} catch {
  disposable = false;
}
const maybe = disposable ? describe : describe.skip;
const run = randomUUID().slice(0, 6);
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

maybe('Growth AI customer acquisition (real AppModule, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const api = (method: 'get' | 'post' | 'put' | 'delete', path: string, who?: string) => {
    const r = request(app.getHttpServer())[method](`/api/v1/admin/growth/${path}`);
    if (who) r.set('Authorization', `Bearer ${tok[who]}`);
    return r;
  };

  beforeAll(async () => {
    setFlags(true);
    delete process.env.GROWTH_AI_LLM_ENABLED;
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    app.get(GrowthService).useKeywordProvider(new MockKeywordProvider());
    await prisma.growthControl.update({ where: { id: 1 }, data: { paused: false, pausedReason: null } });
    const tokens = app.get(TokenService);
    const user = async (label: string, roles: Role[], audience: SessionAudience) => {
      const u = await prisma.user.create({ data: { email: `ga-${run}-${label}@example.test`, status: UserStatus.ACTIVE, roles: { create: roles.map((role) => ({ role })) } } });
      ids[label] = u.id;
      tok[label] = tokens.signAccessToken(u.id, roles, audience);
    };
    await user('admin', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('admin2', [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    await user('manager', [Role.CO_FOUNDER], SessionAudience.ADMIN);
    await user('analyst', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    await user('viewer', [Role.PLATFORM_VIEWER], SessionAudience.ADMIN);
    await user('owner', [Role.SALON_OWNER], SessionAudience.STAFF);
    await user('customer', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('customer2', [Role.CUSTOMER], SessionAudience.CUSTOMER);
    await user('customer3', [Role.CUSTOMER], SessionAudience.CUSTOMER);

    const city = await prisma.city.create({ data: { name: `Greater Noida ${run}`, slug: `greater-noida-${run}`, countryCode: 'IN', state: 'Uttar Pradesh', country: 'India' } });
    ids.city = city.id;
    const salon = async (label: string, status: 'ACTIVE' | 'PENDING', service: string, price: string) => {
      const s = await prisma.salon.create({
        data: { ownerUserId: ids.owner, name: `Salon ${label} ${run}`, slug: `salon-${label}-${run}`, cityId: city.id, addressLine: 'Sector Alpha', status, services: { create: [{ name: service, durationMinutes: 30, price }] } },
        include: { services: true },
      });
      ids[label] = s.id;
      ids[`${label}Service`] = s.services[0].id;
    };
    await salon('a', 'ACTIVE', "Men's Haircut", '250');
    await salon('b', 'ACTIVE', 'Hair Cut & Wash', '300');
    await salon('c', 'ACTIVE', 'Haircut', '200');
    await salon('pending', 'PENDING', 'Haircut', '200');
    await salon('facialOnly', 'ACTIVE', 'Gold Facial', '900');

    // Completed haircuts: two today (campaign window: one returning customer, one new), one yesterday (baseline).
    const booking = async (label: string, salonKey: string, slotStart: Date, customer: string, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') => {
      await prisma.booking.create({
        data: {
          salonId: ids[salonKey],
          serviceId: ids[`${salonKey}Service`],
          customerId: customer,
          slotStart,
          slotEnd: new Date(slotStart.getTime() + 30 * 60_000),
          status,
          source: 'WEB',
          idempotencyKey: `ga-${run}-${label}`,
          services: { create: [{ serviceId: ids[`${salonKey}Service`], sortOrder: 0, serviceName: "Men's Haircut", durationMinutes: 30, price: '250' }] },
        },
      });
    };
    const startOfToday = new Date(`${istDay()}T00:00:00.000Z`).getTime() - 5.5 * 3600_000;
    const old = new Date(startOfToday - 40 * 86400_000);
    await booking('old', 'a', old, ids.customer);
    await booking('t1', 'a', new Date(startOfToday + 60_000), ids.customer);
    await booking('t2', 'b', new Date(startOfToday + 120_000), ids.customer2);
    await booking('t3', 'b', new Date(startOfToday + 180_000), ids.customer3, 'CANCELLED');
    await booking('y1', 'c', new Date(startOfToday - 3600_000), ids.customer3);
  }, 120000);

  afterAll(async () => {
    setFlags(false);
    await prisma?.growthControl.update({ where: { id: 1 }, data: { paused: false, pausedReason: null } });
    await app?.close();
  });
  beforeEach(() => setFlags(true));

  it('is invisible with the flag off: every route answers 404, even for a platform admin', async () => {
    setFlags(false);
    for (const path of ['me', 'dashboard', 'keyword-runs', 'proposals']) await api('get', path, 'admin').expect(404);
    await api('post', 'keyword-runs', 'admin').send({}).expect(404);
  });

  it('refuses non-staff and staff without a Growth role', async () => {
    await api('get', 'me', 'owner').expect(403);
    await api('get', 'me', 'customer').expect(403);
    await api('get', 'me').expect(401);
    await api('get', 'dashboard', 'viewer').expect(403);
  });

  it('only an Admin can hand out Growth roles, and only to internal staff', async () => {
    await api('put', 'roles', 'manager').send({ userId: ids.manager, role: 'ADMIN' }).expect(403);
    await api('put', 'roles', 'admin').send({ userId: ids.owner, role: 'ANALYST' }).expect(400);
    await api('put', 'roles', 'admin').send({ userId: ids.manager, role: 'MARKETING_MANAGER' }).expect(200);
    await api('put', 'roles', 'admin').send({ userId: ids.analyst, role: 'ANALYST' }).expect(200);
    const me = await api('get', 'me', 'analyst').expect(200);
    expect(me.body).toMatchObject({ role: 'ANALYST', permissions: ['view', 'research'], mode: 'ADVISORY', keywordProvider: { name: 'mock', isMock: true } });
  });

  it('runs labelled mock research and matches only active, bookable salons that offer the service', async () => {
    await api('post', 'keyword-runs', 'viewer').send({ cityId: ids.city, serviceKey: 'haircut' }).expect(403);
    await api('post', 'keyword-runs', 'analyst').send({ cityId: ids.city, serviceKey: 'haircut', geoTargetConstant: 'http://169.254.169.254/' }).expect(400);
    await api('post', 'exclusions', 'admin').send({ salonId: ids.c, reason: 'Test shop' }).expect(201);
    const excluded = await api('post', 'keyword-runs', 'analyst').send({ cityId: ids.city, serviceKey: 'haircut', dailyBudgetInr: 500 }).expect(201);
    expect(excluded.body.salons.map((s: { salonId: string }) => s.salonId).sort()).toEqual([ids.a, ids.b].sort());
    await api('delete', `exclusions/${ids.c}`, 'admin').expect(200);

    const res = await api('post', 'keyword-runs', 'analyst').send({ cityId: ids.city, serviceKey: 'haircut', dailyBudgetInr: 500 }).expect(201);
    ids.run = res.body.run.id;
    expect(res.body.run).toMatchObject({ isMock: true, provider: 'mock' });
    expect(res.body.notes[0]).toMatch(/MOCK/);
    expect(res.body.salons.map((s: { salonId: string }) => s.salonId).sort()).toEqual([ids.a, ids.b, ids.c].sort());
    const row = res.body.rows[0];
    expect(row).toMatchObject({ isMock: true, matchingSalons: 3, searchDemand: { source: 'MOCK' } });
    expect(Object.keys(row)).toEqual(expect.arrayContaining(['keyword', 'location', 'searchDemand', 'competition', 'recommendedChannel', 'matchingSalons', 'priority']));
    ids.idea1 = res.body.rows[0].ideaId;
    ids.idea2 = res.body.rows[1].ideaId;
  });

  it('reports NO_SUPPLY for a service no active salon offers, and refuses a proposal for it', async () => {
    const res = await api('post', 'keyword-runs', 'analyst').send({ cityId: ids.city, serviceKey: 'hair_colour' }).expect(201);
    expect(res.body.rows.every((r: { priority: string; recommendedChannel: string }) => r.priority === 'NO_SUPPLY' && r.recommendedChannel === 'NONE')).toBe(true);
    await api('post', 'proposals', 'manager').send({ keywordRunId: res.body.run.id, ideaIds: [res.body.rows[0].ideaId], dailyBudgetInr: 500, durationDays: 7, startsOn: istDay() }).expect(409);
  });

  it('drafts a proposal with a deterministic ₹500/day preview, caps the budget and never claims spend', async () => {
    const body = { keywordRunId: ids.run, ideaIds: [ids.idea1, ids.idea2], dailyBudgetInr: 500, durationDays: 14, startsOn: istDay() };
    await api('post', 'proposals', 'analyst').send(body).expect(403);
    await api('post', 'proposals', 'manager').send({ ...body, dailyBudgetInr: 5000 }).expect(400);
    await api('post', 'proposals', 'manager').send({ ...body, startsOn: istDay(-3) }).expect(400);
    const res = await api('post', 'proposals', 'manager').send(body).expect(201);
    ids.proposal = res.body.id;
    expect(res.body).toMatchObject({ status: 'DRAFT', usesMockData: true, dailyBudgetPaise: 50000, durationDays: 14, channel: 'GOOGLE_SEARCH' });
    expect(res.body.preview).toMatchObject({ totalBudgetPaise: 700000, realSpendPaise: 0, expectedBookings: { value: null, source: 'UNAVAILABLE' }, clicksPerDay: { source: 'MOCK' } });
    expect(res.body.risks[0]).toMatch(/MOCK/);
    expect(res.body.salons).toHaveLength(3);
  });

  it('enforces RESEARCH → DRAFT → REVIEW → APPROVE with a different approver and a MOCK acknowledgement', async () => {
    const t = (who: string, action: string, extra: Record<string, unknown> = {}) => api('post', `proposals/${ids.proposal}/transition`, who).send({ action, ...extra });
    await t('manager', 'approve').expect(409);
    await t('manager', 'submit').expect(400); // no ad text yet
    const copy = await api('post', `proposals/${ids.proposal}/copy`, 'manager').expect(200);
    expect(copy.body.adCopySource).toBe('TEMPLATE');
    expect(copy.body.adCopy.headlines.every((h: string) => h.length <= 30)).toBe(true);
    await t('analyst', 'submit').expect(403);
    await t('manager', 'submit').expect(200);
    await api('post', `proposals/${ids.proposal}/copy`, 'manager').expect(409); // frozen while in review
    await t('manager', 'approve').expect(403); // drafted it, cannot approve it
    await t('admin', 'reject').expect(400); // needs a reason
    await t('admin', 'approve').expect(400); // MOCK data must be acknowledged
    const ok = await t('admin', 'approve', { acknowledgeMock: true, note: 'Demo only' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', approvedByUserId: ids.admin, approvalIsCurrent: true });
    expect(ok.body.events.map((e: { action: string }) => e.action)).toEqual(['create', 'submit', 'approve']);
    expect(ok.body.events[2].note).toMatch(/acknowledged MOCK/);
    await t('admin', 'approve', { acknowledgeMock: true }).expect(409);
  });

  it('has no publish, spend or send route', async () => {
    for (const path of [`proposals/${ids.proposal}/publish`, `proposals/${ids.proposal}/spend`, 'campaigns/publish']) await api('post', path, 'admin').send({}).expect(404);
    await api('post', `proposals/${ids.proposal}/transition`, 'admin').send({ action: 'publish' }).expect(400);
  });

  it('keeps the approval history append-only in the database', async () => {
    await expect(prisma.growthProposalEvent.deleteMany({ where: { proposalId: ids.proposal } })).rejects.toThrow(/append-only/);
    await expect(prisma.growthProposalEvent.updateMany({ where: { proposalId: ids.proposal }, data: { note: 'x' } })).rejects.toThrow(/append-only/);
  });

  it('measures completed bookings from FastQue data, separately from platform conversions', async () => {
    const m = await api('get', `proposals/${ids.proposal}/measurement`, 'analyst').expect(200);
    expect(m.body.campaign).toMatchObject({ completedBookings: 2, serviceValuePaise: 50000, newCustomers: 1 });
    expect(m.body.baseline).toMatchObject({ completedBookings: 1, newCustomers: 1 });
    expect(m.body.observedChange.completedBookings).toBe(1);
    expect(m.body.platformAttributed).toMatchObject({ value: null, source: 'UNAVAILABLE' });
    expect(m.body.costPerCompletedBooking.value).toBeNull();
    expect(m.body.realSpendPaise).toBe(0);
    await api('post', `proposals/${ids.proposal}/measurements`, 'analyst').expect(201);
    await api('get', `proposals/${ids.proposal}/measurements`, 'viewer').expect(403);
    const h = await api('get', `proposals/${ids.proposal}/measurements`, 'manager').expect(200);
    expect(h.body).toHaveLength(1);
  });

  it('emergency pause stops every write but keeps reads', async () => {
    await api('put', 'pause', 'manager').send({ paused: true, reason: 'Testing' }).expect(403);
    await api('put', 'pause', 'admin').send({ paused: true }).expect(400);
    await api('put', 'pause', 'admin').send({ paused: true, reason: 'Budget review' }).expect(200);
    await api('post', 'keyword-runs', 'analyst').send({ cityId: ids.city, serviceKey: 'haircut' }).expect(423);
    await api('post', `proposals/${ids.proposal}/measurements`, 'analyst').expect(423);
    await api('get', `proposals/${ids.proposal}`, 'analyst').expect(200);
    const me = await api('get', 'me', 'analyst').expect(200);
    expect(me.body).toMatchObject({ paused: true, pausedReason: 'Budget review' });
    await api('put', 'pause', 'admin').send({ paused: false }).expect(200);
  });

  it('shows Unavailable instead of inventing dashboard numbers', async () => {
    const d = await api('get', 'dashboard', 'analyst').expect(200);
    expect(d.body).toHaveLength(18);
    expect(d.body.find((s: { id: string }) => s.id === 'spend')).toMatchObject({ status: 'UNAVAILABLE', value: null });
    expect(d.body.find((s: { id: string }) => s.id === 'cac')).toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('respects sub-feature flags with 404', async () => {
    delete process.env.GROWTH_AI_CAMPAIGNS_ENABLED;
    await api('post', `proposals/${ids.proposal}/transition`, 'admin').send({ action: 'archive' }).expect(404);
    delete process.env.GROWTH_AI_MEASUREMENT_ENABLED;
    await api('get', `proposals/${ids.proposal}/measurement`, 'admin').expect(404);
    await api('get', `proposals/${ids.proposal}`, 'admin').expect(200);
  });
});
