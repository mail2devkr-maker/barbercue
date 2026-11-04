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

/**
 * Issue #368 on a DISPOSABLE local database, with the PRODUCTION rollout shape: an owner-only cohort
 * and writes OFF. Help answers, live chair availability, navigation to the main screen, the
 * contextual "not understood" reply, and that none of it widens access or changes data.
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

maybe(
  'Action Assistant batch 15: conversation basics (e2e, disposable local database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const saved = {
      mode: process.env.ASSISTANT_MODE,
      writes: process.env.ASSISTANT_WRITES,
      cohort: process.env.ASSISTANT_COHORT_USER_IDS,
    };

    const say = (
      who: string,
      text: string,
      salonId: string = ids.salon,
      surface: 'shop' | 'customer' = 'shop',
    ) =>
      request(app.getHttpServer())
        .post('/api/v1/assistant/turns')
        .set('Authorization', `Bearer ${tok[who]}`)
        .send({
          text,
          surface,
          inputMode: 'voice',
          ...(surface === 'shop' ? { salonId } : {}),
        })
        .then((r) => ({ code: r.status, body: r.body as AssistantTurnDto }));

    async function user(
      label: string,
      role: Role,
      salonId: string | null = null,
    ) {
      const u = await prisma.user.create({
        data: {
          email: `asst15-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
      tok[label] = tokens.signAccessToken(u.id, [role], SessionAudience.STAFF);
      ids[label] = u.id;
      return u;
    }

    beforeAll(async () => {
      const seedMod: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const seedApp = seedMod.createNestApplication();
      await seedApp.init();
      prisma = seedApp.get(PrismaService);
      tokens = seedApp.get(TokenService);
      const city = await prisma.city.create({
        data: {
          name: `Asst15 ${run}`,
          slug: `asst15-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      });
      for (const label of ['salon', 'otherSalon']) {
        const owner = await user(`${label}Owner`, Role.SALON_OWNER);
        const salon = await prisma.salon.create({
          data: {
            ownerUserId: owner.id,
            name: `Asst15 ${label} ${run}`,
            slug: `asst15-${label}-${run}`,
            cityId: city.id,
            addressLine: 'Synthetic',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            status: SalonStatus.ACTIVE,
          },
        });
        await prisma.userRole.updateMany({
          where: { userId: owner.id },
          data: { salonId: salon.id },
        });
        ids[label] = salon.id;
      }
      // Chairs: one in service, one marked occupied, one free, one under repair.
      const svc = await prisma.service.create({
        data: {
          salonId: ids.salon,
          name: 'Haircut',
          durationMinutes: 30,
          price: 200,
        },
      });
      const barber = await user('barber', Role.SALON_STAFF, ids.salon);
      const staff = await prisma.salonStaff.create({
        data: {
          salonId: ids.salon,
          userId: barber.id,
          displayName: `Ravi ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      const [c1, c2] = await Promise.all(
        ['Chair 1', 'Chair 2', 'Chair 3'].map((label) =>
          prisma.chair.create({ data: { salonId: ids.salon, label } }),
        ),
      );
      await prisma.chair.create({
        data: { salonId: ids.salon, label: 'Chair 4', status: 'MAINTENANCE' },
      });
      const entry = await prisma.queueEntry.create({
        data: {
          salonId: ids.salon,
          source: 'WALK_IN',
          status: 'IN_SERVICE',
          tokenNumber: 1,
          contactName: 'Amit',
          serviceId: svc.id,
        },
      });
      await prisma.serviceSession.create({
        data: {
          queueEntryId: entry.id,
          staffId: staff.id,
          chairId: c1.id,
          serviceId: svc.id,
          status: 'ACTIVE',
        },
      });
      await prisma.manualChairOccupancy.create({
        data: {
          salonId: ids.salon,
          chairId: c2.id,
          startedByUserId: ids.salonOwner,
        },
      });
      // A finished occupancy must not count.
      await prisma.manualChairOccupancy.create({
        data: {
          salonId: ids.salon,
          chairId: c2.id,
          startedByUserId: ids.salonOwner,
          endedAt: new Date(),
        },
      });
      await user('customer', Role.CUSTOMER);
      await seedApp.close();

      // Production rollout shape: only the shop owner is in the cohort, writes OFF.
      process.env.ASSISTANT_MODE = 'cohort';
      process.env.ASSISTANT_WRITES = 'off';
      process.env.ASSISTANT_COHORT_USER_IDS = ids.salonOwner;
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
    });

    afterAll(async () => {
      await app?.close();
      for (const [k, v] of [
        ['ASSISTANT_MODE', saved.mode],
        ['ASSISTANT_WRITES', saved.writes],
        ['ASSISTANT_COHORT_USER_IDS', saved.cohort],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it.each([
      'What can you do?',
      'व्हाट कैन यू डू',
      'हाउ कैन यू हेल्प मी',
      'Tum kya kar sakte ho?',
      'नमस्ते',
    ])(
      'help (%s): a real, scoped answer; writes are said to be off; only reads offered',
      async (text) => {
        const { code, body } = await say('salonOwner', text);
        expect(code).toBe(200);
        expect(body.status).toBe('DONE');
        expect(body.action?.id).toBe('app.help');
        expect(body.message).toMatch(/chairs/);
        expect(body.message).toMatch(/switched off/);
        expect(body.options?.map((o) => o.text)).not.toContain(
          'Haircut ₹200 se ₹150 karo',
        );
      },
    );

    it.each([
      'चेक करो कितनी चेयर्स अवेलेबल हैं',
      'kitni chairs free hain',
      'chair availability check karo',
    ])(
      'chair availability (%s) is live: busy in service, busy marked, free, off',
      async (text) => {
        const { body } = await say('salonOwner', text);
        expect(body.status).toBe('DONE');
        expect(body.action?.id).toBe('chairs.list');
        expect(body.message).toBe(
          '1 of 3 working chairs are free right now, 2 busy. 1 chair is switched off or under repair.',
        );
        expect(
          body.result?.items?.map((i) => `${i.title}: ${i.detail}`).sort(),
        ).toEqual([
          'Chair 1: Busy: service in progress',
          'Chair 2: Busy: marked occupied',
          'Chair 3: Free now',
          'Chair 4: Under repair',
        ]);
      },
    );

    it('navigation: a route of THIS shop only, built by the server', async () => {
      const { body } = await say('salonOwner', 'Bookings kholo');
      expect(body).toMatchObject({
        status: 'DONE',
        message: 'Opening Bookings.',
        navigateTo: `/dashboard/salons/${ids.salon}/bookings`,
      });
      expect(
        (await say('salonOwner', 'Services page kholo')).body.navigateTo,
      ).toBe(`/dashboard/salons/${ids.salon}/services`);
      expect(
        (await say('salonOwner', 'dashboard pe jao')).body.navigateTo,
      ).toBe(`/dashboard/salons/${ids.salon}`);
      expect((await say('salonOwner', 'wo page kholo')).body.status).toBe(
        'NEEDS_INPUT',
      );
      expect((await say('salonOwner', 'wapas jao')).body.action?.id).toBe(
        'app.navigateBack',
      );
    });

    it('navigation to another shop is denied and gives no route', async () => {
      const { body } = await say(
        'salonOwner',
        'Bookings kholo',
        ids.otherSalon,
      );
      expect(body.status).toBe('DENIED');
      expect(body.navigateTo).toBeUndefined();
    });

    it('not understood: names what it heard, topic suggestions, never the same generic list', async () => {
      const a = (await say('salonOwner', 'mausam kaisa hai aaj')).body;
      expect(a.status).toBe('UNSUPPORTED');
      expect(a.message).toContain('I heard "mausam kaisa hai aaj"');
      expect(a.options?.[0]?.text).toBe('What can you do?');
      const b = (await say('salonOwner', 'blah blah')).body;
      expect(b.status).toBe('UNSUPPORTED');
      expect(b.options?.[0]?.text).toBe('What can you do?');
      expect(b.options).not.toEqual(a.options);
    });

    it('writes stay OFF: price change and cancellation are refused and change nothing', async () => {
      const before = await prisma.service.findFirstOrThrow({
        where: { salonId: ids.salon },
      });
      for (const text of [
        'Haircut ka price 150 karo',
        'booking cancel karo',
        'chair 3 band karo',
      ]) {
        const { body } = await say('salonOwner', text);
        expect(body.status).toBe('UNAVAILABLE');
        expect(body.confirmation).toBeUndefined();
      }
      expect(
        (
          await prisma.service.findFirstOrThrow({ where: { id: before.id } })
        ).price.toString(),
      ).toBe(before.price.toString());
    });

    it('cohort: the other owner, the barber and a customer get 404 for help and navigation', async () => {
      for (const who of ['otherSalonOwner', 'barber', 'customer']) {
        expect((await say(who, 'What can you do?', ids.otherSalon)).code).toBe(
          404,
        );
        expect((await say(who, 'Bookings kholo', ids.otherSalon)).code).toBe(
          404,
        );
      }
    });

    it('a help answer records no transcript in the audit log', async () => {
      await say('salonOwner', 'How can you help me?');
      const rows = await prisma.auditLog.findMany({
        where: { actorUserId: ids.salonOwner, action: 'ASSISTANT_ACTION' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain('How can you help me');
    });
  },
);
