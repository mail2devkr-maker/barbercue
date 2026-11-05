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
 * Assistant release gate (issue #362) on a DISPOSABLE local database. The assistant must be OFF for
 * everyone unless ASSISTANT_MODE says otherwise, only the allowlisted cohort may use it in cohort
 * mode, and writes stay refused (preview AND confirmation) unless ASSISTANT_WRITES allows them.
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

maybe('Assistant release gate (e2e, disposable local database)', () => {
  const run = randomUUID().slice(0, 8);
  const apps: INestApplication<App>[] = [];
  const saved = Object.fromEntries(GATE.map((k) => [k, process.env[k]]));
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let prisma: PrismaService;

  async function boot(env: Partial<Record<(typeof GATE)[number], string>>) {
    for (const k of GATE) delete process.env[k];
    Object.assign(process.env, env);
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
    const app = mod.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    apps.push(app);
    return app;
  }
  const http = (app: INestApplication<App>, who: string) => {
    const agent = request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${tok[who]}` };
    return {
      access: () => agent.get('/api/v1/assistant/access').set(auth),
      caps: () => agent.get('/api/v1/assistant/capabilities').set(auth),
      turn: (text: string) =>
        agent
          .post('/api/v1/assistant/turns')
          .set(auth)
          .send({ text, surface: 'shop', salonId: ids[`${who}Salon`] }),
      confirm: (token: string) =>
        agent
          .post('/api/v1/assistant/confirmations')
          .set(auth)
          .send({ token, decision: 'confirm', acknowledged: true }),
      voice: () =>
        agent
          .post('/api/v1/assistant/transcriptions')
          .set(auth)
          .attach('audio', Buffer.from('x'), {
            filename: 'a.webm',
            contentType: 'audio/webm',
          }),
    };
  };
  const autoAssign = async (who: string) =>
    (
      await prisma.salon.findUniqueOrThrow({
        where: { id: ids[`${who}Salon`] },
      })
    ).queueAutoAssignEnabled;

  beforeAll(async () => {
    const seed = await boot({});
    prisma = seed.get(PrismaService);
    const tokens = seed.get(TokenService);
    const city = await prisma.city.create({
      data: {
        name: `AsstGate ${run}`,
        slug: `asstgate-${run}`,
        state: 'Synthetic',
        country: 'India',
        countryCode: 'IN',
      },
    });
    for (const who of ['cohort', 'outsider']) {
      const u = await prisma.user.create({
        data: {
          email: `asstgate-${run}-${who}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: u.id,
          name: `AsstGate ${who} ${run}`,
          slug: `asstgate-${who}-${run}`,
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
      ids[`${who}Salon`] = salon.id;
    }
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    for (const k of GATE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('default (nothing set): hidden from everyone, every route 404, nothing changes', async () => {
    const app = await boot({});
    const c = http(app, 'cohort');
    expect((await c.access().expect(200)).body).toEqual({
      enabled: false,
      writes: false,
    });
    await c.caps().expect(404);
    await c.turn('auto assign on hai kya').expect(404);
    await c.turn('auto assign band karo').expect(404);
    await c.confirm('x'.repeat(40)).expect(404);
    await c.voice().expect(404);
    expect(await autoAssign('cohort')).toBe(true);
    await http(app, 'cohort').access().set('Authorization', '').expect(401);
  });

  it('a misspelt value stays off', async () => {
    const app = await boot({ ASSISTANT_MODE: 'ON', ASSISTANT_WRITES: 'all' });
    expect((await http(app, 'cohort').access().expect(200)).body).toEqual({
      enabled: false,
      writes: false,
    });
    await http(app, 'cohort').turn('auto assign band karo').expect(404);
  });

  it('cohort, reads only: the cohort can read, an outsider gets 404, writes are refused', async () => {
    const app = await boot({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ids.cohort,
    });
    const c = http(app, 'cohort');
    expect((await c.access().expect(200)).body).toEqual({
      enabled: true,
      writes: false,
    });
    const read = (await c.turn('auto assign on hai kya').expect(200)).body;
    expect(read.status).toBe('DONE');
    const write = (await c.turn('auto assign band karo').expect(200)).body;
    expect(write.status).toBe('UNAVAILABLE');
    expect(write.confirmation).toBeUndefined();
    const caps = (await c.caps().expect(200)).body as {
      actions: Array<{ id: string; state: string }>;
    };
    expect(
      caps.actions.find((a) => a.id === 'queue.autoAssignSet')?.state,
    ).toBe('UNAVAILABLE');
    expect(
      caps.actions.find((a) => a.id === 'queue.autoAssignView')?.state,
    ).toBe('SUPPORTED');
    const o = http(app, 'outsider');
    expect((await o.access().expect(200)).body).toEqual({
      enabled: false,
      writes: false,
    });
    await o.turn('auto assign on hai kya').expect(404);
    expect(await autoAssign('cohort')).toBe(true);
  });

  it('a preview made while writes were on cannot be confirmed after writes are switched off', async () => {
    const on = await boot({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_WRITES: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ids.cohort,
      ASSISTANT_WRITE_SALON_IDS: ids.cohortSalon,
      ASSISTANT_WRITE_ACTIONS: 'queue.autoAssignSet',
    });
    const preview = (
      await http(on, 'cohort').turn('auto assign band karo').expect(200)
    ).body;
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    const off = await boot({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ids.cohort,
    });
    const refused = (
      await http(off, 'cohort').confirm(preview.confirmation.token).expect(200)
    ).body;
    expect(refused.status).toBe('UNAVAILABLE');
    expect(await autoAssign('cohort')).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: ids.cohortSalon,
          action: 'QUEUE_AUTO_ASSIGN_DISABLED',
        },
      }),
    ).toBe(0);
    // With writes on for the cohort, the same flow works, and only for the cohort.
    const done = (
      await http(on, 'cohort').confirm(preview.confirmation.token).expect(200)
    ).body;
    expect(done.status).toBe('DONE');
    expect(await autoAssign('cohort')).toBe(false);
    await http(on, 'outsider').turn('auto assign band karo').expect(404);
    expect(await autoAssign('outsider')).toBe(true);
  });

  it('#372: ASSISTANT_WRITES alone opens nothing; the shop AND the action must be allowlisted', async () => {
    const base = {
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_WRITES: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ids.cohort,
    };
    await prisma.salon.update({ where: { id: ids.cohortSalon }, data: { queueAutoAssignEnabled: true } });
    for (const env of [
      base, // no allowlists: default deny
      {
        ...base,
        ASSISTANT_WRITE_SALON_IDS: ids.outsiderSalon,
        ASSISTANT_WRITE_ACTIONS: 'queue.autoAssignSet',
      }, // another shop
      {
        ...base,
        ASSISTANT_WRITE_SALON_IDS: ids.cohortSalon,
        ASSISTANT_WRITE_ACTIONS: 'chairs.setStatus',
      }, // another action
      {
        ...base,
        ASSISTANT_WRITE_SALON_IDS: 'not-a-uuid',
        ASSISTANT_WRITE_ACTIONS: 'queue.autoAssignSet',
      }, // malformed
    ]) {
      const app = await boot(env);
      const t = (
        await http(app, 'cohort').turn('auto assign band karo').expect(200)
      ).body;
      expect(t.status).toBe('UNAVAILABLE');
      expect(t.message).toMatch(
        /Editing is disabled for this testing account; nothing was changed/,
      );
      expect(t.confirmation).toBeUndefined();
    }
    expect(await autoAssign('cohort')).toBe(true);
  });

  it('#372: a preview made while allowlisted cannot be confirmed after the allowlist is removed', async () => {
    const env = {
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_WRITES: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ids.cohort,
    };
    const on = await boot({
      ...env,
      ASSISTANT_WRITE_SALON_IDS: ids.cohortSalon,
      ASSISTANT_WRITE_ACTIONS: 'queue.autoAssignSet',
    });
    await prisma.salon.update({
      where: { id: ids.cohortSalon },
      data: { queueAutoAssignEnabled: true },
    });
    const preview = (
      await http(on, 'cohort').turn('auto assign band karo').expect(200)
    ).body;
    expect(preview.status).toBe('NEEDS_CONFIRMATION');
    const off = await boot(env);
    const refused = (
      await http(off, 'cohort').confirm(preview.confirmation.token).expect(200)
    ).body;
    expect(refused.status).toBe('UNAVAILABLE');
    expect(await autoAssign('cohort')).toBe(true);
  });
});
