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
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TokenService } from '../src/auth/services/token.service';
import { TotpService } from '../src/auth/services/totp.service';
import { CryptoService } from '../src/auth/services/crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #381 on a DISPOSABLE database: recoverable shop deletion end to end.
 * Co-Founder request (typed name + reason) → a DIFFERENT Super Admin approves with a fresh
 * authenticator code → the shop is quarantined (SUSPENDED, read-only, no hard delete) → a Super
 * Admin restores it inside 30 days. Covers self-approval, duplicates, races, stale/replayed codes,
 * open obligations, expiry, database guards and unrelated-shop isolation.
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

maybe('Recoverable shop deletion (#381, disposable database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  let totp: TotpService;
  let crypto: CryptoService;
  const run = randomUUID().slice(0, 8);
  let cityId = '';
  let seq = 0;
  const tok: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const code = (who: string) => totp.generateToken(secrets[who]);

  async function person(
    label: string,
    roles: Array<[Role, string | null]>,
    audience: SessionAudience,
    withTotp = false,
  ) {
    const secret = totp.generateSecret();
    const u = await prisma.user.create({
      data: {
        email: `del381-${run}-${label}@example.test`,
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
        ...(withTotp
          ? { twoFactorEnabled: true, totpSecret: crypto.encrypt(secret) }
          : {}),
      },
    });
    for (const [role, salonId] of roles)
      await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
    tok[label] = tokens.signAccessToken(
      u.id,
      roles.map(([r]) => r),
      audience,
    );
    secrets[label] = secret;
    ids[label] = u.id;
    return u.id;
  }

  /** A fresh Super Admin, so every decision in a test can use its own never-used code. */
  async function freshAdmin() {
    const label = `admin${++seq}`;
    await person(
      label,
      [[Role.PLATFORM_ADMIN, null]],
      SessionAudience.ADMIN,
      true,
    );
    return label;
  }

  async function shop(key: string) {
    const owner = await person(`owner${key}`, [], SessionAudience.STAFF);
    const s = await prisma.salon.create({
      data: {
        ownerUserId: owner,
        name: `Del ${key} ${run}`,
        slug: `del-${key.toLowerCase()}-${run}`,
        cityId,
        addressLine: 'Synthetic',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        status: SalonStatus.ACTIVE,
      },
    });
    await prisma.userRole.create({
      data: { userId: owner, role: Role.SALON_OWNER, salonId: s.id },
    });
    tok[`owner${key}`] = tokens.signAccessToken(
      owner,
      [Role.SALON_OWNER],
      SessionAudience.STAFF,
    );
    ids[`shop${key}`] = s.id;
    return s;
  }

  const ask = (
    who: string,
    salonId: string,
    name: string,
    reason = 'Closed permanently by the owner (synthetic).',
  ) =>
    http()
      .post(`/api/v1/admin/shops/${salonId}/deletion-requests`)
      .set(as(who))
      .send({ reason, typedShopName: name });
  const approve = async (who: string, requestId: string, codeValue?: string) =>
    http()
      .post(`/api/v1/admin/shop-deletions/requests/${requestId}/approve`)
      .set(as(who))
      .send({ totpCode: codeValue ?? (await code(who)) });
  const restore = async (who: string, salonId: string, codeValue?: string) =>
    http()
      .post(`/api/v1/admin/shop-deletions/trash/${salonId}/restore`)
      .set(as(who))
      .send({ totpCode: codeValue ?? (await code(who)) });
  const errCode = (r: request.Response) => r.body?.error?.code;
  const created = (r: request.Response) => {
    expect([r.status, errCode(r)]).toEqual([201, undefined]);
    return r;
  };

  beforeAll(async () => {
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
    tokens = app.get(TokenService);
    totp = app.get(TotpService);
    crypto = app.get(CryptoService);
    cityId = (
      await prisma.city.create({
        data: {
          name: `Del ${run}`,
          slug: `del-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      })
    ).id;
    await person(
      'cofounder',
      [[Role.CO_FOUNDER, null]],
      SessionAudience.ADMIN,
      true,
    );
    await person(
      'cofounder2',
      [[Role.CO_FOUNDER, null]],
      SessionAudience.ADMIN,
      true,
    );
    tok.cofounderStaffSession = tokens.signAccessToken(
      ids.cofounder,
      [Role.CO_FOUNDER],
      SessionAudience.STAFF,
    );
    // One person holding BOTH roles: may request, but must never decide their own request.
    await person(
      'dual',
      [
        [Role.CO_FOUNDER, null],
        [Role.PLATFORM_ADMIN, null],
      ],
      SessionAudience.ADMIN,
      true,
    );
    await person('customer', [[Role.CUSTOMER, null]], SessionAudience.CUSTOMER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('preview: Co-Founder (admin session) sees consequences; owner, customer and a non-admin session cannot', async () => {
    const s = await shop('P');
    const r = await http()
      .get(`/api/v1/admin/shops/${s.id}/deletion-preview`)
      .set(as('cofounder'))
      .expect(200);
    expect(r.body.shop.name).toBe(s.name);
    expect(r.body.blockers).toEqual([]);
    expect(r.body.recoveryWindowDays).toBe(30);
    for (const who of ['ownerP', 'customer', 'cofounderStaffSession'])
      expect(
        (
          await http()
            .get(`/api/v1/admin/shops/${s.id}/deletion-preview`)
            .set(as(who))
        ).status,
      ).toBe(403);
  });

  it('request: needs the typed shop name; only a Co-Founder can request; duplicates are refused; nothing changes', async () => {
    const s = await shop('R');
    const wrong = await ask('cofounder', s.id, 'Some Other Shop');
    expect(wrong.status).toBe(400);
    expect(errCode(wrong)).toBe('SHOP_NAME_MISMATCH');
    const admin = await freshAdmin();
    expect((await ask(admin, s.id, s.name)).status).toBe(403);
    expect((await ask('ownerR', s.id, s.name)).status).toBe(403);
    expect((await ask('cofounder', s.id, s.name, 'short')).status).toBe(400);

    const ok = await ask(
      'cofounder',
      s.id,
      `  ${s.name.toUpperCase()} `,
    ).expect(201);
    expect(ok.body.status).toBe('PENDING');
    const dup = await ask('cofounder2', s.id, s.name);
    expect(dup.status).toBe(409);
    expect(errCode(dup)).toBe('SHOP_DELETE_ALREADY_REQUESTED');
    const after = await prisma.salon.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe(SalonStatus.ACTIVE);
    expect(after.softDeletedAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: s.id, action: 'SHOP_DELETE_REQUESTED' },
      }),
    ).toBe(1);
  });

  it('two simultaneous requests for one shop create exactly one pending request', async () => {
    const s = await shop('C');
    const [a, b] = await Promise.all([
      ask('cofounder', s.id, s.name),
      ask('cofounder2', s.id, s.name),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await prisma.shopDeletionRequest.count({
        where: { salonId: s.id, status: 'PENDING' },
      }),
    ).toBe(1);
  });

  it('approval: Co-Founder cannot approve; requester cannot self-approve; a wrong code is refused', async () => {
    const s = await shop('S');
    const req = (await ask('dual', s.id, s.name).expect(201)).body;
    expect((await approve('cofounder2', req.id)).status).toBe(403);
    const self = await approve('dual', req.id);
    expect(self.status).toBe(403);
    expect(errCode(self)).toBe('SELF_APPROVAL_FORBIDDEN');
    const admin = await freshAdmin();
    const valid = await code(admin);
    const bad = await approve(
      admin,
      req.id,
      valid === '000000' ? '111111' : '000000',
    );
    expect(bad.status).toBe(401);
    expect(errCode(bad)).toBe('TOTP_INVALID');
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: ids[admin],
          action: 'SHOP_DELETE_TOTP_REFUSED',
          entityId: req.id,
        },
      }),
    ).toBe(1);
    expect(
      (await prisma.salon.findUniqueOrThrow({ where: { id: s.id } }))
        .softDeletedAt,
    ).toBeNull();
  });

  it('a different Super Admin approves → shop quarantined for 30 days; the same code cannot be replayed', async () => {
    const s = await shop('Q');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    const admin = await freshAdmin();
    const c = await code(admin);
    const before = Date.now();
    const r = created(await approve(admin, req.id, c));
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: s.id } });
    expect(salon.status).toBe(SalonStatus.SUSPENDED);
    expect(salon.statusBeforeSoftDelete).toBe(SalonStatus.ACTIVE);
    expect(salon.softDeletionRequestId).toBe(req.id);
    expect(salon.softDeletedByUserId).toBe(ids[admin]);
    const window =
      salon.restoreEligibleUntil!.getTime() - salon.softDeletedAt!.getTime();
    expect(window).toBe(30 * 86_400_000);
    expect(
      new Date(r.body.restoreEligibleUntil).getTime(),
    ).toBeGreaterThanOrEqual(before + 30 * 86_400_000 - 5_000);
    expect(
      (
        await prisma.shopDeletionRequest.findUniqueOrThrow({
          where: { id: req.id },
        })
      ).status,
    ).toBe('APPROVED');

    const replay = await restore(admin, s.id, c);
    expect(replay.status).toBe(401);
    expect(errCode(replay)).toBe('TOTP_ALREADY_USED');
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: ids[admin],
          action: 'SHOP_DELETE_TOTP_REFUSED',
          entityId: s.id,
        },
      }),
    ).toBe(1);
    expect(
      (await prisma.salon.findUniqueOrThrow({ where: { id: s.id } }))
        .softDeletedAt,
    ).not.toBeNull();
    ids.quarantined = s.id;
  });

  it('a quarantined shop is closed and read-only: owner gets 409, database refuses writes and hard delete', async () => {
    const id = ids.quarantined;
    const overview = await http()
      .get(`/api/v1/dashboard/salons/${id}/overview`)
      .set(as('ownerQ'));
    expect(overview.status).toBe(409);
    expect(errCode(overview)).toBe('SHOP_QUARANTINED');
    const chair = await prisma.chair.findFirst({ where: { salonId: id } });
    // The trigger fires before any FK lookup, so even a synthetic chair id is refused for this shop.
    await expect(
      prisma.manualChairOccupancy.create({
        data: {
          salonId: id,
          chairId: chair?.id ?? randomUUID(),
          startedByUserId: ids.ownerQ,
        },
      }),
    ).rejects.toThrow(/SHOP_QUARANTINED/);
    await expect(
      prisma.salon.update({ where: { id }, data: { name: 'renamed' } }),
    ).rejects.toThrow(/SHOP_QUARANTINED/);
    await expect(
      prisma.$executeRaw`DELETE FROM "salons" WHERE "id" = ${id}`,
    ).rejects.toThrow(/SALON_HARD_DELETE_DISABLED/);
    const legacy = await http()
      .delete(`/api/v1/admin/shops/${id}`)
      .set(as(await freshAdmin()));
    expect(legacy.status).toBe(409);
    expect(await prisma.salon.count({ where: { id } })).toBe(1);
    const trash = await http()
      .get('/api/v1/admin/shop-deletions/trash')
      .set(as(await freshAdmin()))
      .expect(200);
    expect(trash.body.items.map((i: { id: string }) => i.id)).toContain(id);
  });

  it('two Super Admins approving the same request at once: exactly one wins', async () => {
    const s = await shop('D');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    const [a1, a2] = [await freshAdmin(), await freshAdmin()];
    const [r1, r2] = await Promise.all([
      approve(a1, req.id),
      approve(a2, req.id),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(errCode(r1.status === 409 ? r1 : r2)).toBe('DELETE_REQUEST_CLOSED');
    expect(
      await prisma.auditLog.count({
        where: { entityId: s.id, action: 'SHOP_DELETE_APPROVED' },
      }),
    ).toBe(1);
  });

  it('open obligations block approval; the request stays pending and the refusal is audited', async () => {
    const s = await shop('O');
    const chair = await prisma.chair.create({
      data: { salonId: s.id, label: 'Chair 1' },
    });
    await prisma.manualChairOccupancy.create({
      data: { salonId: s.id, chairId: chair.id, startedByUserId: ids.ownerO },
    });
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    const preview = await http()
      .get(`/api/v1/admin/shops/${s.id}/deletion-preview`)
      .set(as('cofounder'))
      .expect(200);
    expect(preview.body.blockers).toContain('ACTIVE_MANUAL_CHAIR_OCCUPANCY');
    const r = await approve(await freshAdmin(), req.id);
    expect(r.status).toBe(409);
    expect(errCode(r)).toBe('SHOP_HAS_OPEN_OBLIGATIONS');
    expect(r.body.error.details.blockers).toContain(
      'ACTIVE_MANUAL_CHAIR_OCCUPANCY',
    );
    expect(
      (
        await prisma.shopDeletionRequest.findUniqueOrThrow({
          where: { id: req.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      (await prisma.salon.findUniqueOrThrow({ where: { id: s.id } }))
        .softDeletedAt,
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { entityId: s.id, action: 'SHOP_DELETE_DENIED' },
      }),
    ).toBe(1);
  });

  it('reject needs a note and a fresh code; the shop is untouched and can be requested again', async () => {
    const s = await shop('J');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    const admin = await freshAdmin();
    expect(
      (
        await http()
          .post(`/api/v1/admin/shop-deletions/requests/${req.id}/reject`)
          .set(as(admin))
          .send({ totpCode: await code(admin) })
      ).status,
    ).toBe(400);
    await http()
      .post(`/api/v1/admin/shop-deletions/requests/${req.id}/reject`)
      .set(as(admin))
      .send({
        totpCode: await code(admin),
        note: 'Owner changed their mind (synthetic).',
      })
      .expect(201);
    const after = await prisma.salon.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe(SalonStatus.ACTIVE);
    expect(after.softDeletedAt).toBeNull();
    expect((await approve(await freshAdmin(), req.id)).status).toBe(409);
    await ask('cofounder', s.id, s.name).expect(201);
  });

  it('restore inside the window brings the shop back with history intact; not-ready shops come back PENDING', async () => {
    const s = await shop('T');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    created(await approve(await freshAdmin(), req.id));
    expect(
      (
        await http()
          .post(`/api/v1/admin/shop-deletions/trash/${s.id}/restore`)
          .set(as('cofounder'))
          .send({ totpCode: '123456' })
      ).status,
    ).toBe(403);
    const r = created(await restore(await freshAdmin(), s.id));
    // No verification/services/chairs/staff in this synthetic shop, so it cannot reopen as ACTIVE.
    expect(r.body.status).toBe(SalonStatus.PENDING);
    const after = await prisma.salon.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.softDeletedAt).toBeNull();
    expect(after.restoreEligibleUntil).toBeNull();
    expect(after.softDeletionRequestId).toBeNull();
    expect(
      (
        await prisma.shopDeletionRequest.findUniqueOrThrow({
          where: { id: req.id },
        })
      ).status,
    ).toBe('APPROVED');
    expect(
      await prisma.auditLog.count({
        where: { entityId: s.id, action: 'SHOP_DELETE_RESTORED' },
      }),
    ).toBe(1);
    expect(
      (
        await http()
          .get(`/api/v1/dashboard/salons/${s.id}/services`)
          .set(as('ownerT'))
      ).status,
    ).toBe(200);
    expect((await restore(await freshAdmin(), s.id)).status).toBe(409);
  });

  it('after 30 days restore is refused, the shop stays in read-only Trash and nothing is purged', async () => {
    const s = await shop('E');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    created(await approve(await freshAdmin(), req.id));
    // Simulate day 31 (test-only: uses the restore marker to pass the quarantine update guard).
    await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.fastque_restore_salon_id', ${s.id}, true)`,
      prisma.$executeRaw`UPDATE "salons" SET "softDeletedAt" = now() - interval '31 days', "restoreEligibleUntil" = now() - interval '1 day' WHERE "id" = ${s.id}`,
    ]);
    const r = await restore(await freshAdmin(), s.id);
    expect(r.status).toBe(409);
    expect(errCode(r)).toBe('RESTORE_WINDOW_EXPIRED');
    const after = await prisma.salon.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.softDeletedAt).not.toBeNull();
    expect(after.status).toBe(SalonStatus.SUSPENDED);
    expect(
      await prisma.auditLog.count({
        where: { entityId: s.id, action: 'SHOP_DELETE_RESTORE_EXPIRED' },
      }),
    ).toBe(1);
  });

  it('a suspended Super Admin cannot decide; unrelated shops are never affected', async () => {
    const s = await shop('U');
    const other = await shop('V');
    const req = (await ask('cofounder', s.id, s.name).expect(201)).body;
    const admin = await freshAdmin();
    await prisma.user.update({
      where: { id: ids[admin] },
      data: { status: UserStatus.SUSPENDED },
    });
    expect([401, 403]).toContain((await approve(admin, req.id)).status);
    created(await approve(await freshAdmin(), req.id));
    const v = await prisma.salon.findUniqueOrThrow({ where: { id: other.id } });
    expect(v.status).toBe(SalonStatus.ACTIVE);
    expect(v.softDeletedAt).toBeNull();
    expect(
      (
        await http()
          .get(`/api/v1/dashboard/salons/${other.id}/overview`)
          .set(as('ownerV'))
      ).status,
    ).toBe(200);
  });
});
