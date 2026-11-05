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
 * PR #382 on a DISPOSABLE database: Co-Founder "Manage" opens a shop's real Owner Dashboard.
 * A Co-Founder in a TOTP-verified ADMIN session can read every Owner Dashboard area of any shop;
 * nobody else gains anything: the same person without an ADMIN session, another owner, staff and
 * customers are refused, Co-Founder cannot permanently delete chairs/staff (owner / Super Admin
 * only) and the legacy one-click shop hard delete fails closed for everyone.
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
  'Co-Founder delegated shop management (#382, disposable database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    const run = randomUUID().slice(0, 8);
    const tok: Record<string, string> = {};
    const ids: Record<string, string> = {};

    const get = (who: string, path: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${tok[who]}`);

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
      const mk = async (
        label: string,
        roles: Array<[Role, string | null]>,
        audience: SessionAudience,
      ) => {
        const u = await prisma.user.create({
          data: {
            email: `cf382-${run}-${label}@example.test`,
            emailVerifiedAt: new Date(),
            status: UserStatus.ACTIVE,
          },
        });
        for (const [role, salonId] of roles)
          await prisma.userRole.create({
            data: { userId: u.id, role, salonId },
          });
        tok[label] = tokens.signAccessToken(
          u.id,
          roles.map(([r]) => r),
          audience,
        );
        ids[label] = u.id;
        return u;
      };
      const city = await prisma.city.create({
        data: {
          name: `CF ${run}`,
          slug: `cf-${run}`,
          state: 'Synthetic',
          country: 'India',
          countryCode: 'IN',
        },
      });
      for (const key of ['A', 'B']) {
        const owner = await prisma.user.create({
          data: {
            email: `cf382-${run}-owner${key}@example.test`,
            emailVerifiedAt: new Date(),
            status: UserStatus.ACTIVE,
          },
        });
        const s = await prisma.salon.create({
          data: {
            ownerUserId: owner.id,
            name: `CF Shop ${key} ${run}`,
            slug: `cf-${key}-${run}`,
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
        tok[`owner${key}`] = tokens.signAccessToken(
          owner.id,
          [Role.SALON_OWNER],
          SessionAudience.STAFF,
        );
        ids[`shop${key}`] = s.id;
      }
      ids.chairA = (
        await prisma.chair.create({
          data: { salonId: ids.shopA, label: 'Chair 1' },
        })
      ).id;
      await mk('cofounder', [[Role.CO_FOUNDER, null]], SessionAudience.ADMIN);
      // The same kind of person, but signed in without the TOTP admin session.
      tok.cofounderNoTotp = tokens.signAccessToken(
        ids.cofounder,
        [Role.CO_FOUNDER],
        SessionAudience.STAFF,
      );
      await mk(
        'staffA',
        [[Role.SALON_STAFF, ids.shopA]],
        SessionAudience.STAFF,
      );
      await mk('customer', [[Role.CUSTOMER, null]], SessionAudience.CUSTOMER);
    });

    afterAll(async () => {
      await app?.close();
    });

    const AREAS = [
      (s: string) => `dashboard/salons/${s}/overview`,
      (s: string) => `dashboard/salons/${s}/queue`,
      (s: string) => `dashboard/salons/${s}/capacity`,
      (s: string) => `dashboard/salons/${s}/bookings`,
      (s: string) => `dashboard/salons/${s}/analytics`,
      (s: string) => `dashboard/salons/${s}/customers`,
      (s: string) => `dashboard/salons/${s}/reviews`,
        (s: string) => `dashboard/salons/${s}/services`,
      (s: string) => `dashboard/salons/${s}/chairs`,
      (s: string) => `dashboard/salons/${s}/staff`,
    ];

    it('a Co-Founder in an ADMIN (TOTP) session opens every Owner Dashboard area of any shop', async () => {
      for (const shop of [ids.shopA, ids.shopB])
        for (const area of AREAS) {
          const r = await get('cofounder', area(shop));
          expect([area(shop), r.status]).toEqual([area(shop), 200]);
        }
    });

    it('the same Co-Founder WITHOUT an admin session gets nothing', async () => {
      for (const area of AREAS)
        expect((await get('cofounderNoTotp', area(ids.shopA))).status).toBe(
          403,
        );
    });

    it("an owner still cannot open another owner's shop; staff and customers stay out of owner areas", async () => {
      for (const area of AREAS) {
        expect([
          area(ids.shopB),
          (await get('ownerA', area(ids.shopB))).status,
        ]).not.toEqual([area(ids.shopB), 200]);
        expect((await get('customer', area(ids.shopA))).status).toBe(403);
      }
      expect(
        (await get('staffA', `dashboard/salons/${ids.shopA}/analytics`)).status,
      ).toBe(403);
      expect(
        (await get('ownerA', `dashboard/salons/${ids.shopA}/analytics`)).status,
      ).toBe(200);
    });

    it('Co-Founder is not Super Admin: no permanent chair deletion, no admin approvals', async () => {
      const r = await request(app.getHttpServer())
        .post(
          `/api/v1/dashboard/salons/${ids.shopA}/chairs/${ids.chairA}/deletion-preview`,
        )
        .set('Authorization', `Bearer ${tok.cofounder}`);
      expect(r.status).toBe(403);
      expect(await prisma.chair.count({ where: { id: ids.chairA } })).toBe(1);
    });

    it('the legacy one-click shop hard delete fails closed for every actor and deletes nothing', async () => {
      for (const who of ['cofounder', 'ownerA', 'customer']) {
        const r = await request(app.getHttpServer())
          .delete(`/api/v1/admin/shops/${ids.shopB}`)
          .set('Authorization', `Bearer ${tok[who]}`);
        expect(r.status).not.toBe(200);
        expect(r.status).not.toBe(204);
      }
      expect(await prisma.salon.count({ where: { id: ids.shopB } })).toBe(1);
    });

    it('a suspended Co-Founder loses delegated access immediately', async () => {
      await prisma.user.update({
        where: { id: ids.cofounder },
        data: { status: UserStatus.SUSPENDED },
      });
      try {
        const r = await get(
          'cofounder',
          `dashboard/salons/${ids.shopA}/overview`,
        );
        expect([401, 403]).toContain(r.status);
      } finally {
        await prisma.user.update({
          where: { id: ids.cofounder },
          data: { status: UserStatus.ACTIVE },
        });
      }
    });
  },
);
