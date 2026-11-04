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
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Issue #378 on a DISPOSABLE local database: permanent deletion of one chair / one staff member,
 * owner-only, preview + typed-name confirmation, history-safe, replay/stale/race-safe.
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
  'Permanent deletion of chairs and staff (#378, disposable database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokenService: TokenService;
    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};

    const api = (who: string) => {
      const a = request(app.getHttpServer());
      const auth = { Authorization: `Bearer ${tok[who]}` };
      const base = (salon: string, kind: 'chairs' | 'staff', id: string) =>
        `/api/v1/dashboard/salons/${salon}/${kind}/${id}`;
      return {
        preview: (salon: string, kind: 'chairs' | 'staff', id: string) =>
          a.post(`${base(salon, kind, id)}/deletion-preview`).set(auth),
        confirm: (
          salon: string,
          kind: 'chairs' | 'staff',
          id: string,
          body: Record<string, unknown>,
        ) =>
          a
            .post(`${base(salon, kind, id)}/permanent-deletion`)
            .set(auth)
            .send(body),
      };
    };
    const chair = (salonId: string, label: string) =>
      prisma.chair.create({ data: { salonId, label } });

    async function user(label: string, role: Role, salonId: string | null) {
      const u = await prisma.user.create({
        data: {
          email: `del378-${run}-${label}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      if (salonId !== undefined)
        await prisma.userRole.create({ data: { userId: u.id, role, salonId } });
      ids[label] = u.id;
      return u;
    }

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
      const tokens = app.get(TokenService);
      tokenService = tokens;
      const city = await prisma.city.create({
        data: {
          name: `Del ${run}`,
          slug: `del-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      });
      for (const key of ['shopA', 'shopB']) {
        const owner = await user(`${key}Owner`, Role.SALON_OWNER, null);
        const s = await prisma.salon.create({
          data: {
            ownerUserId: owner.id,
            name: `Del ${key} ${run}`,
            slug: `del-${key}-${run}`,
            cityId: city.id,
            addressLine: 'Synthetic',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
            status: SalonStatus.ACTIVE,
          },
        });
        await prisma.userRole.updateMany({
          where: { userId: owner.id },
          data: { salonId: s.id },
        });
        ids[key] = s.id;
        tok[`${key}Owner`] = tokens.signAccessToken(
          owner.id,
          [Role.SALON_OWNER],
          SessionAudience.STAFF,
        );
      }
      const customer = await user('customer', Role.CUSTOMER, null);
      tok.customer = tokens.signAccessToken(
        customer.id,
        [Role.CUSTOMER],
        SessionAudience.CUSTOMER,
      );
      ids.service = (
        await prisma.service.create({
          data: {
            salonId: ids.shopA,
            name: 'Haircut',
            durationMinutes: 30,
            price: 200,
          },
        })
      ).id;
    });

    afterAll(async () => {
      await app?.close();
    });

    it('an unused chair: preview changes nothing; wrong name or no acknowledgement deletes nothing; then deleted once with an audit entry', async () => {
      const c = await chair(ids.shopA, `Spare Chair ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      expect(p).toMatchObject({
        kind: 'chair',
        deletable: true,
        blockers: [],
        confirmName: c.label,
        target: { id: c.id, name: c.label },
      });
      expect(p.salon.name).toContain('shopA');
      expect(p.token).toBeTruthy();
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);

      expect(
        (
          await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: 'spare chair',
            acknowledged: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: c.label,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: c.label,
            acknowledged: false,
          })
        ).status,
      ).toBe(400);
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);

      const done = (
        await api('shopAOwner')
          .confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: ` ${c.label} `,
            acknowledged: true,
          })
          .expect(200)
      ).body;
      expect(done).toMatchObject({ kind: 'chair', deletedId: c.id });
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(0);
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: c.id, action: 'CHAIR_PERMANENTLY_DELETED' },
      });
      expect(audit?.actorUserId).toBe(ids.shopAOwner);

      const replay = await api('shopAOwner').confirm(
        ids.shopA,
        'chairs',
        c.id,
        { token: p.token, typedName: c.label, acknowledged: true },
      );
      expect([404, 409]).toContain(replay.status);
    });

    it('a chair with history cannot be deleted: blockers named, no token, and a forged token does nothing', async () => {
      const c = await chair(ids.shopA, `Used Chair ${run}`);
      const barberUser = await user(
        `hist-barber-${run}`,
        Role.SALON_STAFF,
        ids.shopA,
      );
      const staff = await prisma.salonStaff.create({
        data: {
          salonId: ids.shopA,
          userId: barberUser.id,
          displayName: `Hist ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      const entry = await prisma.queueEntry.create({
        data: {
          salonId: ids.shopA,
          source: 'WALK_IN',
          status: 'COMPLETED',
          tokenNumber: 900,
          contactName: 'Old',
          serviceId: ids.service,
        },
      });
      await prisma.serviceSession.create({
        data: {
          queueEntryId: entry.id,
          staffId: staff.id,
          chairId: c.id,
          serviceId: ids.service,
          status: 'COMPLETED',
          endedAt: new Date(),
        },
      });
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      expect(p.deletable).toBe(false);
      expect(p.token).toBeUndefined();
      expect(p.blockers.map((b: { code: string }) => b.code)).toContain(
        'SERVICE_HISTORY',
      );
      expect(p.alternative).toMatch(/Remove chair/);
      const forged = await api('shopAOwner').confirm(
        ids.shopA,
        'chairs',
        c.id,
        {
          token: 'eyJ1IjoieCJ9.' + 'A'.repeat(43),
          typedName: c.label,
          acknowledged: true,
        },
      );
      expect(forged.status).toBe(400);
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
      expect(
        await prisma.serviceSession.count({ where: { chairId: c.id } }),
      ).toBe(1);

      // The staff member who served there is blocked too, and their history stays.
      const sp = (
        await api('shopAOwner')
          .preview(ids.shopA, 'staff', staff.id)
          .expect(200)
      ).body;
      expect(sp.deletable).toBe(false);
      expect(sp.blockers.map((b: { code: string }) => b.code)).toContain(
        'SERVICE_HISTORY',
      );
      expect(sp.alternative).toMatch(/Remove access/);
    });

    it('stale: the chair changed after the preview, so nothing is deleted', async () => {
      const c = await chair(ids.shopA, `Stale Chair ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      await prisma.chair.update({
        where: { id: c.id },
        data: { label: `Stale Chair renamed ${run}` },
      });
      const r = await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
        token: p.token,
        typedName: `Stale Chair renamed ${run}`,
        acknowledged: true,
      });
      expect(r.status).toBe(409);
      expect(r.body.error?.code ?? r.body.code).toBe('PERMANENT_DELETE_STALE');
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it('expired confirmation does nothing', async () => {
      const c = await chair(ids.shopA, `Expire Chair ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
      try {
        const r = await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
          token: p.token,
          typedName: c.label,
          acknowledged: true,
        });
        expect(r.status).toBe(410);
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it('another owner, a customer, and a token moved to another shop or record are all refused', async () => {
      const c = await chair(ids.shopA, `Guarded Chair ${run}`);
      const other = await chair(ids.shopA, `Other Chair ${run}`);
      expect([403, 404]).toContain(
        (await api('shopBOwner').preview(ids.shopA, 'chairs', c.id)).status,
      );
      expect(
        (await api('customer').preview(ids.shopA, 'chairs', c.id)).status,
      ).toBe(403);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      expect([403, 404]).toContain(
        (
          await api('shopBOwner').confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: c.label,
            acknowledged: true,
          })
        ).status,
      );
      expect(
        (
          await api('shopAOwner').confirm(ids.shopA, 'chairs', other.id, {
            token: p.token,
            typedName: other.label,
            acknowledged: true,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await api('shopAOwner').confirm(ids.shopB, 'chairs', c.id, {
            token: p.token,
            typedName: c.label,
            acknowledged: true,
          })
        ).status,
      ).not.toBe(200);
      expect(
        await prisma.chair.count({ where: { id: { in: [c.id, other.id] } } }),
      ).toBe(2);
    });

    it('two confirmations at once delete exactly once', async () => {
      const c = await chair(ids.shopA, `Race Chair ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      const body = { token: p.token, typedName: c.label, acknowledged: true };
      const [a, b] = await Promise.all([
        api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, body),
        api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, body),
      ]);
      expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
      expect(
        await prisma.auditLog.count({
          where: { entityId: c.id, action: 'CHAIR_PERMANENTLY_DELETED' },
        }),
      ).toBe(1);
    });

    it('a chair used between preview and confirmation is not deleted', async () => {
      const c = await chair(ids.shopA, `Late Use Chair ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      await prisma.manualChairOccupancy.create({
        data: {
          salonId: ids.shopA,
          chairId: c.id,
          startedByUserId: ids.shopAOwner,
        },
      });
      const r = await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
        token: p.token,
        typedName: c.label,
        acknowledged: true,
      });
      expect(r.status).toBe(409);
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it("staff: only this shop's roster record goes; the User account and their other shop stay", async () => {
      const person = await user(
        `two-shops-${run}`,
        Role.SALON_STAFF,
        ids.shopA,
      );
      await prisma.userRole.create({
        data: { userId: person.id, role: Role.SALON_STAFF, salonId: ids.shopB },
      });
      const inA = await prisma.salonStaff.create({
        data: {
          salonId: ids.shopA,
          userId: person.id,
          displayName: `Ramesh ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      const inB = await prisma.salonStaff.create({
        data: {
          salonId: ids.shopB,
          userId: person.id,
          displayName: `Ramesh ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      await prisma.staffService.create({
        data: { staffId: inA.id, serviceId: ids.service },
      });
      await prisma.staffWorkingHours.create({
        data: {
          staffId: inA.id,
          dayOfWeek: 1,
          openTime: '10:00',
          closeTime: '18:00',
        },
      });
      const session = await prisma.refreshToken.findFirst({
        where: { userId: person.id },
      });
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'staff', inA.id).expect(200)
      ).body;
      expect(p).toMatchObject({
        kind: 'staff',
        deletable: true,
        confirmName: `Ramesh ${run}`,
      });
      expect(p.effects.join(' ')).toMatch(/account itself is NOT deleted/);
      await api('shopAOwner')
        .confirm(ids.shopA, 'staff', inA.id, {
          token: p.token,
          typedName: `Ramesh ${run}`,
          acknowledged: true,
        })
        .expect(200);
      expect(await prisma.salonStaff.count({ where: { id: inA.id } })).toBe(0);
      expect(
        await prisma.staffService.count({ where: { staffId: inA.id } }),
      ).toBe(0);
      expect(
        await prisma.staffWorkingHours.count({ where: { staffId: inA.id } }),
      ).toBe(0);
      expect(await prisma.user.count({ where: { id: person.id } })).toBe(1);
      expect(
        await prisma.userRole.count({
          where: { userId: person.id, salonId: ids.shopA },
        }),
      ).toBe(0);
      expect(
        await prisma.userRole.count({
          where: {
            userId: person.id,
            salonId: ids.shopB,
            role: Role.SALON_STAFF,
          },
        }),
      ).toBe(1);
      expect(await prisma.salonStaff.count({ where: { id: inB.id } })).toBe(1);
      void session;
      expect(
        await prisma.auditLog.count({
          where: { entityId: inA.id, action: 'STAFF_PERMANENTLY_DELETED' },
        }),
      ).toBe(1);
    });

    it('staff with a booking that asked for them cannot be deleted, and the booking is untouched', async () => {
      const person = await user(`booked-${run}`, Role.SALON_STAFF, ids.shopA);
      const st = await prisma.salonStaff.create({
        data: {
          salonId: ids.shopA,
          userId: person.id,
          displayName: `Suresh ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      await prisma.queueEntry.create({
        data: {
          salonId: ids.shopA,
          source: 'WALK_IN',
          status: 'CANCELLED',
          tokenNumber: 901,
          contactName: 'Pref',
          serviceId: ids.service,
          preferredStaffId: st.id,
        },
      });
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'staff', st.id).expect(200)
      ).body;
      expect(p.deletable).toBe(false);
      expect(p.blockers.map((b: { code: string }) => b.code)).toContain(
        'QUEUE_PREFERENCE',
      );
      expect(
        await prisma.queueEntry.count({ where: { preferredStaffId: st.id } }),
      ).toBe(1);
    });

    it('the owner cannot delete their own staff profile', async () => {
      const own = await prisma.salonStaff.create({
        data: {
          salonId: ids.shopA,
          userId: ids.shopAOwner,
          displayName: `Owner Self ${run}`,
          roleInSalon: 'BARBER',
          status: 'ACTIVE',
        },
      });
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'staff', own.id).expect(200)
      ).body;
      expect(p.deletable).toBe(false);
      expect(p.blockers.map((b: { code: string }) => b.code)).toContain('SELF');
      expect(await prisma.salonStaff.count({ where: { id: own.id } })).toBe(1);
    });

    it('an unknown chair or staff id in this shop is a plain 404', async () => {
      expect(
        (await api('shopAOwner').preview(ids.shopA, 'chairs', randomUUID()))
          .status,
      ).toBe(404);
      expect(
        (await api('shopAOwner').preview(ids.shopA, 'staff', randomUUID()))
          .status,
      ).toBe(404);
    });

    // ---------------------------------------------------------------- review fixes (PR #380)

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const nonceOf = (token: string) =>
      (
        JSON.parse(
          Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
        ) as { n: string }
      ).n;

    /** A fresh owner + shop, so revoking or transferring it cannot disturb the other tests. */
    async function freshShop(tag: string) {
      const owner = await prisma.user.create({
        data: {
          email: `del378-${run}-${tag}@example.test`,
          emailVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      const city = await prisma.city.findFirstOrThrow({
        where: { slug: `del-${run}` },
      });
      const s = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Del ${tag} ${run}`,
          slug: `del-${tag}-${run}`,
          cityId: city.id,
          addressLine: 'Synthetic',
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          status: SalonStatus.ACTIVE,
        },
      });
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: s.id },
      });
      tok[tag] = tokenService.signAccessToken(
        owner.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      return { ownerId: owner.id, salonId: s.id };
    }

    it('owner role revoked WHILE the confirmation runs: the in-transaction gate refuses, nothing is deleted', async () => {
      const { ownerId, salonId } = await freshShop('revoke');
      const c = await chair(salonId, `Revoke Race ${run}`);
      const p = (
        await api('revoke').preview(salonId, 'chairs', c.id).expect(200)
      ).body;
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      // A concurrent revocation: deleted but not committed yet, so the confirmation's early check still sees the role.
      const revoke = prisma.$transaction(
        async (tx) => {
          await tx.userRole.deleteMany({
            where: { userId: ownerId, salonId, role: Role.SALON_OWNER },
          });
          await held;
        },
        { timeout: 20_000 },
      );
      await sleep(300);
      const confirm = api('revoke')
        .confirm(salonId, 'chairs', c.id, {
          token: p.token,
          typedName: c.label,
          acknowledged: true,
        })
        .then((r) => r);
      await sleep(1_000); // the confirmation now waits on the locked role row
      release();
      await revoke;
      const r = await confirm;
      expect(r.status).toBe(403);
      expect(r.body.error?.code ?? r.body.code).toBe(
        'PERMANENT_DELETE_ACCESS_CHANGED',
      );
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it('shop ownership transferred WHILE the confirmation runs: refused, nothing is deleted', async () => {
      const { ownerId, salonId } = await freshShop('transfer');
      const newOwner = await prisma.user.create({
        data: {
          email: `del378-${run}-newowner@example.test`,
          status: UserStatus.ACTIVE,
        },
      });
      const c = await chair(salonId, `Transfer Race ${run}`);
      const p = (
        await api('transfer').preview(salonId, 'chairs', c.id).expect(200)
      ).body;
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const transfer = prisma.$transaction(
        async (tx) => {
          await tx.salon.update({
            where: { id: salonId },
            data: { ownerUserId: newOwner.id },
          });
          await tx.userRole.deleteMany({
            where: { userId: ownerId, salonId, role: Role.SALON_OWNER },
          });
          await tx.userRole.create({
            data: { userId: newOwner.id, role: Role.SALON_OWNER, salonId },
          });
          await held;
        },
        { timeout: 20_000 },
      );
      await sleep(300);
      const confirm = api('transfer')
        .confirm(salonId, 'chairs', c.id, {
          token: p.token,
          typedName: c.label,
          acknowledged: true,
        })
        .then((r) => r);
      await sleep(1_000);
      release();
      await transfer;
      const r = await confirm;
      expect(r.status).toBe(403);
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it('a token already used on ANOTHER server instance (recorded in the shared table) is refused; nothing is deleted', async () => {
      const c = await chair(ids.shopA, `Other Instance ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      await prisma.idempotencyKey.create({
        data: {
          key: `permanent-delete:${nonceOf(p.token)}`,
          endpoint: 'permanent-deletion:chair',
          requestHash: 'x',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const r = await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
        token: p.token,
        typedName: c.label,
        acknowledged: true,
      });
      expect(r.status).toBe(409);
      expect(r.body.error?.code ?? r.body.code).toBe(
        'PERMANENT_DELETE_TOKEN_USED',
      );
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });

    it('a successful deletion records the token as used in the shared table (durable across instances and restarts)', async () => {
      const c = await chair(ids.shopA, `Recorded ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      await api('shopAOwner')
        .confirm(ids.shopA, 'chairs', c.id, {
          token: p.token,
          typedName: c.label,
          acknowledged: true,
        })
        .expect(200);
      expect(
        await prisma.idempotencyKey.count({
          where: { key: `permanent-delete:${nonceOf(p.token)}` },
        }),
      ).toBe(1);
    });

    it('a refused confirmation (wrong name) does NOT use up the token', async () => {
      const c = await chair(ids.shopA, `Not Used Up ${run}`);
      const p = (
        await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
      ).body;
      expect(
        (
          await api('shopAOwner').confirm(ids.shopA, 'chairs', c.id, {
            token: p.token,
            typedName: 'wrong',
            acknowledged: true,
          })
        ).status,
      ).toBe(400);
      expect(
        await prisma.idempotencyKey.count({
          where: { key: `permanent-delete:${nonceOf(p.token)}` },
        }),
      ).toBe(0);
      await api('shopAOwner')
        .confirm(ids.shopA, 'chairs', c.id, {
          token: p.token,
          typedName: c.label,
          acknowledged: true,
        })
        .expect(200);
    });

    it('two separate server instances confirming the same token at once delete exactly once', async () => {
      const second = await Test.createTestingModule({ imports: [AppModule] })
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
      const app2 = second.createNestApplication<INestApplication<App>>();
      app2.setGlobalPrefix('api/v1');
      app2.useGlobalFilters(new AllExceptionsFilter());
      await app2.init();
      try {
        const c = await chair(ids.shopA, `Two Instances ${run}`);
        const p = (
          await api('shopAOwner').preview(ids.shopA, 'chairs', c.id).expect(200)
        ).body;
        const body = { token: p.token, typedName: c.label, acknowledged: true };
        const path = `/api/v1/dashboard/salons/${ids.shopA}/chairs/${c.id}/permanent-deletion`;
        const auth = { Authorization: `Bearer ${tok.shopAOwner}` };
        const [a, b] = await Promise.all([
          request(app.getHttpServer()).post(path).set(auth).send(body),
          request(app2.getHttpServer()).post(path).set(auth).send(body),
        ]);
        expect([a.status, b.status].filter((x) => x === 200)).toHaveLength(1);
        expect(
          await prisma.auditLog.count({
            where: { entityId: c.id, action: 'CHAIR_PERMANENTLY_DELETED' },
          }),
        ).toBe(1);
      } finally {
        await app2.close();
      }
    });

    it('a suspended caller is refused even with a valid confirmation', async () => {
      const { ownerId, salonId } = await freshShop('suspend');
      const c = await chair(salonId, `Suspended ${run}`);
      const p = (
        await api('suspend').preview(salonId, 'chairs', c.id).expect(200)
      ).body;
      await prisma.user.update({
        where: { id: ownerId },
        data: { status: UserStatus.SUSPENDED },
      });
      const r = await api('suspend').confirm(salonId, 'chairs', c.id, {
        token: p.token,
        typedName: c.label,
        acknowledged: true,
      });
      expect([401, 403]).toContain(r.status);
      expect(await prisma.chair.count({ where: { id: c.id } })).toBe(1);
    });
  },
);
