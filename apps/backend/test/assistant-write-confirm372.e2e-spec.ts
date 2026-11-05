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
 * Issue #372 on a DISPOSABLE local database: mandatory confirmation for every Assistant write, in the
 * shape of the future QA-salon canary (one owner, ONE allowlisted shop, a few allowlisted actions).
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
  'Assistant #372: every write needs an explicit on-screen confirmation (e2e)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const KEYS = [
      'ASSISTANT_MODE',
      'ASSISTANT_WRITES',
      'ASSISTANT_COHORT_USER_IDS',
      'ASSISTANT_WRITE_SALON_IDS',
      'ASSISTANT_WRITE_ACTIONS',
    ] as const;
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

    const say = (who: string, text: string, salonId = ids.qa) =>
      request(app.getHttpServer())
        .post('/api/v1/assistant/turns')
        .set('Authorization', `Bearer ${tok[who]}`)
        .send({ text, surface: 'shop', inputMode: 'voice', salonId })
        .expect(200)
        .then((r) => r.body as AssistantTurnDto);
    const decide = (
      who: string,
      token: string,
      decision: 'confirm' | 'cancel',
      acknowledged?: boolean,
    ) =>
      request(app.getHttpServer())
        .post('/api/v1/assistant/confirmations')
        .set('Authorization', `Bearer ${tok[who]}`)
        .send({
          token,
          decision,
          ...(acknowledged === undefined ? {} : { acknowledged }),
        })
        .expect(200)
        .then((r) => r.body as AssistantTurnDto);
    const chair = (label: string) =>
      prisma.chair.findFirstOrThrow({ where: { salonId: ids.qa, label } });

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
          name: `Asst372 ${run}`,
          slug: `asst372-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      });
      const mk = async (who: string, role: Role) => {
        const u = await prisma.user.create({
          data: {
            email: `asst372-${run}-${who}@example.test`,
            emailVerifiedAt: new Date(),
            status: UserStatus.ACTIVE,
          },
        });
        tok[who] = tokens.signAccessToken(u.id, [role], SessionAudience.STAFF);
        ids[who] = u.id;
        return u;
      };
      const owner = await mk('owner', Role.SALON_OWNER);
      const intruder = await mk('intruder', Role.SALON_OWNER);
      for (const [key, ownerId] of [
        ['qa', owner.id],
        ['second', owner.id],
        ['foreign', intruder.id],
      ] as const) {
        const s = await prisma.salon.create({
          data: {
            ownerUserId: ownerId,
            name: `Asst372 ${key} ${run}`,
            slug: `asst372-${key}-${run}`,
            cityId: city.id,
            addressLine: 'Synthetic',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            status: SalonStatus.ACTIVE,
          },
        });
        await prisma.userRole.create({
          data: { userId: ownerId, role: Role.SALON_OWNER, salonId: s.id },
        });
        ids[key] = s.id;
      }
      for (const salonId of [ids.qa, ids.second]) {
        for (const label of ['Chair 1', 'Chair 2'])
          await prisma.chair.create({ data: { salonId, label } });
        await prisma.service.create({
          data: { salonId, name: 'Haircut', durationMinutes: 30, price: 100 },
        });
      }
      for (const name of ['Ramesh', 'Suresh']) {
        const u = await prisma.user.create({
          data: {
            email: `asst372-${run}-${name}@example.test`,
            status: UserStatus.ACTIVE,
          },
        });
        await prisma.salonStaff.create({
          data: {
            salonId: ids.qa,
            userId: u.id,
            displayName: name,
            roleInSalon: 'BARBER',
            status: 'ACTIVE',
          },
        });
      }
      await seed.close();

      // The future canary shape: one owner, ONE shop, three named actions.
      Object.assign(process.env, {
        ASSISTANT_MODE: 'cohort',
        ASSISTANT_WRITES: 'cohort',
        ASSISTANT_COHORT_USER_IDS: `${ids.owner},${ids.intruder}`,
        ASSISTANT_WRITE_SALON_IDS: ids.qa,
        ASSISTANT_WRITE_ACTIONS:
          'chairs.setStatus,services.setPrice,staff.setStatus',
      });
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
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('"Chair 2 hatao": asks "Kya aap sach mein ...?", shows Before → After, high risk, changes nothing yet', async () => {
      const t = await say('owner', 'Chair 2 band karo');
      expect(t.status).toBe('NEEDS_CONFIRMATION');
      expect(t.message).toMatch(
        /^Kya aap sach mein Chair 2 ko hatana \(.+\) chahte hain\?/,
      );
      expect(t.message).toMatch(/Abhi kuch bhi change nahi hua hai/);
      expect(t.preview?.risk).toBe('high');
      expect(t.preview?.warning).toMatch(/not a permanent delete/);
      expect(t.preview?.rows[0]).toMatchObject({
        label: expect.stringContaining('Chair 2'),
      });
      expect((await chair('Chair 2')).status).toBe('ACTIVE');
    });

    it('high risk: Confirm without "I understand" is refused and the SAME preview can then be confirmed once', async () => {
      const t = await say('owner', 'Chair 2 band karo');
      const noAck = await decide('owner', t.confirmation!.token, 'confirm');
      expect(noAck.status).toBe('NEEDS_CONFIRMATION');
      expect(noAck.message).toMatch(/samajhta\/samajhti/);
      expect((await chair('Chair 2')).status).toBe('ACTIVE');
      const done = await decide(
        'owner',
        t.confirmation!.token,
        'confirm',
        true,
      );
      expect(done.status).toBe('DONE');
      expect((await chair('Chair 2')).status).toBe('INACTIVE');
      const replay = await decide(
        'owner',
        t.confirmation!.token,
        'confirm',
        true,
      );
      expect(replay.status).toBe('FAILED');
      await prisma.chair.update({
        where: { id: (await chair('Chair 2')).id },
        data: { status: 'ACTIVE' },
      });
    });

    it('Cancel: "Cancelled, kuch bhi change nahi hua"', async () => {
      const t = await say('owner', 'Chair 1 band karo');
      const c = await decide('owner', t.confirmation!.token, 'cancel');
      expect(c).toMatchObject({
        status: 'CANCELLED',
        message: 'Cancelled, kuch bhi change nahi hua. (Nothing was changed.)',
      });
      expect((await chair('Chair 1')).status).toBe('ACTIVE');
    });

    it('price: "Kya aap Haircut ki price ₹100 se ₹150 karna chahte hain?"', async () => {
      const t = await say('owner', 'Haircut ka price 150 karo');
      expect(t.status).toBe('NEEDS_CONFIRMATION');
      expect(t.message).toMatch(
        /^Kya aap Haircut ki price ₹100(\.00)? se ₹150(\.00)? karna chahte hain\?/,
      );
      expect(t.preview?.risk).toBe('high');
      expect(
        (
          await prisma.service.findFirstOrThrow({ where: { salonId: ids.qa } })
        ).price.toString(),
      ).toMatch(/^100/);
    });

    it('staff: an unclear "staff hatao" asks which one and creates NO confirmation token', async () => {
      const t = await say('owner', 'staff hatao');
      expect(t.status).not.toBe('NEEDS_CONFIRMATION');
      expect(t.confirmation).toBeUndefined();
      const named = await say('owner', 'Ramesh ko inactive karo');
      if (named.status === 'NEEDS_CONFIRMATION')
        expect(named.message).toMatch(/Ramesh/);
      else expect(named.confirmation).toBeUndefined();
    });

    it('an unclear chair ("chair band karo" with two chairs) never gets a token', async () => {
      const t = await say('owner', 'chair band karo');
      expect(t.confirmation).toBeUndefined();
    });

    it('"haan" / "yes" / "ok" is never a confirmation', async () => {
      for (const word of ['haan', 'yes', 'ok', 'हाँ', 'confirm']) {
        const t = await say('owner', word);
        expect(t.status).toBe('UNSUPPORTED');
        expect(t.message).toMatch(/Confirm button/);
        expect(t.confirmation).toBeUndefined();
      }
    });

    it("the owner's OTHER shop is not allowlisted: editing is disabled, nothing changes", async () => {
      const t = await say('owner', 'Chair 2 band karo', ids.second);
      expect(t).toMatchObject({
        status: 'UNAVAILABLE',
        message: expect.stringMatching(
          /Editing is disabled for this testing account; nothing was changed/,
        ),
      });
      expect(t.confirmation).toBeUndefined();
      expect(t.options?.[0]?.text).toBe('Chairs page kholo');
    });

    it('an action that is not allowlisted (hours) is disabled, with no token', async () => {
      const t = await say('owner', 'Sunday band rakho');
      expect(t.status).toBe('UNAVAILABLE');
      expect(t.confirmation).toBeUndefined();
    });

    it("another owner cannot preview a change in the QA shop, nor redeem the owner's token", async () => {
      expect((await say('intruder', 'Chair 2 band karo')).status).toBe(
        'DENIED',
      );
      const t = await say('owner', 'Chair 2 band karo');
      const stolen = await decide(
        'intruder',
        t.confirmation!.token,
        'confirm',
        true,
      );
      expect(stolen.status).toBe('FAILED');
      expect((await chair('Chair 2')).status).toBe('ACTIVE');
    });

    it('a stale preview (the record changed after it was shown) is refused', async () => {
      const t = await say('owner', 'Chair 1 band karo');
      const c1 = await chair('Chair 1');
      await prisma.chair.update({
        where: { id: c1.id },
        data: { label: 'Chair 1A' },
      });
      const r = await decide('owner', t.confirmation!.token, 'confirm', true);
      expect(r.status).not.toBe('DONE');
      expect(
        (await prisma.chair.findUniqueOrThrow({ where: { id: c1.id } })).status,
      ).toBe('ACTIVE');
      await prisma.chair.update({
        where: { id: c1.id },
        data: { label: 'Chair 1' },
      });
    });

    it('a forged or malformed token changes nothing', async () => {
      for (const token of [
        'x'.repeat(40),
        'eyJhIjoxfQ.forged-signature-value-000000',
      ]) {
        const r = await decide('owner', token, 'confirm', true);
        expect(r.status).toBe('FAILED');
      }
    });

    it('a read-only command never enters the write flow', async () => {
      for (const text of [
        'chairs dikhao',
        'kitni chairs free hain',
        'Chairs page kholo',
      ]) {
        const t = await say('owner', text);
        expect(t.confirmation).toBeUndefined();
        expect(t.preview).toBeUndefined();
      }
    });
  },
);
