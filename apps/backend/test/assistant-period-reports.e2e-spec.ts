import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  BookingSource,
  BookingStatus,
  QueueEntrySource,
  QueueEntryStatus,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resolvePeriod } from '../src/assistant/assistant-period';

/**
 * Assistant period reports through the real turn endpoint, on a DISPOSABLE database with bookings and
 * queue entries spread over this week, last week, last month and older. Counts must equal the rows in
 * the period (shop timezone), the live queue is never added to a period, follow-ups change only the
 * period / page, and only the shop's own manager sees its figures.
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
const TZ = 'Asia/Kolkata';

maybe('Assistant period reports (e2e, disposable database)', () => {
  const run = randomUUID().slice(0, 8);
  const saved = Object.fromEntries(GATE.map((k) => [k, process.env[k]]));
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const expected: Record<string, number> = {};

  const turn = (
    who: string,
    text: string,
    salon = ids.shop,
    context?: unknown,
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({
        text,
        surface: 'shop',
        salonId: salon,
        ...(context ? { context } : {}),
      });

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
        name: `PR ${run}`,
        slug: `pr-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    const user = async (label: string) =>
      (
        await prisma.user.create({
          data: {
            email: `pr-${run}-${label}@example.test`,
            emailVerifiedAt: new Date(),
            status: UserStatus.ACTIVE,
          },
        })
      ).id;
    for (const key of ['shop', 'other']) {
      const owner = await user(`owner-${key}`);
      const s = await prisma.salon.create({
        data: {
          ownerUserId: owner,
          name: `PR ${key} ${run}`,
          slug: `pr-${key}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: TZ,
          currency: 'INR',
          status: SalonStatus.ACTIVE,
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      });
      await prisma.userRole.create({
        data: { userId: owner, role: Role.SALON_OWNER, salonId: s.id },
      });
      tok[`owner-${key}`] = tokens.signAccessToken(
        owner,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      ids[key] = s.id;
      ids[`svc-${key}`] = (
        await prisma.service.create({
          data: {
            salonId: s.id,
            name: `Cut ${key}`,
            price: 200,
            durationMinutes: 30,
          },
        })
      ).id;
    }
    const staff = await user('staff');
    await prisma.userRole.create({
      data: { userId: staff, role: Role.SALON_STAFF, salonId: ids.shop },
    });
    tok.staff = tokens.signAccessToken(
      staff,
      [Role.SALON_STAFF],
      SessionAudience.STAFF,
    );
    const customer = await user('customer');
    tok.customer = tokens.signAccessToken(
      customer,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );

    // One booking per day for the last 75 days (status cycles), plus the same in the other shop.
    const now = new Date();
    const statuses = [
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
      BookingStatus.CONFIRMED,
      BookingStatus.NO_SHOW,
    ];
    let n = 0;
    const all: Array<{ at: Date; status: BookingStatus }> = [];
    for (let d = 0; d < 75; d++) {
      const at = new Date(now.getTime() - d * 86_400_000 - 60 * 60_000);
      const status = statuses[d % statuses.length];
      all.push({ at, status });
      for (const key of ['shop', 'other'])
        await prisma.booking.create({
          data: {
            salonId: ids[key],
            serviceId: ids[`svc-${key}`],
            customerId: customer,
            slotStart: at,
            slotEnd: new Date(at.getTime() + 30 * 60_000),
            status,
            source: BookingSource.WEB,
            idempotencyKey: `pr-${run}-${key}-${n++}`,
          },
        });
      // Queue history: one served entry per day; another one left on even days.
      await prisma.queueEntry.create({
        data: {
          salonId: ids.shop,
          source: QueueEntrySource.WALK_IN,
          status: QueueEntryStatus.COMPLETED,
          tokenNumber: 1000 + d,
          joinedAt: at,
        },
      });
      if (d % 2 === 0)
        await prisma.queueEntry.create({
          data: {
            salonId: ids.shop,
            source: QueueEntrySource.WALK_IN,
            status: QueueEntryStatus.NO_SHOW,
            tokenNumber: 2000 + d,
            joinedAt: at,
          },
        });
    }
    // Live right now: 3 waiting (joined today).
    for (let i = 0; i < 3; i++)
      await prisma.queueEntry.create({
        data: {
          salonId: ids.shop,
          source: QueueEntrySource.WALK_IN,
          status: QueueEntryStatus.WAITING,
          tokenNumber: 3000 + i,
          joinedAt: new Date(now.getTime() - 5 * 60_000),
        },
      });
    const inPeriod = (kind: Parameters<typeof resolvePeriod>[0]) => {
      const p = resolvePeriod(kind, TZ, now);
      return all.filter((b) => b.at >= p.start && b.at < p.end);
    };
    expected.thisWeek = inPeriod({ kind: 'thisWeek' }).length;
    expected.lastWeek = inPeriod({ kind: 'lastWeek' }).length;
    expected.lastMonth = inPeriod({ kind: 'lastMonth' }).length;
    expected.last30 = inPeriod({ kind: 'lastDays', days: 30 }).length;
    expected.thisMonthCancelled = inPeriod({ kind: 'thisMonth' }).filter(
      (b) => b.status === BookingStatus.CANCELLED,
    ).length;
    const lm = resolvePeriod({ kind: 'lastMonth' }, TZ, now);
    expected.lastMonthQueueJoined = inPeriod({ kind: 'lastMonth' }).reduce(
      (acc, b) => {
        const d = Math.round(
          (now.getTime() - 60 * 60_000 - b.at.getTime()) / 86_400_000,
        );
        return acc + 1 + (d % 2 === 0 ? 1 : 0);
      },
      0,
    );
    expect(lm.start < lm.end).toBe(true);
  });

  afterAll(async () => {
    await app?.close();
    for (const k of GATE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const count = (msg: string) => Number(msg.match(/: (\d+) /)?.[1]);

  it('weekly, monthly and rolling periods count exactly the rows in the period', async () => {
    const week = (
      await turn('owner-shop', "Show this week's bookings").expect(200)
    ).body;
    expect(week.action.id).toBe('bookings.report');
    expect(count(week.message)).toBe(expected.thisWeek);
    expect(
      count(
        (await turn('owner-shop', "Show last week's bookings").expect(200)).body
          .message,
      ),
    ).toBe(expected.lastWeek);
    expect(
      count(
        (await turn('owner-shop', 'show last month bookings').expect(200)).body
          .message,
      ),
    ).toBe(expected.lastMonth);
    expect(
      count(
        (
          await turn(
            'owner-shop',
            'How many bookings happened in the last 30 days?',
          ).expect(200)
        ).body.message,
      ),
    ).toBe(expected.last30);
    const cancelled = (
      await turn(
        'owner-shop',
        'Show booking cancellations for this month',
      ).expect(200)
    ).body;
    expect(count(cancelled.message)).toBe(expected.thisMonthCancelled);
    expect(
      cancelled.result.items.every((i: { detail: string }) =>
        i.detail.startsWith('cancelled'),
      ),
    ).toBe(true);
  });

  it('pagination: 10 per page, "aur dikhao" continues', async () => {
    const first = (
      await turn(
        'owner-shop',
        'How many bookings happened in the last 30 days?',
      ).expect(200)
    ).body;
    expect(first.result.items).toHaveLength(10);
    const second = (
      await turn(
        'owner-shop',
        'aur dikhao',
        ids.shop,
        first.reportContext,
      ).expect(200)
    ).body;
    expect(second.reportContext.page).toBe(2);
    expect(second.result.items).toHaveLength(10);
    const firstIds = new Set(
      first.result.items.map((i: { id: string }) => i.id),
    );
    expect(
      second.result.items.some((i: { id: string }) => firstIds.has(i.id)),
    ).toBe(false);
  });

  it('a follow-up changes only the period', async () => {
    const week = (
      await turn('owner-shop', "Show this week's bookings").expect(200)
    ).body;
    const lastMonth = (
      await turn(
        'owner-shop',
        'aur last month?',
        ids.shop,
        week.reportContext,
      ).expect(200)
    ).body;
    expect(lastMonth.action.id).toBe('bookings.report');
    expect(count(lastMonth.message)).toBe(expected.lastMonth);
  });

  it('queue history never presents the live queue as the period total', async () => {
    const r = (
      await turn(
        'owner-shop',
        'pichhle mahine queue mein kitne customers aaye',
      ).expect(200)
    ).body;
    expect(r.action.id).toBe('queue.history');
    expect(count(r.message)).toBe(expected.lastMonthQueueJoined);
    expect(r.message).toMatch(
      /Right now 3 are in the live queue; that is not part of this period/,
    );
    const live = (
      await turn('owner-shop', 'queue mein abhi kitne hain').expect(200)
    ).body;
    expect(live.action.id).toBe('queue.status');
  });

  it('shop isolation and roles: other shops, staff and customers get nothing', async () => {
    const other = (
      await turn('owner-other', "Show this week's bookings", ids.shop).expect(
        200,
      )
    ).body;
    expect(other.status).toBe('DENIED');
    expect(
      (await turn('staff', "Show this week's bookings").expect(200)).body
        .status,
    ).toBe('DENIED');
    expect(
      (await turn('customer', "Show this week's bookings").expect(200)).body
        .status,
    ).toBe('DENIED');
    const forged = await turn('owner-shop', 'aur dikhao', ids.shop, {
      action: 'staff.add',
      period: { kind: 'today' },
      page: 1,
    });
    expect(forged.status).toBe(400);
  });

  it('periods before the shop has any record are stated, not counted as empty; older history is never denied', async () => {
    // A shop row created now with older bookings (imported history): no false "records only from".
    await prisma.salon.update({
      where: { id: ids.other },
      data: { createdAt: new Date() },
    });
    const imported = (
      await turn('owner-other', 'show last month bookings', ids.other).expect(
        200,
      )
    ).body;
    expect(imported.message).not.toMatch(/records only from/);
    // A brand-new shop with no records at all: the period's earlier days are stated, not implied empty.
    const owner = (
      await prisma.user.create({
        data: {
          email: `pr-${run}-fresh@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      })
    ).id;
    const city = await prisma.city.findFirstOrThrow({
      where: { slug: `pr-${run}` },
    });
    const fresh = await prisma.salon.create({
      data: {
        ownerUserId: owner,
        name: `PR fresh ${run}`,
        slug: `pr-fresh-${run}`,
        cityId: city.id,
        addressLine: 'Synthetic',
        timezone: TZ,
        currency: 'INR',
        status: SalonStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: owner, role: Role.SALON_OWNER, salonId: fresh.id },
    });
    tok.fresh = app
      .get(TokenService)
      .signAccessToken(owner, [Role.SALON_OWNER], SessionAudience.STAFF);
    const r = (
      await turn('fresh', 'show last month bookings', fresh.id).expect(200)
    ).body;
    expect(r.message).toMatch(/: 0 bookings\..*records only from/);
  });
});
