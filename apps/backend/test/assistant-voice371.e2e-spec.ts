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
 * Issue #371 on a DISPOSABLE local database, production rollout shape (owner-only cohort, writes
 * OFF): speech alternatives are used only for reads/navigation, a misheard change is never run,
 * and the dry-run interpretation endpoint is gated like every other assistant route.
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
  'Assistant voice #371: speech alternatives and dry-run interpretation (e2e)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const saved = {
      mode: process.env.ASSISTANT_MODE,
      writes: process.env.ASSISTANT_WRITES,
      cohort: process.env.ASSISTANT_COHORT_USER_IDS,
    };

    const turn = (who: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/assistant/turns')
        .set('Authorization', `Bearer ${tok[who]}`)
        .send({
          surface: 'shop',
          inputMode: 'voice',
          salonId: ids.salon,
          ...body,
        })
        .then((r) => ({ code: r.status, body: r.body as AssistantTurnDto }));
    const interpret = (who: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/assistant/interpretations')
        .set('Authorization', `Bearer ${tok[who]}`)
        .send({ surface: 'shop', ...body });

    beforeAll(async () => {
      const seedMod: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const seed = seedMod.createNestApplication();
      await seed.init();
      prisma = seed.get(PrismaService);
      const tokens = seed.get(TokenService);
      const city = await prisma.city.create({
        data: {
          name: `Asst371 ${run}`,
          slug: `asst371-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      });
      for (const who of ['owner', 'other']) {
        const u = await prisma.user.create({
          data: {
            email: `asst371-${run}-${who}@example.test`,
            emailVerifiedAt: new Date(),
            status: UserStatus.ACTIVE,
          },
        });
        const salon = await prisma.salon.create({
          data: {
            ownerUserId: u.id,
            name: `Asst371 ${who} ${run}`,
            slug: `asst371-${who}-${run}`,
            cityId: city.id,
            addressLine: 'Synthetic',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            status: SalonStatus.ACTIVE,
          },
        });
        await prisma.userRole.create({
          data: { userId: u.id, role: Role.SALON_OWNER, salonId: salon.id },
        });
        tok[who] = tokens.signAccessToken(
          u.id,
          [Role.SALON_OWNER],
          SessionAudience.STAFF,
        );
        ids[who] = u.id;
        ids[who === 'owner' ? 'salon' : 'otherSalon'] = salon.id;
      }
      ids.chair = (
        await prisma.chair.create({
          data: { salonId: ids.salon, label: 'Chair 2' },
        })
      ).id;
      await prisma.service.create({
        data: {
          salonId: ids.salon,
          name: 'Haircut',
          durationMinutes: 30,
          price: 200,
        },
      });
      await seed.close();

      process.env.ASSISTANT_MODE = 'cohort';
      process.env.ASSISTANT_WRITES = 'off';
      process.env.ASSISTANT_COHORT_USER_IDS = ids.owner;
      const mod: TestingModule = await Test.createTestingModule({
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
      app = mod.createNestApplication();
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

    it('top transcript wrong, alternative right: the read runs and the reply says what was understood', async () => {
      const { body } = await turn('owner', {
        text: 'book in school',
        alternatives: ['bookings kholo'],
        confidence: 0.4,
      });
      expect(body).toMatchObject({
        status: 'DONE',
        understoodAs: 'bookings kholo',
        navigateTo: `/dashboard/salons/${ids.salon}/bookings`,
      });
    });

    it('a correct top transcript is used as is (no "understood as")', async () => {
      const { body } = await turn('owner', {
        text: 'kitni chairs free hain',
        alternatives: ['kitni chair free hai'],
      });
      expect(body.action?.id).toBe('chairs.list');
      expect(body.understoodAs).toBeUndefined();
    });

    it('a misheard CHANGE in an alternative is never run: offered as a tap-to-choose suggestion, nothing changes', async () => {
      const before = await prisma.chair.findUniqueOrThrow({
        where: { id: ids.chair },
      });
      const { body } = await turn('owner', {
        text: 'to hot a do bhai',
        alternatives: ['chair 2 band karo'],
      });
      expect(body.status).toBe('UNSUPPORTED');
      expect(body.confirmation).toBeUndefined();
      expect(body.options?.[0]).toEqual({
        label: 'Did you mean: chair 2 band karo',
        text: 'chair 2 band karo',
      });
      expect(
        (await prisma.chair.findUniqueOrThrow({ where: { id: ids.chair } }))
          .status,
      ).toBe(before.status);
    });

    it('a change heard as the TOP transcript is still refused while writes are off', async () => {
      const { body } = await turn('owner', {
        text: 'Haircut ka price 150 karo',
        alternatives: ['haircut ka price 115 karo'],
      });
      expect(body.status).toBe('UNAVAILABLE');
      expect(body.confirmation).toBeUndefined();
    });

    it('an alternative cannot reach another shop', async () => {
      const { body } = await turn('owner', {
        text: 'book in school',
        alternatives: ['bookings kholo'],
        salonId: ids.otherSalon,
      });
      expect(body.status).toBe('DENIED');
      expect(body.navigateTo).toBeUndefined();
    });

    it('too many alternatives are rejected by validation', async () => {
      const { code } = await turn('owner', {
        text: 'x',
        alternatives: ['a', 'b', 'c', 'd', 'e'],
      });
      expect(code).toBe(400);
    });

    it('dry-run interpretation: maps, reports the alternative, runs nothing', async () => {
      const r = await interpret('owner', {
        text: 'how can you yelp me',
        alternatives: ['how can you help me'],
      }).expect(200);
      expect(r.body).toEqual({
        action: 'app.help',
        kind: 'READ',
        usedText: 'how can you help me',
        usedAlternative: true,
        topAction: null,
      });
      const w = await interpret('owner', { text: 'chair 2 band karo' }).expect(
        200,
      );
      expect(w.body).toMatchObject({
        action: 'chairs.setStatus',
        kind: 'WRITE',
      });
      expect(
        (await prisma.chair.findUniqueOrThrow({ where: { id: ids.chair } }))
          .status,
      ).toBe('ACTIVE');
    });

    it('dry-run interpretation is gated like every assistant route (outside the cohort: 404)', async () => {
      await interpret('other', { text: 'staff dikhao' }).expect(404);
      await request(app.getHttpServer())
        .post('/api/v1/assistant/interpretations')
        .send({ text: 'staff dikhao' })
        .expect(401);
    });
  },
);
