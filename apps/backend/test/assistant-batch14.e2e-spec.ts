import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
  type AssistantTurnDto,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BookingAttributionService } from '../src/owner-ops/booking-attribution.service';

/**
 * Action Assistant batch 14 (issue #362) on a DISPOSABLE local database: a barber takes the next
 * arrived customer (confirmed; their own profile; single-use; stale preview refused; no phone numbers
 * read out), the shop's booking link and the tracked booking links (owner/admin; link tokens never
 * shown). Every assertion is scoped to this run's own shop, so it is stable on a shared CI database.
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

maybe('Action Assistant batch 14 (e2e, disposable local database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const say = (
    who: string,
    text: string,
    surface: 'shop' | 'customer' = 'shop',
    salonId: string = ids.salon,
  ) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/turns')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ text, surface, ...(surface === 'shop' ? { salonId } : {}) })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG)
          console.log(
            `[turn] ${who}: ${text} => ${JSON.stringify({ s: r.body.status, m: r.body.message, r: r.body.result })}`,
          );
        return r.body as AssistantTurnDto;
      });
  const confirm = (who: string, t: string) =>
    request(app.getHttpServer())
      .post('/api/v1/assistant/confirmations')
      .set('Authorization', `Bearer ${tok[who]}`)
      .send({ token: t, decision: 'confirm' })
      .expect(200)
      .then((r) => {
        if (process.env.ASSISTANT_E2E_DEBUG)
          console.log(
            `[confirm] ${who} => ${JSON.stringify({ s: r.body.status, m: r.body.message })}`,
          );
        return r.body as AssistantTurnDto;
      });
  async function user(
    label: string,
    role: Role,
    audience: SessionAudience,
    salonId: string | null = null,
    phone?: string,
  ) {
    const u = await prisma.user.create({
      data: {
        email: `asst14-${run}-${label}@example.test`,
        phone,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(u.id, [role], audience);
    ids[label] = u.id;
    return u;
  }

  beforeAll(async () => {
    // These suites exercise the assistant itself, so the release gate is opened for everyone here.
    process.env.ASSISTANT_MODE = 'all';
    process.env.ASSISTANT_WRITES = 'all';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const city = await prisma.city.create({
      data: {
        name: `Asst14 ${run}`,
        slug: `asst14-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    for (const label of ['salon', 'otherSalon']) {
      const owner = await user(
        `${label}Owner`,
        Role.SALON_OWNER,
        SessionAudience.STAFF,
      );
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Asst14 ${label} ${run}`,
          slug: `asst14-${label}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          status: SalonStatus.ACTIVE,
          queueAutoAssignEnabled: false,
        },
      });
      await prisma.userRole.updateMany({
        where: { userId: owner.id },
        data: { salonId: salon.id },
      });
      ids[label] = salon.id;
      for (let day = 0; day < 7; day++) {
        await prisma.operatingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            openTime: '00:00',
            closeTime: '23:59',
            isClosed: false,
          },
        });
      }
    }
    ids.haircut = (
      await prisma.service.create({
        data: {
          salonId: ids.salon,
          name: 'Haircut',
          durationMinutes: 30,
          price: 200,
        },
      })
    ).id;
    await prisma.chair.create({
      data: { salonId: ids.salon, label: 'Chair 1' },
    });
    const barber = await user(
      'barber',
      Role.SALON_STAFF,
      SessionAudience.STAFF,
      ids.salon,
    );
    ids.staff = (
      await prisma.salonStaff.create({
        data: {
          salonId: ids.salon,
          userId: barber.id,
          displayName: `Ravi ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      })
    ).id;
    await prisma.staffService.create({
      data: { staffId: ids.staff, serviceId: ids.haircut },
    });
    ids.phone = `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    // Token 1 has arrived; token 2 has not, so only token 1 can be taken.
    ids.entry1 = (
      await prisma.queueEntry.create({
        data: {
          salonId: ids.salon,
          source: 'WALK_IN',
          status: 'WAITING',
          tokenNumber: 1,
          contactName: 'Amit',
          contactPhone: ids.phone,
          serviceId: ids.haircut,
          arrivedAt: new Date(),
        },
      })
    ).id;
    ids.entry2 = (
      await prisma.queueEntry.create({
        data: {
          salonId: ids.salon,
          source: 'WALK_IN',
          status: 'WAITING',
          tokenNumber: 2,
          contactName: 'Vikas',
          serviceId: ids.haircut,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a barber takes the next arrived customer: previewed, confirmed once, no phone read out', async () => {
    expect(
      (await say('barber', 'mujhe agla customer do', 'shop', ids.otherSalon))
        .status,
    ).toBe('DENIED');
    const preview = await say('barber', 'mujhe agla customer do');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    expect(preview.preview?.rows).toEqual([
      { label: 'Barber', before: null, after: `Ravi ${run}` },
      {
        label: 'Next customer',
        before: null,
        after: 'Token 1 · Amit · Haircut',
      },
    ]);
    expect(JSON.stringify(preview)).not.toContain(ids.phone.slice(-8));
    expect(
      (await prisma.queueEntry.findUniqueOrThrow({ where: { id: ids.entry1 } }))
        .status,
    ).toBe('WAITING');
    expect(
      (await confirm('salonOwner', preview.confirmation!.token)).status,
    ).not.toBe('DONE');
    const done = await confirm('barber', preview.confirmation!.token);
    expect(done.status).toBe('DONE');
    expect(done.message).toBe(`Started token 1 for Ravi ${run}.`);
    expect(done.refresh).toContain('queue');
    const e1 = await prisma.queueEntry.findUniqueOrThrow({
      where: { id: ids.entry1 },
    });
    expect(e1).toMatchObject({
      status: 'IN_SERVICE',
      assignedStaffId: ids.staff,
    });
    expect(
      (await prisma.queueEntry.findUniqueOrThrow({ where: { id: ids.entry2 } }))
        .status,
    ).toBe('WAITING');
    expect((await confirm('barber', preview.confirmation!.token)).status).toBe(
      'FAILED',
    );
    // Busy now: refused without a preview.
    const busy = await say('barber', 'mujhe agla customer do');
    expect(busy.status).toBe('FAILED');
    expect(busy.message).toBe(
      'You are serving token 1. Complete that service first.',
    );
  });

  it('a take-next preview goes stale when the queue changes', async () => {
    await prisma.serviceSession.updateMany({
      where: { staffId: ids.staff, status: 'ACTIVE' },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await prisma.queueEntry.update({
      where: { id: ids.entry1 },
      data: { status: 'COMPLETED' },
    });
    await prisma.queueEntry.update({
      where: { id: ids.entry2 },
      data: { arrivedAt: new Date() },
    });
    const preview = await say('barber', 'main agla customer leta hoon');
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    await prisma.queueEntry.update({
      where: { id: ids.entry2 },
      data: { status: 'CANCELLED' },
    });
    expect((await confirm('barber', preview.confirmation!.token)).status).toBe(
      'FAILED',
    );
    expect(
      (await prisma.queueEntry.findUniqueOrThrow({ where: { id: ids.entry2 } }))
        .assignedStaffId,
    ).toBeNull();
  });

  it('booking link and tracked links: owner only, and a link token is never shown', async () => {
    const link = await say('salonOwner', 'meri shop ka link do');
    expect(link.status).toBe('DONE');
    expect(link.message).toMatch(/^Your booking link/);
    expect(JSON.stringify(link)).toContain(`asst14-salon-${run}`);
    expect((await say('barber', 'meri shop ka link do')).status).toBe('DENIED');
    expect(
      (await say('otherSalonOwner', 'meri shop ka link do', 'shop', ids.salon))
        .status,
    ).toBe('DENIED');

    expect((await say('salonOwner', 'tracking links dikhao')).message).toBe(
      'You have no tracked booking links yet.',
    );
    const created = await app
      .get(BookingAttributionService)
      .createCampaign(ids.salonOwner, ids.salon, {
        source: 'INSTAGRAM',
        label: `Insta ${run}`,
      });
    const r = await say('salonOwner', 'tracking links dikhao');
    expect(r.status).toBe('DONE');
    expect(r.message).toBe('1 active tracked link.');
    expect(r.result?.items).toEqual([
      { title: `Insta ${run}`, detail: 'Instagram · 0 bookings' },
    ]);
    expect(JSON.stringify(r)).not.toContain(created.token);
    expect((await say('barber', 'tracking links dikhao')).status).toBe(
      'DENIED',
    );
  });
});
