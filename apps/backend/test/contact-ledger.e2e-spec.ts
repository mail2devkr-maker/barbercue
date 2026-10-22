import { createHmac, randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SessionAudience,
  UserStatus,
  normalizeContactPhone,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

/**
 * Contact consent ledger (requirement 13): the REAL AppModule on a disposable local PostgreSQL, synthetic numbers only.
 * Proves: fail-closed default, owner-only and per-shop isolation, no plaintext number in storage or responses,
 * idempotent + race-safe recording, withdrawal/suppression/erasure rules, retention and purge, and that nothing is sent.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

type Json = Record<string, any>;
const HASH_KEY = `ledger-${randomUUID()}${randomUUID()}`;
const ENV_KEYS = [
  'CONTACT_LEDGER_ENABLED',
  'CONTACT_LEDGER_HASH_KEY',
  'CONTACT_CONSENT_RETENTION_DAYS',
] as const;

maybe('Contact consent ledger (e2e, disposable local database)', () => {
  const run = randomUUID().slice(0, 8);
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let counter = 0;

  /** A unique synthetic Indian mobile number per call. */
  const phone = () =>
    `9${String(parseInt(run, 16) % 100_000).padStart(5, '0')}${String(1000 + ++counter).slice(-4)}`;
  const e164 = (raw: string) => normalizeContactPhone(raw) as string;
  const hashOf = (raw: string) =>
    createHmac('sha256', HASH_KEY).update(e164(raw)).digest('hex');
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();
  const consent = (over: Json = {}) => ({
    granted: true,
    source: 'WRITTEN',
    capturedAt: hoursAgo(48),
    ...over,
  });
  const contact = (raw: string, over: Json = {}) => ({
    phone: raw,
    consent: consent(over),
  });

  const call = (
    method: 'get' | 'post',
    path: string,
    token?: string,
    body?: unknown,
  ) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body as object);
  };
  const base = (salon: string) =>
    `dashboard/salons/${ids[`salon${salon}`]}/contacts`;
  const record = (
    salon: string,
    owner: string,
    contacts: Json[],
    status = 201,
  ) =>
    call('post', `${base(salon)}/consents`, tok[owner], { contacts }).expect(
      status,
    );

  /** The write routes are rate limited per minute; tests that fire many requests use a storage that never blocks. */
  async function boot(
    env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
    realThrottle = false,
  ) {
    await app?.close();
    for (const key of ENV_KEYS) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    const builder = Test.createTestingModule({ imports: [AppModule] });
    if (!realThrottle) {
      builder.overrideProvider(ThrottlerStorage).useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      });
    }
    const module = await builder.compile();
    app = module.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  }

  async function makeOwner(label: string) {
    const user = await prisma.user.create({
      data: {
        email: `led-${run}-${label}@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const city = await prisma.city.findFirstOrThrow({ select: { id: true } });
    const salon = await prisma.salon.create({
      data: {
        ownerUserId: user.id,
        name: `Ledger Shop ${label} ${run}`,
        slug: `led-${label}-${run}`,
        cityId: city.id,
        addressLine: 'Synthetic test address',
        status: 'ACTIVE',
        currency: 'INR',
      },
    });
    await prisma.userRole.create({
      data: { userId: user.id, role: Role.SALON_OWNER, salonId: salon.id },
    });
    ids[`salon${label}`] = salon.id;
    ids[`owner${label}`] = user.id;
    tok[`owner${label}`] = tokens.signAccessToken(
      user.id,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
  }

  const rowFor = (salonLabel: string, raw: string) =>
    prisma.contactConsentRecord.findFirst({
      where: { salonId: ids[`salon${salonLabel}`], phoneHash: hashOf(raw) },
    });

  beforeAll(async () => {
    await boot({}); // closed by default
    await makeOwner('A');
    await makeOwner('B');
    const customer = await prisma.user.create({
      data: {
        email: `led-${run}-cust@example.test`,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: customer.id, role: Role.CUSTOMER, salonId: null },
    });
    tok.customer = tokens.signAccessToken(
      customer.id,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
    const admin = await prisma.user.create({
      data: {
        email: `led-${run}-admin@example.test`,
        status: UserStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: admin.id, role: Role.PLATFORM_ADMIN, salonId: null },
    });
    ids.admin = admin.id;
    tok.admin = tokens.signAccessToken(
      admin.id,
      [Role.PLATFORM_ADMIN],
      SessionAudience.ADMIN,
    );
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  // -------------------------------------------------------------------------------------------------------------
  describe('fail-closed default', () => {
    it('refuses every route and keeps the capability at preview-only unless BOTH the flag and a long-enough key are set', async () => {
      const probe = async () => {
        const res = await call(
          'post',
          `${base('A')}/consents`,
          tok.ownerA,
          { contacts: [contact(phone())] },
        );
        const caps = await call(
          'get',
          `dashboard/salons/${ids.salonA}/capabilities`,
          tok.ownerA,
        );
        return { res, caps };
      };
      for (const env of [
        {},
        { CONTACT_LEDGER_ENABLED: 'true' },
        { CONTACT_LEDGER_HASH_KEY: HASH_KEY },
        { CONTACT_LEDGER_ENABLED: 'true', CONTACT_LEDGER_HASH_KEY: 'short' },
        { CONTACT_LEDGER_ENABLED: 'yes', CONTACT_LEDGER_HASH_KEY: HASH_KEY },
      ]) {
        await boot(env);
        const { res, caps } = await probe();
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('CONTACT_LEDGER_NOT_CONFIGURED');
        expect(caps.body.features.contactImport).toMatchObject({
          status: 'UNCONFIGURED',
          reasonCode: 'CONTACT_IMPORT_PREVIEW_ONLY',
        });
      }
      expect((await call('post', 'admin/contact-ledger/purge-expired', tok.admin)).status).toBe(503);
      expect(
        await prisma.contactConsentRecord.count({
          where: { salonId: { in: [ids.salonA, ids.salonB] } },
        }),
      ).toBe(0);
    });

    it('the existing preview endpoint is unaffected whether or not the ledger is on', async () => {
      await boot({});
      const res = await call('post', `${base('A')}/preview`, tok.ownerA, {
        contacts: [contact(phone())],
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        previewOnly: true,
        dispatchEnabled: false,
      });
    });
  });

  // -------------------------------------------------------------------------------------------------------------
  describe('configured', () => {
    beforeAll(async () => {
      await boot({
        CONTACT_LEDGER_ENABLED: 'true',
        CONTACT_LEDGER_HASH_KEY: HASH_KEY,
      });
    }, 120_000);

    it('advertises the ledger as SANDBOX with no dispatch', async () => {
      const caps = await call(
        'get',
        `dashboard/salons/${ids.salonA}/capabilities`,
        tok.ownerA,
      );
      expect(caps.body.features.contactImport).toMatchObject({
        status: 'SANDBOX',
        reasonCode: 'CONSENT_LEDGER_NO_DISPATCH',
      });
    });

    it('is owner-only and isolated per shop', async () => {
      const body = { contacts: [contact(phone())] };
      expect((await call('post', `${base('A')}/consents`, undefined, body)).status).toBe(401);
      expect((await call('post', `${base('A')}/consents`, tok.customer, body)).status).toBe(403);
      // Owner B cannot read or write shop A's ledger.
      expect((await call('post', `${base('A')}/consents`, tok.ownerB, body)).status).toBe(403);
      expect((await call('get', `${base('A')}/consents/summary`, tok.ownerB)).status).toBe(403);
      expect((await call('post', `${base('A')}/consents/withdraw`, tok.ownerB, { phone: phone() })).status).toBe(403);
      expect((await call('post', `${base('A')}/consents/erase`, tok.ownerB, { phone: phone() })).status).toBe(403);
      // The platform housekeeping route is for platform admins only.
      expect((await call('post', 'admin/contact-ledger/purge-expired', tok.ownerA)).status).toBe(403);
      expect(await prisma.contactConsentRecord.count({ where: { salonId: ids.salonA } })).toBe(0);
    });

    it('records evidence per line, stores only a keyed hash, and never returns or logs a number', async () => {
      const good = phone();
      const dup = phone();
      const list = [
        contact(good),
        contact('12345'), // invalid number
        { phone: phone() }, // no consent statement
        contact(phone(), { source: undefined }), // evidence incomplete
        contact(phone(), { capturedAt: new Date(Date.now() + 86_400_000).toISOString() }), // future date
        contact(dup),
        contact(dup), // repeat inside the batch
      ];
      const res = await record('A', 'ownerA', list);
      expect(res.body).toMatchObject({
        dispatchEnabled: false,
        dispatchBlockedReason: 'PROVIDER_AND_APPROVAL_GATES_REQUIRED',
        retentionDays: 365,
      });
      expect(res.body.items.map((i: Json) => i.outcome)).toEqual([
        'RECORDED',
        'INVALID_PHONE',
        'CONSENT_REQUIRED',
        'CONSENT_EVIDENCE_INCOMPLETE',
        'CONSENT_TIMESTAMP_INVALID',
        'RECORDED',
        'DUPLICATE_IN_BATCH',
      ]);
      expect(res.body.summary).toEqual({
        total: 7,
        recorded: 2,
        alreadyRecorded: 0,
        suppressed: 0,
        withdrawnByContact: 0,
        rejected: 5,
      });

      // The response carries no phone number or hash, in any form.
      const text = JSON.stringify(res.body);
      for (const raw of [good, dup, e164(good), hashOf(good)]) expect(text).not.toContain(raw);

      // Storage: keyed hash only; nothing in the table (or its audit rows) contains the number.
      const row = await rowFor('A', good);
      expect(row).toMatchObject({
        status: 'ACTIVE',
        source: 'WRITTEN',
        purpose: 'BOOKING_INVITATION',
        policyVersion: expect.stringContaining('provisional'),
        recordedByUserId: ids.ownerA,
      });
      const dump = JSON.stringify(
        await prisma.$queryRawUnsafe(
          `SELECT t::text AS row FROM contact_consent_records t WHERE "salonId" = $1`,
          ids.salonA,
        ),
      );
      expect(dump).not.toContain(good.slice(-8));
      expect(dump).not.toContain(e164(good).slice(1));
      const audits = await prisma.auditLog.findMany({
        where: { action: 'CONTACT_CONSENT_RECORDED', entityId: ids.salonA },
      });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain(good.slice(-8));
      // Retention: now + 365 days, within a minute.
      const days = (row!.expiresAt.getTime() - row!.recordedAt.getTime()) / 86_400_000;
      expect(days).toBeCloseTo(365, 0);
    });

    it('validation matches the existing preview line for line', async () => {
      const list = [
        contact(phone()),
        contact('abc'),
        { phone: phone() },
        contact(phone(), { source: undefined }),
        contact(phone(), { capturedAt: new Date(Date.now() + 86_400_000).toISOString() }),
      ];
      const dupe = phone();
      list.push(contact(dupe), contact(dupe));
      const preview = await call('post', `${base('A')}/preview`, tok.ownerA, { contacts: list });
      const saved = await record('A', 'ownerA', list);
      const map: Record<string, string> = {
        VALIDATED_FOR_REVIEW: 'RECORDED',
      };
      preview.body.items.forEach((p: Json, i: number) => {
        expect(saved.body.items[i].outcome).toBe(map[p.status] ?? p.status);
      });
    });

    it('is idempotent, and parallel identical requests leave exactly one record', async () => {
      const raw = phone();
      const first = await record('A', 'ownerA', [contact(raw)]);
      expect(first.body.items[0].outcome).toBe('RECORDED');
      const second = await record('A', 'ownerA', [contact(raw, { source: 'VERBAL' })]);
      expect(second.body.items[0].outcome).toBe('ALREADY_RECORDED');
      expect((await rowFor('A', raw))!.source).toBe('WRITTEN'); // the original evidence is not overwritten

      const racing = phone();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => record('A', 'ownerA', [contact(racing)])),
      );
      const outcomes = results.map((r) => r.body.items[0].outcome as string);
      expect(outcomes.filter((o) => o === 'RECORDED')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'ALREADY_RECORDED')).toHaveLength(7);
      expect(
        await prisma.contactConsentRecord.count({
          where: { salonId: ids.salonA, phoneHash: hashOf(racing) },
        }),
      ).toBe(1);
    });

    it('keeps consent per shop: B can record the same number, and A withdrawing does not touch B', async () => {
      const raw = phone();
      await record('A', 'ownerA', [contact(raw)]);
      const b = await record('B', 'ownerB', [contact(raw)]);
      expect(b.body.items[0].outcome).toBe('RECORDED');
      const w = await call('post', `${base('A')}/consents/withdraw`, tok.ownerA, { phone: raw });
      expect(w.status).toBe(201);
      expect(w.body).toEqual({ withdrawn: true, suppressedEverywhere: false });
      expect((await rowFor('A', raw))!.status).toBe('WITHDRAWN');
      expect((await rowFor('B', raw))!.status).toBe('ACTIVE');
    });

    it('withdrawal blocks re-recording until the contact consents AGAIN (a later date)', async () => {
      const raw = phone();
      await record('A', 'ownerA', [contact(raw, { capturedAt: hoursAgo(72) })]);
      await call('post', `${base('A')}/consents/withdraw`, tok.ownerA, { phone: raw }).expect(201);
      // Repeating the withdrawal is harmless.
      const again = await call('post', `${base('A')}/consents/withdraw`, tok.ownerA, { phone: raw });
      expect(again.body.withdrawn).toBe(false);

      // The contact withdrew a day ago.
      await prisma.contactConsentRecord.updateMany({
        where: { salonId: ids.salonA, phoneHash: hashOf(raw) },
        data: { withdrawnAt: new Date(Date.now() - 24 * 3_600_000) },
      });

      const stale = await record('A', 'ownerA', [contact(raw, { capturedAt: hoursAgo(72) })]);
      expect(stale.body.items[0].outcome).toBe('WITHDRAWN_BY_CONTACT');
      expect((await rowFor('A', raw))!.status).toBe('WITHDRAWN');

      const fresh = await record('A', 'ownerA', [contact(raw, { capturedAt: hoursAgo(1) })]);
      expect(fresh.body.items[0].outcome).toBe('RECORDED');
      const row = await rowFor('A', raw);
      expect(row).toMatchObject({ status: 'ACTIVE', withdrawnAt: null });
    });

    it('platform-wide suppression overrides every shop and cannot be bypassed by attesting consent', async () => {
      const raw = phone();
      await record('A', 'ownerA', [contact(raw)]);
      const w = await call('post', `${base('A')}/consents/withdraw`, tok.ownerA, {
        phone: raw,
        suppressEverywhere: true,
      });
      expect(w.body).toEqual({ withdrawn: true, suppressedEverywhere: true });
      // Shop B never recorded this number, yet cannot record it.
      const b = await record('B', 'ownerB', [contact(raw, { capturedAt: hoursAgo(0.01) })]);
      expect(b.body.items[0].outcome).toBe('SUPPRESSED');
      expect(b.body.summary.suppressed).toBe(1);
      const a = await record('A', 'ownerA', [contact(raw, { capturedAt: hoursAgo(0.01) })]);
      expect(a.body.items[0].outcome).toBe('SUPPRESSED');
      expect(await rowFor('B', raw)).toBeNull();

      // "Stop contacting this number" also works for a number no shop ever recorded.
      const stranger = phone();
      const s = await call('post', `${base('B')}/consents/withdraw`, tok.ownerB, {
        phone: stranger,
        suppressEverywhere: true,
      });
      expect(s.body).toEqual({ withdrawn: false, suppressedEverywhere: true });
      expect((await record('A', 'ownerA', [contact(stranger)])).body.items[0].outcome).toBe('SUPPRESSED');

      // The suppression table holds hashes only.
      const suppression = await prisma.contactSuppression.findUnique({ where: { phoneHash: hashOf(raw) } });
      expect(suppression).toMatchObject({ reason: 'OPT_OUT', createdByUserId: ids.ownerA });
    });

    it('erasure deletes this shop’s record, keeps only the do-not-contact hash by default, and leaves no number in the audit trail', async () => {
      const raw = phone();
      await record('A', 'ownerA', [contact(raw)]);
      await record('B', 'ownerB', [contact(raw)]);
      const before = (await rowFor('A', raw))!.id;
      const res = await call('post', `${base('A')}/consents/erase`, tok.ownerA, { phone: raw });
      expect(res.body).toEqual({ erased: 1, suppressionKept: true });
      expect(await rowFor('A', raw)).toBeNull();
      expect(await rowFor('B', raw)).not.toBeNull(); // another shop's record is not this shop's to erase
      expect(
        await prisma.contactSuppression.findUnique({ where: { phoneHash: hashOf(raw) } }),
      ).toMatchObject({ reason: 'ERASURE_REQUEST' });
      expect((await record('A', 'ownerA', [contact(raw)])).body.items[0].outcome).toBe('SUPPRESSED');

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'CONTACT_CONSENT_ERASED', entityId: ids.salonA },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(audit.metadata)).toContain(before);
      expect(JSON.stringify(audit)).not.toContain(raw.slice(-8));
      expect(JSON.stringify(audit)).not.toContain(hashOf(raw));

      // Full forgetting: nothing kept, and the number can be recorded again later.
      const gone = phone();
      await record('A', 'ownerA', [contact(gone)]);
      const full = await call('post', `${base('A')}/consents/erase`, tok.ownerA, {
        phone: gone,
        keepSuppression: false,
      });
      expect(full.body).toEqual({ erased: 1, suppressionKept: false });
      expect(await prisma.contactSuppression.findUnique({ where: { phoneHash: hashOf(gone) } })).toBeNull();
      expect((await record('A', 'ownerA', [contact(gone)])).body.items[0].outcome).toBe('RECORDED');
    });

    it('rejects unusable numbers on withdraw/erase and unknown body fields', async () => {
      for (const path of ['withdraw', 'erase']) {
        const res = await call('post', `${base('A')}/consents/${path}`, tok.ownerA, { phone: 'nope' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('CONTACT_LEDGER_INVALID_PHONE');
      }
      expect(
        (await call('post', `${base('A')}/consents`, tok.ownerA, { contacts: [{ phone: phone(), name: 'Someone' }] })).status,
      ).toBe(400);
      expect(
        (await call('post', `${base('A')}/consents`, tok.ownerA, { contacts: [] })).status,
      ).toBe(400);
      expect(
        (await call('post', `${base('A')}/consents`, tok.ownerA, {
          contacts: Array.from({ length: 251 }, () => contact(phone())),
        })).status,
      ).toBe(400);
    });

    it('applies retention: expired records are unusable, re-recordable, counted, and purged only on request', async () => {
      const raw = phone();
      await record('A', 'ownerA', [contact(raw)]);
      const row = (await rowFor('A', raw))!;
      await prisma.contactConsentRecord.update({
        where: { id: row.id },
        data: { expiresAt: new Date(Date.now() - 60_000), capturedAt: new Date(Date.now() - 400 * 86_400_000), recordedAt: new Date(Date.now() - 366 * 86_400_000) },
      });
      const summary = await call('get', `${base('A')}/consents/summary`, tok.ownerA);
      expect(summary.body).toMatchObject({ dispatchEnabled: false });
      expect(summary.body.expired).toBeGreaterThanOrEqual(1);

      // Re-attesting after expiry refreshes the record (a new retention period starts).
      const renewed = await record('A', 'ownerA', [contact(raw)]);
      expect(renewed.body.items[0].outcome).toBe('RECORDED');
      expect((await rowFor('A', raw))!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // An expired record elsewhere is removed by the platform purge, and only by it.
      const old = phone();
      await record('B', 'ownerB', [contact(old)]);
      const oldRow = (await rowFor('B', old))!;
      await prisma.contactConsentRecord.update({
        where: { id: oldRow.id },
        data: { expiresAt: new Date(Date.now() - 1000), capturedAt: new Date(Date.now() - 500 * 86_400_000) },
      });
      expect(await rowFor('B', old)).not.toBeNull(); // nothing purges on its own
      const purge = await call('post', 'admin/contact-ledger/purge-expired', tok.admin);
      expect(purge.status).toBe(201);
      expect(purge.body.purged).toBeGreaterThanOrEqual(1);
      expect(await rowFor('B', old)).toBeNull();
      expect(await rowFor('A', raw)).not.toBeNull(); // still-valid records survive
    });

    it('clamps the configured retention to the allowed range', async () => {
      await boot({
        CONTACT_LEDGER_ENABLED: 'true',
        CONTACT_LEDGER_HASH_KEY: HASH_KEY,
        CONTACT_CONSENT_RETENTION_DAYS: '5',
      });
      const raw = phone();
      const res = await record('A', 'ownerA', [contact(raw)]);
      expect(res.body.retentionDays).toBe(30);
      const row = (await rowFor('A', raw))!;
      expect((row.expiresAt.getTime() - row.recordedAt.getTime()) / 86_400_000).toBeCloseTo(30, 0);
      await boot({ CONTACT_LEDGER_ENABLED: 'true', CONTACT_LEDGER_HASH_KEY: HASH_KEY, CONTACT_CONSENT_RETENTION_DAYS: '99999' });
      expect((await record('A', 'ownerA', [contact(phone())])).body.retentionDays).toBe(1095);
    });

    it('rate limits the write routes (a real throttler, 20 requests a minute per route)', async () => {
      await boot(
        { CONTACT_LEDGER_ENABLED: 'true', CONTACT_LEDGER_HASH_KEY: HASH_KEY },
        true,
      );
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) {
        statuses.push(
          (
            await call('post', `${base('A')}/consents/withdraw`, tok.ownerA, {
              phone: 'nope',
            })
          ).status,
        );
      }
      expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(20)).toEqual([429, 429]);
    });

    it('enforces its invariants in the database itself', async () => {
      const valid = {
        salonId: ids.salonA,
        phoneHash: 'a'.repeat(64),
        source: 'WRITTEN',
        capturedAt: new Date(Date.now() - 1000),
        recordedByUserId: ids.ownerA,
        policyVersion: 'test',
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      const attempt = (data: Json) => prisma.contactConsentRecord.create({ data: { ...valid, ...data } as any });
      await expect(attempt({ phoneHash: '+919999999999' })).rejects.toThrow(); // plaintext-looking value
      await expect(attempt({ phoneHash: 'A'.repeat(64) })).rejects.toThrow(); // not lowercase hex
      await expect(attempt({ status: 'MAYBE' })).rejects.toThrow();
      await expect(attempt({ status: 'WITHDRAWN' })).rejects.toThrow(); // withdrawn without a time
      await expect(attempt({ status: 'ACTIVE', withdrawnAt: new Date() })).rejects.toThrow();
      await expect(attempt({ expiresAt: new Date(Date.now() - 86_400_000 * 3) })).rejects.toThrow(); // expires before it was captured
      await expect(
        prisma.contactSuppression.create({ data: { phoneHash: 'z'.repeat(64), reason: 'OPT_OUT' } }),
      ).rejects.toThrow();
      await expect(
        prisma.contactSuppression.create({ data: { phoneHash: 'b'.repeat(64), reason: 'WHENEVER' } }),
      ).rejects.toThrow();
    });
  });
});
