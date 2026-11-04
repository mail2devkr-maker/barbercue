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
 * Action Assistant batch 8 (issue #362) on a DISPOSABLE local database: a field employee logs a
 * visit to their OWN lead and closes their OWN follow-up, each after a preview and confirmation.
 * Another employee's lead or follow-up is never offered, and replays write nothing.
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

maybe('Action Assistant batch 8 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (who: string, text: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface: 'employee' })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG) console.log(`[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, o: r.body.options, p: r.body.preview })}`);
        return r.body as AssistantTurnDto;
      });
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm' })
      .expect(200)
      .then((r) => r.body as AssistantTurnDto);

  async function employee(label: string, shop: string) {
    const u = await prisma.user.create({ data: { email: `asst8-${run}-${label}@example.test`, emailVerifiedAt: new Date(), status: UserStatus.ACTIVE } });
    await prisma.userRole.create({ data: { userId: u.id, role: Role.FIELD_EXECUTIVE, salonId: null } });
    const profile = await prisma.employeeProfile.create({ data: { userId: u.id, employeeCode: `A8-${run}-${label}`, fullName: label } });
    tok[label] = tokens.signAccessToken(u.id, [Role.FIELD_EXECUTIVE], SessionAudience.EMPLOYEE);
    const lead = await prisma.employeeCrmLead.create({ data: { employeeProfileId: profile.id, shopName: shop, status: 'NEW' } });
    ids[`${label}Lead`] = lead.id;
    ids[`${label}FollowUp`] = (
      await prisma.employeeCrmFollowUp.create({ data: { employeeProfileId: profile.id, leadId: lead.id, channel: 'CALL', dueAt: new Date(Date.now() + 3_600_000) } })
    ).id;
  }

  beforeAll(async () => {
    // These suites exercise the assistant itself, so the release gate is opened for everyone here.
    process.env.ASSISTANT_MODE = 'all';
    process.env.ASSISTANT_WRITES = 'all';
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
    await employee('asha', 'Sharma Salon');
    await employee('bilal', 'Verma Salon');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('asks for the outcome, then logs the visit once and moves the lead forward', async () => {
    const ask = await say('asha', 'Sharma Salon visit kiya');
    expect(ask.status).toBe('NEEDS_INPUT');
    expect(ask.options?.length).toBeGreaterThanOrEqual(4);

    const preview = await say('asha', 'Sharma Salon visit kiya, interested');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows).toEqual(expect.arrayContaining([{ label: 'Lead status', before: 'new', after: 'interested' }]));
    expect(await prisma.employeeCrmVisit.count({ where: { leadId: ids.ashaLead } })).toBe(0);

    expect((await confirm('asha', preview.confirmation!.token)).status).toBe('DONE');
    expect(await prisma.employeeCrmVisit.count({ where: { leadId: ids.ashaLead } })).toBe(1);
    expect((await prisma.employeeCrmLead.findUniqueOrThrow({ where: { id: ids.ashaLead } })).status).toBe('INTERESTED');
    expect((await confirm('asha', preview.confirmation!.token)).status).toBe('FAILED');
    expect(await prisma.employeeCrmVisit.count({ where: { leadId: ids.ashaLead } })).toBe(1);
  });

  it("never offers another employee's lead or follow-up", async () => {
    const r = await say('asha', 'Verma Salon visit kiya, interested');
    // Asha has one lead, so the name does not match and she is asked to choose among her own.
    expect(JSON.stringify(r)).not.toContain('Verma');
    expect(await prisma.employeeCrmVisit.count({ where: { leadId: ids.bilalLead } })).toBe(0);
    const f = await say('asha', 'Verma Salon ka follow up ho gaya');
    expect(JSON.stringify(f)).not.toContain('Verma');
  });

  it('closes my own follow-up with what happened', async () => {
    const preview = await say('asha', 'Sharma Salon ka follow up ho gaya: demo kal');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect((await confirm('asha', preview.confirmation!.token)).status).toBe('DONE');
    const row = await prisma.employeeCrmFollowUp.findUniqueOrThrow({ where: { id: ids.ashaFollowUp } });
    expect(row).toMatchObject({ status: 'COMPLETED', outcome: 'demo kal' });
    expect(row.completedAt).not.toBeNull();
    expect((await prisma.employeeCrmFollowUp.findUniqueOrThrow({ where: { id: ids.bilalFollowUp } })).status).toBe('OPEN');
    expect((await say('asha', 'Sharma Salon ka follow up ho gaya')).message).toMatch(/no open follow-ups/);
  });
});
