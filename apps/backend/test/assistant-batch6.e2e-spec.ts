import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SessionAudience, UserStatus, type AssistantTurnDto } from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Action Assistant batch 6 (issue #362) on a DISPOSABLE local database: a field employee reads
 * their OWN leads, follow-ups, visits and summary. Another employee's records never appear, and the
 * same role from a non-EMPLOYEE session (or any other role) is refused. Nothing is written.
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

maybe('Action Assistant batch 6 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string, surface: 'employee' | 'shop' | 'customer' = 'employee') =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, r: r.body.result })}`);
        return r.body as AssistantTurnDto;
      });

  async function employee(label: string, shops: string[]) {
    const u = await prisma.user.create({ data: { email: `asst6-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role: Role.FIELD_EXECUTIVE, salonId: null } });
    const profile = await prisma.employeeProfile.create({ data: { userId: u.id, employeeCode: `A6-${run}-${label}`, fullName: label } });
    tok[label] = tokens.signAccessToken(u.id, [Role.FIELD_EXECUTIVE], SessionAudience.EMPLOYEE);
    ids[label] = u.id;
    for (const [i, shopName] of shops.entries()) {
      const lead = await prisma.employeeCrmLead.create({
        data: { employeeProfileId: profile.id, shopName, city: 'Lucknow', status: i === 0 ? 'INTERESTED' : 'NEW', phone: '+919800000000' },
      });
      await prisma.employeeCrmVisit.create({ data: { employeeProfileId: profile.id, leadId: lead.id, shopName, outcome: 'CONTACTED' } });
      await prisma.employeeCrmFollowUp.create({
        data: { employeeProfileId: profile.id, leadId: lead.id, channel: 'CALL', dueAt: new Date(Date.now() + (i === 0 ? -3 : 3) * 3_600_000) },
      });
    }
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

    await employee('asha', [`Asha Shop One ${run}`, `Asha Shop Two ${run}`]);
    await employee('bilal', [`Bilal Secret Shop ${run}`]);
    // Same role, wrong session audience (as if minted for another screen): must be refused.
    tok.ashaWrongAudience = tokens.signAccessToken(ids.asha, [Role.FIELD_EXECUTIVE], SessionAudience.STAFF);
    const cust = await prisma.user.create({ data: { email: `asst6-${run}-cust@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: cust.id, role: Role.CUSTOMER, salonId: null } });
    tok.cust = tokens.signAccessToken(cust.id, [Role.CUSTOMER], SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows only my own leads, with an optional status filter, and no phone numbers', async () => {
    const all = await say('asha', 'mere leads dikhao');
    expect(all.status).toBe('DONE');
    const titles = all.result?.items?.map((i) => i.title) ?? [];
    expect(titles.sort()).toEqual([`Asha Shop One ${run}`, `Asha Shop Two ${run}`]);
    expect(JSON.stringify(all)).not.toContain('Bilal');
    expect(JSON.stringify(all)).not.toContain('9800000000');

    const interested = await say('asha', 'interested leads dikhao');
    expect(interested.result?.items?.map((i) => i.title)).toEqual([`Asha Shop One ${run}`]);
  });

  it('follow-ups, overdue only on request; visits; summary counts', async () => {
    const open = await say('asha', 'aaj ke follow up dikhao');
    expect(open.result?.items).toHaveLength(2);
    const overdue = await say('asha', 'overdue follow ups');
    expect(overdue.result?.items?.map((i) => i.title)).toEqual([`Asha Shop One ${run}`]);
    expect(overdue.result?.items?.[0].detail).toMatch(/^overdue/);

    const visits = await say('asha', 'meri visits dikhao');
    expect(visits.result?.items).toHaveLength(2);

    const summary = await say('asha', 'mera kaam kitna hua');
    expect(summary.result?.items).toEqual(
      expect.arrayContaining([
        { title: 'Leads', detail: '2' },
        { title: 'Open follow-ups', detail: '2' },
        { title: 'Overdue follow-ups', detail: '1' },
      ]),
    );
  });

  it('refuses the wrong session audience and other roles; writes nothing', async () => {
    const before = await prisma.employeeCrmLead.count();
    expect((await say('ashaWrongAudience', 'mere leads dikhao')).status).toBe('DENIED');
    expect((await say('cust', 'mere leads dikhao')).status).toBe('DENIED');
    const bilal = await say('bilal', 'mere leads dikhao');
    expect(bilal.result?.items?.map((i) => i.title)).toEqual([`Bilal Secret Shop ${run}`]);
    expect(await prisma.employeeCrmLead.count()).toBe(before);
  });
});
