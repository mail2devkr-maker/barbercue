import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { PasswordService } from '../src/auth/services/password.service';

/**
 * Administrator-authorized shop owner transfer and the backend-enforced temporary-password gate.
 * Two shops share one wrong owner account (as in production issue #314): one ACTIVE, one SUSPENDED. Real AppModule,
 * guards and PostgreSQL; refuses anything but a loopback database; fixtures carry this run's tag.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const isLoopbackDatabase = /@(127\.0\.0\.1|localhost)[:/]/i.test(databaseUrl);
const describeDisposable = isLoopbackDatabase ? describe : describe.skip;

describeDisposable(
  'Owner transfer + temporary password gate (disposable PostgreSQL)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    let passwords: PasswordService;
    const run = randomUUID().slice(0, 8);
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};
    const emails = {
      studio: `studio25-${run}@example.test`,
      glam: `glamorous-${run}@example.test`,
    };

    const api = (
      method: 'get' | 'post',
      path: string,
      token?: string,
      body?: object,
    ) => {
      const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      if (method === 'post') req.set('Idempotency-Key', randomUUID());
      return body ? req.send(body) : req;
    };

    async function makeUser(
      label: string,
      role: Role | null,
      audience: SessionAudience,
      salonId: string | null = null,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `ot-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      if (role) {
        await prisma.userRole.create({
          data: { userId: user.id, role, salonId },
        });
      }
      ids[label] = user.id;
      auth[label] = tokens.signAccessToken(
        user.id,
        role ? [role] : [],
        audience,
      );
      return user;
    }

    async function makeShop(
      label: string,
      ownerId: string,
      status: SalonStatus,
      phone: string | null,
    ) {
      const city = await prisma.city.findFirstOrThrow({
        where: { slug: 'jharsuguda' },
      });
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: ownerId,
          name: `Transfer ${label} ${run}`,
          slug: `transfer-${label.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: '1 Disposable Road',
          status,
          phone,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      await prisma.userRole.create({
        data: { userId: ownerId, role: Role.SALON_OWNER, salonId: salon.id },
      });
      await prisma.service.create({
        data: {
          salonId: salon.id,
          name: `Cut ${label}`,
          durationMinutes: 30,
          price: 100,
        },
      });
      await prisma.chair.create({
        data: { salonId: salon.id, label: `Chair ${label}` },
      });
      await prisma.photo.create({
        data: {
          salonId: salon.id,
          url: `https://example.test/${label}.jpg`,
          type: 'GALLERY',
        },
      });
      const barber = await prisma.user.create({
        data: { email: `ot-${run}-barber${label}@example.test`, status: UserStatus.ACTIVE },
      });
      await prisma.salonStaff.create({
        data: {
          salonId: salon.id,
          userId: barber.id,
          displayName: `Barber ${label}`,
          roleInSalon: 'BARBER',
        },
      });
      ids[`${label}Salon`] = salon.id;
      return salon;
    }

    const counts = async (salonId: string) => ({
      staff: await prisma.salonStaff.count({ where: { salonId } }),
      services: await prisma.service.count({ where: { salonId } }),
      chairs: await prisma.chair.count({ where: { salonId } }),
      photos: await prisma.photo.count({ where: { salonId } }),
    });
    const salonRow = (label: string) =>
      prisma.salon.findUniqueOrThrow({ where: { id: ids[`${label}Salon`] } });
    const prepare = (label: string, email: string, token = auth.admin1) =>
      api('post', `admin/salons/${ids[`${label}Salon`]}/owner-transfers`, token, {
        newEmail: email,
      });
    const verify = (id: string, body: object, token = auth.admin2) =>
      api('post', `admin/owner-transfers/${id}/verify`, token, body);
    const execute = (id: string, token = auth.admin1) =>
      api('post', `admin/owner-transfers/${id}/execute`, token);
    const OFFLINE = {
      method: 'OFFLINE_DOCUMENT',
      reference: 'Checked photo ID in person at the shop; matches the registered owner name.',
    };

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      prisma = app.get(PrismaService);
      tokens = app.get(TokenService);
      passwords = app.get(PasswordService);

      await makeUser('admin1', Role.PLATFORM_ADMIN, SessionAudience.ADMIN);
      await makeUser('admin2', Role.PLATFORM_ADMIN, SessionAudience.ADMIN);
      await makeUser('customer', null, SessionAudience.CUSTOMER);
      const shared = await makeUser('shared', null, SessionAudience.STAFF);
      await makeShop('Studio', shared.id, SalonStatus.SUSPENDED, '+91 98765 43210');
      await makeShop('Glam', shared.id, SalonStatus.ACTIVE, null);
      auth.shared = tokens.signAccessToken(shared.id, [Role.SALON_OWNER], SessionAudience.STAFF);
      await prisma.refreshToken.create({
        data: {
          userId: shared.id,
          tokenHash: `hash-${run}`,
          audience: SessionAudience.STAFF,
          expiresAt: new Date(Date.now() + 86_400_000),
        } as never,
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('only platform administrators can use the transfer endpoints', async () => {
      for (const who of ['shared', 'customer']) {
        const res = await prepare('Studio', emails.studio, auth[who]);
        expect(res.status).toBe(403);
      }
      expect((await prepare('Studio', emails.studio, '')).status).toBe(401);
    });

    let studioTransfer = '';
    it('prepares a transfer once per shop and refuses an e-mail that already has an account', async () => {
      const res = await prepare('Studio', emails.studio);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PREPARED', newEmail: emails.studio });
      studioTransfer = res.body.id;
      expect((await prepare('Studio', `other-${run}@example.test`)).status).toBe(409);
      const used = await prepare('Glam', `ot-${run}-shared@example.test`);
      expect(used.status).toBe(409);
      expect(used.body.error.code).toBe('OWNER_TRANSFER_EMAIL_IN_USE');
    });

    it('cannot be executed before the owner is verified', async () => {
      const res = await execute(studioTransfer);
      expect(res.status).toBe(409);
      expect(await prisma.user.count({ where: { email: emails.studio } })).toBe(0);
    });

    it('needs an independent administrator and a real check: same admin, wrong or missing phone are refused', async () => {
      const same = await verify(studioTransfer, OFFLINE, auth.admin1);
      expect(same.status).toBe(403);
      expect(same.body.error.code).toBe('OWNER_TRANSFER_NOT_INDEPENDENT');
      const short = await verify(studioTransfer, { ...OFFLINE, reference: 'ok' });
      expect(short.status).toBe(400);
      const wrongPhone = await verify(studioTransfer, {
        method: 'REGISTERED_PHONE_CALLBACK',
        reference: 'Called the number on file, owner confirmed by name.',
        registeredPhoneLast4: '0000',
      });
      expect(wrongPhone.status).toBe(422);
      expect(wrongPhone.body.error.code).toBe('OWNER_TRANSFER_PHONE_MISMATCH');
      const noRegisteredPhone = await prepare('Glam', emails.glam);
      expect(noRegisteredPhone.status).toBe(201);
      ids.glamTransfer = noRegisteredPhone.body.id;
      const unverifiable = await verify(ids.glamTransfer, {
        method: 'REGISTERED_PHONE_CALLBACK',
        reference: 'Called the number on file, owner confirmed by name.',
        registeredPhoneLast4: '3210',
      });
      expect(unverifiable.status).toBe(422);
      expect(unverifiable.body.error.code).toBe('OWNER_TRANSFER_PHONE_UNVERIFIABLE');
    });

    let temporaryPassword = '';
    let studioNewOwner = '';
    it('moves only the owner link: shop, status, staff, services, chairs and photos are untouched', async () => {
      const before = await counts(ids.StudioSalon);
      const ok = await verify(studioTransfer, {
        method: 'REGISTERED_PHONE_CALLBACK',
        reference: 'Called the number on file, owner confirmed by name.',
        registeredPhoneLast4: '3210',
      });
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('VERIFIED');

      const done = await execute(studioTransfer);
      expect(done.status).toBe(201);
      expect(done.headers['cache-control']).toContain('no-store');
      expect(done.body.status).toBe('COMPLETED');
      temporaryPassword = done.body.temporaryPassword;
      studioNewOwner = done.body.newOwnerUserId;
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){3}$/);

      const salon = await salonRow('Studio');
      expect(salon.ownerUserId).toBe(studioNewOwner);
      expect(salon.status).toBe('SUSPENDED');
      expect(await counts(ids.StudioSalon)).toEqual(before);

      const roles = await prisma.userRole.findMany({ where: { salonId: ids.StudioSalon } });
      expect(roles.map((r) => `${r.userId}:${r.role}`)).toEqual([`${studioNewOwner}:SALON_OWNER`]);
      // the former account keeps the OTHER shop until that one is transferred too
      const sharedRoles = await prisma.userRole.findMany({ where: { userId: ids.shared } });
      expect(sharedRoles.map((r) => r.salonId)).toEqual([ids.GlamSalon]);
      expect((await salonRow('Glam')).ownerUserId).toBe(ids.shared);
      expect(
        await prisma.refreshToken.count({ where: { userId: ids.shared, revokedAt: null } }),
      ).toBe(0);
    });

    it('stores no plaintext: only a hash, a flagged account, audit rows without the password, and it completes once', async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: studioNewOwner } });
      expect(user.passwordHash).not.toBe(temporaryPassword);
      expect(await passwords.compare(temporaryPassword, user.passwordHash as string)).toBe(true);
      expect(user.passwordChangeRequired).toBe(true);
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.temporaryPasswordExpiresAt!.getTime()).toBeGreaterThan(Date.now());

      const audit = await prisma.auditLog.findMany({ where: { entityId: studioTransfer } });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'SALON_OWNER_TRANSFER_COMPLETED',
        'SALON_OWNER_TRANSFER_PREPARED',
        'SALON_OWNER_TRANSFER_VERIFIED',
      ]);
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
      expect((await execute(studioTransfer)).status).toBe(409);
    });

    it('the former shared account is denied the transferred shop immediately, but not the one still pending', async () => {
      const photos = (label: string) => `dashboard/salons/${ids[`${label}Salon`]}/photos`;
      expect((await api('get', photos('Studio'), auth.shared)).status).toBe(403);
      expect((await api('get', photos('Glam'), auth.shared)).status).toBe(200);
    });

    it('a temporary password signs in but is useless for anything except changing it', async () => {
      const login = await api('post', 'auth/staff/login', undefined, {
        email: emails.studio,
        password: temporaryPassword,
      });
      expect(login.status).toBe(201);
      const token = login.body.tokens?.accessToken ?? login.body.accessToken;
      expect(token).toBeTruthy();

      const photos = await api('get', `dashboard/salons/${ids.StudioSalon}/photos`, token);
      expect(photos.status).toBe(403);
      expect(photos.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await api('get', 'auth/me', token)).status).toBe(200);

      const wrong = await api('post', 'auth/password/change-required', token, {
        currentPassword: 'not-the-temporary-one',
        newPassword: 'A-brand-new-Passw0rd',
      });
      expect(wrong.status).toBe(401);
      const same = await api('post', 'auth/password/change-required', token, {
        currentPassword: temporaryPassword,
        newPassword: temporaryPassword,
      });
      expect(same.status).toBe(400);
      const changed = await api('post', 'auth/password/change-required', token, {
        currentPassword: temporaryPassword,
        newPassword: 'A-brand-new-Passw0rd',
      });
      expect(changed.status).toBe(200);

      // the temporary credential is dead and the old session cannot be refreshed
      expect(
        (await api('post', 'auth/staff/login', undefined, { email: emails.studio, password: temporaryPassword })).status,
      ).toBe(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: studioNewOwner } });
      expect(user.passwordChangeRequired).toBe(false);
      expect(user.temporaryPasswordExpiresAt).toBeNull();

      const again = await api('post', 'auth/staff/login', undefined, {
        email: emails.studio,
        password: 'A-brand-new-Passw0rd',
      });
      expect(again.status).toBe(201);
      const fresh = again.body.tokens?.accessToken ?? again.body.accessToken;
      expect((await api('get', `dashboard/salons/${ids.StudioSalon}/photos`, fresh)).status).toBe(200);
      // a second change is not available to an account that is not in the temporary state
      expect(
        (await api('post', 'auth/password/change-required', fresh, {
          currentPassword: 'A-brand-new-Passw0rd',
          newPassword: 'Another-Passw0rd-1',
        })).status,
      ).toBe(409);
    });

    it('an expired temporary password no longer signs in', async () => {
      const verified = await verify(ids.glamTransfer, OFFLINE);
      expect(verified.status).toBe(201);
      const done = await execute(ids.glamTransfer);
      expect(done.status).toBe(201);
      await prisma.user.update({
        where: { id: done.body.newOwnerUserId },
        data: { temporaryPasswordExpiresAt: new Date(Date.now() - 1000) },
      });
      const login = await api('post', 'auth/staff/login', undefined, {
        email: emails.glam,
        password: done.body.temporaryPassword,
      });
      expect(login.status).toBe(401);
      // and after both transfers the former shared account holds no owner role at all
      expect(await prisma.userRole.count({ where: { userId: ids.shared } })).toBe(0);
      expect((await salonRow('Glam')).status).toBe('ACTIVE');
    });

    it('a transfer can be cancelled before completion, and the database refuses inconsistent rows', async () => {
      const spare = await makeShop('Spare', ids.admin1, SalonStatus.ACTIVE, null);
      void spare;
      const made = await prepare('Spare', `spare-${run}@example.test`);
      expect(made.status).toBe(201);
      const cancelled = await api('post', `admin/owner-transfers/${made.body.id}/cancel`, auth.admin1);
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await execute(made.body.id)).status).toBe(409);
      await expect(
        prisma.salonOwnerTransfer.create({
          data: {
            salonId: ids.SpareSalon,
            fromUserId: ids.admin1,
            newEmail: `bad-${run}@example.test`,
            status: 'COMPLETED',
            openSlot: null,
            completedAt: new Date(),
            preparedByAdminId: ids.admin1,
          },
        }),
      ).rejects.toThrow();
    });
  },
);
