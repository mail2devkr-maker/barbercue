import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
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
import { EMAIL_SENDER } from '../src/auth/services/email-sender';

/**
 * Administrator-authorized shop owner transfer, accepted by the holder of the destination inbox, plus the
 * backend-enforced password-change gate. Two shops share one wrong owner account (issue #314): one ACTIVE, one
 * SUSPENDED. Real AppModule, guards and PostgreSQL; the e-mail transport is replaced by a capture so the test can play
 * the part of the recipient. Refuses anything but a loopback database; fixtures carry this run's tag.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const isLoopbackDatabase = /@(127\.0\.0\.1|localhost)[:/]/i.test(databaseUrl);
const describeDisposable = isLoopbackDatabase ? describe : describe.skip;

describeDisposable(
  'Owner transfer by emailed acceptance + password-change gate (disposable PostgreSQL)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokens: TokenService;
    let passwords: PasswordService;
    const run = randomUUID().slice(0, 8);
    const ids: Record<string, string> = {};
    const auth: Record<string, string> = {};
    const sent: Array<{ email: string; url: string }> = [];
    let failNextSend = false;
    let holdNextSend: { release: Promise<void>; fail: boolean; started: () => void } | null = null;
    const emails = {
      studio: `studio25-${run}@example.test`,
      glam: `glamorous-${run}@example.test`,
    };
    const NEW_PASSWORD = 'My-Own-Passw0rd!';

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
      verified = true,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `ot-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: verified ? new Date() : null,
        },
      });
      if (role) {
        await prisma.userRole.create({ data: { userId: user.id, role } });
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
        data: {
          email: `ot-${run}-barber${label}@example.test`,
          status: UserStatus.ACTIVE,
        },
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

    /** Row count of every table that carries a salonId, except the ones an ownership change legitimately touches. */
    async function snapshot(label: string) {
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'salonId'
          AND table_name NOT IN ('user_roles', 'salon_owner_transfers')
        ORDER BY table_name`;
      const out: Record<string, number> = {};
      for (const { table_name } of tables) {
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*)::bigint AS n FROM "${table_name}" WHERE "salonId" = $1`,
          ids[`${label}Salon`],
        );
        out[table_name] = Number(rows[0].n);
      }
      return out;
    }

    const salonRow = (label: string) =>
      prisma.salon.findUniqueOrThrow({ where: { id: ids[`${label}Salon`] } });
    const prepare = (label: string, email: string, token = auth.admin1) =>
      api('post', `admin/salons/${ids[`${label}Salon`]}/owner-transfers`, token, {
        newEmail: email,
      });
    const verify = (id: string, body: object, token = auth.admin2) =>
      api('post', `admin/owner-transfers/${id}/verify`, token, body);
    const invite = (id: string, body: object = {}, token = auth.admin1) =>
      api('post', `admin/owner-transfers/${id}/invite`, token, body);
    const inspect = (token: string) =>
      api('post', 'auth/owner-invitations/inspect', undefined, { token });
    const accept = (token: string, password?: string) =>
      api('post', 'auth/owner-invitations/accept', undefined, {
        token,
        ...(password ? { password } : {}),
      });
    const lastToken = () => {
      const url = new URL(sent[sent.length - 1].url);
      expect(url.search).toBe(''); // never in the query string
      return url.hash.replace(/^#t=/, '');
    };
    const EVIDENCE = {
      evidence: ['GOVERNMENT_ID', 'BUSINESS_OR_SHOP_PROOF', 'REGISTERED_PHONE_CALLBACK'],
      reference:
        'Admin B met the person at the shop, saw photo ID and the shop licence in the owner name.',
    };
    const photosPath = (label: string) =>
      `dashboard/salons/${ids[`${label}Salon`]}/photos`;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        // The suite makes far more public calls than a person would; the real limiter has its own test below.
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
        .overrideProvider(EMAIL_SENDER)
        .useValue({
          assertAvailable: () => undefined,
          sendPasswordReset: async () => undefined,
          sendStaffInvitation: async () => undefined,
          sendOwnerTransferInvitation: async (email: string, url: string) => {
            if (failNextSend) {
              failNextSend = false;
              throw new Error('transport down');
            }
            if (holdNextSend) {
              const hold = holdNextSend;
              holdNextSend = null;
              hold.started();
              await hold.release;
              if (hold.fail) throw new Error('provider timed out');
            }
            sent.push({ email, url });
          },
        })
        .compile();
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
      auth.shared = tokens.signAccessToken(
        shared.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
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
        expect((await prepare('Studio', emails.studio, auth[who])).status).toBe(403);
      }
      expect((await prepare('Studio', emails.studio, '')).status).toBe(401);
    });

    let studioTransfer = '';
    it('prepares one transfer per shop and refuses unsafe destinations', async () => {
      const res = await prepare('Studio', emails.studio);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PREPARED', newEmail: emails.studio });
      studioTransfer = res.body.id;
      expect((await prepare('Studio', `other-${run}@example.test`)).status).toBe(409);

      await makeUser('unverified', null, SessionAudience.CUSTOMER, false);
      const unverified = await prepare('Glam', `ot-${run}-unverified@example.test`);
      expect(unverified.status).toBe(409);
      expect(unverified.body.error.code).toBe('OWNER_TRANSFER_TARGET_UNVERIFIED');
      const same = await prepare('Glam', `ot-${run}-shared@example.test`);
      expect(same.status).toBe(409);
      expect(same.body.error.code).toBe('OWNER_TRANSFER_SAME_OWNER');
    });

    it('nothing can be invited before verification, and a phone callback is never enough', async () => {
      expect((await invite(studioTransfer)).status).toBe(409);
      for (const evidence of [
        ['REGISTERED_PHONE_CALLBACK', 'IN_PERSON_VISIT'],
        ['GOVERNMENT_ID', 'IN_PERSON_VISIT'],
        ['BUSINESS_OR_SHOP_PROOF', 'CURRENT_OWNER_WRITTEN_CONSENT'],
        ['REGISTERED_PHONE_CALLBACK', 'BUSINESS_OR_SHOP_PROOF'],
      ]) {
        const res = await verify(studioTransfer, { ...EVIDENCE, evidence });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('OWNER_TRANSFER_EVIDENCE_INSUFFICIENT');
      }
      expect(
        (await verify(studioTransfer, { ...EVIDENCE, evidence: ['REGISTERED_PHONE_CALLBACK'] })).status,
      ).toBe(400);
      expect((await verify(studioTransfer, { ...EVIDENCE, reference: 'ok' })).status).toBe(400);
      const same = await verify(studioTransfer, EVIDENCE, auth.admin1);
      expect(same.status).toBe(403);
      expect(same.body.error.code).toBe('OWNER_TRANSFER_NOT_INDEPENDENT');
    });

    let before: Record<string, number> = {};
    it('an administrator typing an e-mail address grants nothing: ownership stays until the recipient accepts', async () => {
      before = await snapshot('Studio');
      const ok = await verify(studioTransfer, EVIDENCE);
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('VERIFIED');
      expect(ok.body.breakGlass).toBe(false);

      const invited = await invite(studioTransfer);
      expect(invited.status).toBe(201);
      expect(invited.headers['cache-control']).toContain('no-store');
      expect(invited.body.status).toBe('INVITED');
      expect(JSON.stringify(invited.body)).not.toContain(lastToken());
      expect(sent[sent.length - 1]?.email).toBe(emails.studio);

      // nothing moved: no new account, owner unchanged, former owner keeps both shops
      expect(await prisma.user.count({ where: { email: emails.studio } })).toBe(0);
      expect((await salonRow('Studio')).ownerUserId).toBe(ids.shared);
      expect((await api('get', photosPath('Studio'), auth.shared)).status).toBe(200);
    });

    let studioNewOwner = '';
    it('the recipient previews the invitation and accepts it; only then does ownership move', async () => {
      const token = lastToken();
      const preview = await inspect(token);
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({
        shopName: `Transfer Studio ${run}`,
        email: emails.studio,
        needsPassword: true,
      });
      expect((await inspect('0'.repeat(64))).status).toBe(400);
      expect((await inspect('nope')).status).toBe(400);

      expect((await accept(token)).status).toBe(400); // password required for a new account
      expect((await accept(token, 'short')).status).toBe(400);
      expect((await salonRow('Studio')).ownerUserId).toBe(ids.shared);

      const done = await accept(token, NEW_PASSWORD);
      expect(done.status).toBe(200);
      expect(done.headers['cache-control']).toContain('no-store');
      const salon = await salonRow('Studio');
      studioNewOwner = salon.ownerUserId;
      expect(studioNewOwner).not.toBe(ids.shared);
      expect(salon.status).toBe('SUSPENDED');
      expect(await snapshot('Studio')).toEqual(before);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: studioNewOwner } });
      expect(user.email).toBe(emails.studio);
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.passwordHash).not.toBe(NEW_PASSWORD);
      expect(await passwords.compare(NEW_PASSWORD, user.passwordHash as string)).toBe(true);

      const roles = await prisma.userRole.findMany({ where: { salonId: ids.StudioSalon } });
      expect(roles.map((r) => `${r.userId}:${r.role}`)).toEqual([`${studioNewOwner}:SALON_OWNER`]);
      const sharedRoles = await prisma.userRole.findMany({ where: { userId: ids.shared } });
      expect(sharedRoles.map((r) => r.salonId)).toEqual([ids.GlamSalon]);
      expect((await salonRow('Glam')).ownerUserId).toBe(ids.shared);
      expect(
        await prisma.refreshToken.count({ where: { userId: ids.shared, revokedAt: null } }),
      ).toBe(0);
    });

    it('the link works once, nothing secret is stored or audited, and the other shop is untouched', async () => {
      const used = lastToken();
      expect((await accept(used, NEW_PASSWORD)).status).toBe(400);
      expect((await inspect(used)).status).toBe(400);
      const transfer = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: studioTransfer } });
      expect(transfer.status).toBe('COMPLETED');
      expect(transfer.invitationTokenHash).toBeNull();
      expect(transfer.openSlot).toBeNull();
      const audit = await prisma.auditLog.findMany({ where: { entityId: studioTransfer } });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'SALON_OWNER_TRANSFER_COMPLETED',
        'SALON_OWNER_TRANSFER_INVITED',
        'SALON_OWNER_TRANSFER_PREPARED',
        'SALON_OWNER_TRANSFER_VERIFIED',
      ]);
      const text = JSON.stringify(audit);
      expect(text).not.toContain(used);
      expect(text).not.toContain(NEW_PASSWORD);
      // the old shared account lost Studio at once but keeps the pending shop; old access tokens cannot reach Studio
      expect((await api('get', photosPath('Studio'), auth.shared)).status).toBe(403);
      expect((await api('get', photosPath('Glam'), auth.shared)).status).toBe(200);
    });

    it('the new owner signs in with the password they chose and reaches only their own shop', async () => {
      const login = await api('post', 'auth/staff/login', undefined, {
        email: emails.studio,
        password: NEW_PASSWORD,
      });
      expect(login.status).toBe(201);
      const token = login.body.tokens?.accessToken ?? login.body.accessToken;
      expect((await api('get', photosPath('Studio'), token)).status).toBe(200);
      expect((await api('get', photosPath('Glam'), token)).status).toBe(403);
      auth.studioOwner = token;
    });

    it('expired invitation recovery: re-send without a second account, limited, reasoned and one live link at a time', async () => {
      const t = await prepare('Glam', emails.glam);
      expect(t.status).toBe(201);
      ids.glamTransfer = t.body.id;
      expect((await verify(ids.glamTransfer, EVIDENCE)).status).toBe(201);
      expect((await invite(ids.glamTransfer)).status).toBe(201);
      const first = lastToken();
      // not expired yet: cannot re-send
      expect((await invite(ids.glamTransfer, { reference: 'recipient re-confirmed by phone' })).status).toBe(409);

      const expire = (extra: object = {}) =>
        prisma.salonOwnerTransfer.update({
          where: { id: ids.glamTransfer },
          data: {
            invitationExpiresAt: new Date(Date.now() - 1000),
            lastInvitedAt: new Date(Date.now() - 20 * 60_000),
            ...extra,
          },
        });
      await expire();
      expect((await accept(first, NEW_PASSWORD)).status).toBe(400);
      expect((await inspect(first)).status).toBe(400);
      expect((await invite(ids.glamTransfer)).status).toBe(422); // a written reason is required

      await prisma.salonOwnerTransfer.update({
        where: { id: ids.glamTransfer },
        data: { lastInvitedAt: new Date() },
      });
      const tooSoon = await invite(ids.glamTransfer, { reference: 'recipient re-confirmed by phone' });
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.body.error.code).toBe('OWNER_TRANSFER_TOO_SOON');
      await expire();

      failNextSend = true;
      const failed = await invite(ids.glamTransfer, { reference: 'recipient re-confirmed by phone' });
      expect(failed.status).toBe(502);
      const afterFailure = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: ids.glamTransfer } });
      // uncertain delivery: the attempt counts and its link is dead, whether or not the message arrived
      expect(afterFailure.invitationCount).toBe(2);
      expect(afterFailure.status).toBe('INVITED');
      expect(afterFailure.invitationTokenHash).toBeNull();
      expect(failed.body.error.code).toBe('OWNER_INVITATION_DELIVERY_FAILED');
      await prisma.salonOwnerTransfer.update({
        where: { id: ids.glamTransfer },
        data: { lastInvitedAt: new Date(Date.now() - 20 * 60_000) },
      });

      const again = await invite(ids.glamTransfer, { reference: 'recipient re-confirmed by phone' });
      expect(again.status).toBe(201);
      expect(again.body.invitationCount).toBe(3);
      const second = lastToken();
      expect(second).not.toBe(first);
      expect((await accept(first, NEW_PASSWORD)).status).toBe(400); // the older link is dead

      await expire();
      const capped = await invite(ids.glamTransfer, { reference: 'recipient re-confirmed by phone' });
      expect(capped.status).toBe(429);
      expect(capped.body.error.code).toBe('OWNER_TRANSFER_INVITATION_LIMIT');
      // an administrator can still finish by re-confirming, within the limit
      await prisma.salonOwnerTransfer.update({
        where: { id: ids.glamTransfer },
        data: { invitationExpiresAt: new Date(Date.now() + 3_600_000) },
      });
      expect((await accept(second, NEW_PASSWORD)).status).toBe(200);
      expect((await salonRow('Glam')).ownerUserId).not.toBe(ids.shared);
      expect((await salonRow('Glam')).status).toBe('ACTIVE');
      expect(await prisma.userRole.count({ where: { userId: ids.shared } })).toBe(0);
    });

    it('reversal to an existing verified account: no password change, no duplicate role, no cross-shop leakage', async () => {
      // give the old shared account the verified e-mail it already has and move Studio back to it
      const sharedEmail = `ot-${run}-shared@example.test`;
      const before2 = await snapshot('Studio');
      const t = await prepare('Studio', sharedEmail);
      expect(t.status).toBe(201);
      expect((await verify(t.body.id, EVIDENCE)).status).toBe(201);
      expect((await invite(t.body.id)).status).toBe(201);
      const token = lastToken();
      expect((await inspect(token)).body.needsPassword).toBe(false);
      const passwordBefore = (await prisma.user.findUniqueOrThrow({ where: { id: ids.shared } })).passwordHash;
      expect((await accept(token)).status).toBe(200);

      expect((await salonRow('Studio')).ownerUserId).toBe(ids.shared);
      expect((await salonRow('Studio')).status).toBe('SUSPENDED');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.shared } })).passwordHash).toBe(passwordBefore);
      const roles = await prisma.userRole.findMany({
        where: { userId: ids.shared, role: Role.SALON_OWNER },
      });
      expect(roles.map((r) => r.salonId)).toEqual([ids.StudioSalon]); // only the reversed shop, once
      expect(await prisma.userRole.count({ where: { salonId: ids.StudioSalon } })).toBe(1);
      expect(await snapshot('Studio')).toEqual(before2);
      // the intermediate owner is cut off at once, and never held Glam
      expect((await api('get', photosPath('Studio'), auth.studioOwner)).status).toBe(403);
      expect(
        await prisma.refreshToken.count({ where: { userId: studioNewOwner, revokedAt: null } }),
      ).toBe(0);
    });

    it('break-glass: without a second administrator, a written justification and a cool-down are mandatory', async () => {
      await makeShop('Spare', ids.admin1, SalonStatus.ACTIVE, null);
      await prisma.userRole.deleteMany({ where: { salonId: ids.SpareSalon } });
      await prisma.userRole.create({
        data: { userId: ids.admin1, role: Role.SALON_OWNER, salonId: ids.SpareSalon },
      });
      const otherAdmins = await prisma.user.findMany({
        where: { roles: { some: { role: Role.PLATFORM_ADMIN } }, id: { not: ids.admin1 }, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { status: UserStatus.SUSPENDED } });
      try {
        const t = await prepare('Spare', `spare-${run}@example.test`);
        expect(t.status).toBe(201);
        const none = await verify(t.body.id, EVIDENCE, auth.admin1);
        expect(none.status).toBe(422);
        expect(none.body.error.code).toBe('OWNER_TRANSFER_BREAK_GLASS_REQUIRED');
        const ok = await verify(
          t.body.id,
          {
            ...EVIDENCE,
            breakGlassJustification:
              'Only one administrator exists; the second administrator is unavailable for two weeks and the owner is travelling.',
          },
          auth.admin1,
        );
        expect(ok.status).toBe(201);
        expect(ok.body.breakGlass).toBe(true);
        expect(new Date(ok.body.inviteNotBefore).getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
        const cooling = await invite(t.body.id);
        expect(cooling.status).toBe(409);
        expect(cooling.body.error.code).toBe('OWNER_TRANSFER_COOLING_DOWN');
        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { entityId: t.body.id, action: 'SALON_OWNER_TRANSFER_VERIFIED' },
        });
        expect(JSON.stringify(audit.metadata)).toContain('"breakGlass":true');
        await prisma.salonOwnerTransfer.update({ where: { id: t.body.id }, data: { inviteNotBefore: new Date() } });
        expect((await invite(t.body.id)).status).toBe(201);
        // cancelling kills the live link
        const token = lastToken();
        expect((await api('post', `admin/owner-transfers/${t.body.id}/cancel`, auth.admin1)).status).toBe(201);
        expect((await accept(token, NEW_PASSWORD)).status).toBe(400);
        expect((await salonRow('Spare')).ownerUserId).toBe(ids.admin1);
      } finally {
        await prisma.user.updateMany({ where: { id: { in: otherAdmins.map((u) => u.id) } }, data: { status: UserStatus.ACTIVE } });
      }
    });

    it('an account an administrator flags may do nothing but change its temporary password', async () => {
      const temporary = 'Temp-Passw0rd-1';
      const flagged = await prisma.user.create({
        data: {
          email: `flagged-${run}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          passwordHash: await passwords.hash(temporary),
          passwordChangeRequired: true,
          temporaryPasswordExpiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.userRole.create({
        data: { userId: flagged.id, role: Role.SALON_OWNER, salonId: ids.SpareSalon },
      });
      const login = await api('post', 'auth/staff/login', undefined, {
        email: flagged.email,
        password: temporary,
      });
      expect(login.status).toBe(201);
      const token = login.body.tokens?.accessToken ?? login.body.accessToken;
      const blocked = await api('get', photosPath('Spare'), token);
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await api('get', 'auth/me', token)).status).toBe(200);
      expect(
        (await api('post', 'auth/password/change-required', token, {
          currentPassword: 'wrong',
          newPassword: 'A-brand-new-Passw0rd',
        })).status,
      ).toBe(401);
      expect(
        (await api('post', 'auth/password/change-required', token, {
          currentPassword: temporary,
          newPassword: 'A-brand-new-Passw0rd',
        })).status,
      ).toBe(200);
      expect(
        (await api('post', 'auth/staff/login', undefined, { email: flagged.email, password: temporary })).status,
      ).toBe(401);
      const again = await api('post', 'auth/staff/login', undefined, {
        email: flagged.email,
        password: 'A-brand-new-Passw0rd',
      });
      expect(again.status).toBe(201);
      await prisma.user.update({
        where: { id: flagged.id },
        data: { passwordChangeRequired: true, temporaryPasswordExpiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await api('post', 'auth/staff/login', undefined, { email: flagged.email, password: 'A-brand-new-Passw0rd' })).status,
      ).toBe(401); // an expired temporary state cannot sign in
    });

    async function verifiedTransfer(label: string) {
      const owner = await makeUser(`${label}Owner`, null, SessionAudience.STAFF);
      await makeShop(label, owner.id, SalonStatus.ACTIVE, null);
      const t = await prepare(label, `${label.toLowerCase()}-${run}@example.test`);
      expect(t.status).toBe(201);
      expect((await verify(t.body.id, EVIDENCE)).status).toBe(201);
      return { id: t.body.id as string, email: `${label.toLowerCase()}-${run}@example.test`, owner: owner.id };
    }

    it('two simultaneous acceptances of one link: exactly one wins, one owner role, one account', async () => {
      const t = await verifiedTransfer('Race');
      expect((await invite(t.id)).status).toBe(201);
      const token = lastToken();
      const results = await Promise.all([accept(token, NEW_PASSWORD), accept(token, NEW_PASSWORD)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await prisma.user.count({ where: { email: t.email } })).toBe(1);
      expect(await prisma.userRole.count({ where: { salonId: ids.RaceSalon } })).toBe(1);
      expect((await salonRow('Race')).ownerUserId).not.toBe(t.owner);
    });

    it('two simultaneous first invitations send exactly one e-mail and one live link', async () => {
      const t = await verifiedTransfer('Race2');
      const before = sent.length;
      const results = await Promise.all([invite(t.id), invite(t.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(sent.length - before).toBe(1);
      const row = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.invitationCount).toBe(1);
      expect((await accept(lastToken(), NEW_PASSWORD)).status).toBe(200);
    });

    it('a resend racing a cancel never leaves a usable link behind', async () => {
      for (const label of ['Race3', 'Race4', 'Race5']) {
        const t = await verifiedTransfer(label);
        expect((await invite(t.id)).status).toBe(201);
        const first = lastToken();
        await prisma.salonOwnerTransfer.update({
          where: { id: t.id },
          data: {
            invitationExpiresAt: new Date(Date.now() - 1000),
            lastInvitedAt: new Date(Date.now() - 20 * 60_000),
          },
        });
        const before = sent.length;
        const [reinvite, cancel] = await Promise.all([
          invite(t.id, { reference: 'recipient re-confirmed by phone' }),
          api('post', `admin/owner-transfers/${t.id}/cancel`, auth.admin1),
        ]);
        const row = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: t.id } });
        expect([201, 409]).toContain(reinvite.status);
        expect([201, 404]).toContain(cancel.status);
        if (row.status === 'CANCELLED') {
          expect(row.invitationTokenHash).toBeNull();
          expect(row.openSlot).toBeNull();
          if (sent.length > before) expect((await accept(lastToken(), NEW_PASSWORD)).status).toBe(400);
          expect((await salonRow(label)).ownerUserId).toBe(t.owner);
        } else {
          expect(row.status).toBe('INVITED');
          expect(cancel.status).toBe(404);
        }
        expect((await accept(first, NEW_PASSWORD)).status).toBe(400); // the earlier link is dead either way
      }
    });

    it('an uncertain e-mail outcome invalidates the link, keeps the attempt count, and cannot resurrect a cancelled transfer', async () => {
      const t = await verifiedTransfer('Race6');
      failNextSend = true;
      const failed = await invite(t.id);
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('OWNER_INVITATION_DELIVERY_FAILED');
      let row = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: t.id } });
      expect([row.status, row.invitationCount, row.invitationTokenHash]).toEqual(['INVITED', 1, null]);
      expect(row.invitationExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
      const soon = await invite(t.id, { reference: 'recipient re-confirmed by phone' });
      expect(soon.status).toBe(429);
      expect(soon.body.error.code).toBe('OWNER_TRANSFER_TOO_SOON');
      await prisma.salonOwnerTransfer.update({
        where: { id: t.id },
        data: { lastInvitedAt: new Date(Date.now() - 20 * 60_000) },
      });
      expect((await invite(t.id, { reference: 'recipient re-confirmed by phone' })).status).toBe(201);

      // cancel arrives while the provider call is still in flight, then the provider times out
      const u = await verifiedTransfer('Race7');
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      let release!: () => void;
      holdNextSend = { release: new Promise<void>((resolve) => { release = resolve; }), fail: true, started };
      // supertest requests are lazy; .then() is what actually sends this one
      const pending = invite(u.id).then((res) => res);
      await startedPromise;
      expect((await api('post', `admin/owner-transfers/${u.id}/cancel`, auth.admin1)).status).toBe(201);
      release();
      expect((await pending).status).toBe(502);
      row = await prisma.salonOwnerTransfer.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.status).toBe('CANCELLED');
      expect(row.openSlot).toBeNull();
      expect(row.invitationTokenHash).toBeNull();
    });

    it('a delivered invitation cannot be accepted after the same transfer was re-invited (duplicate delivery)', async () => {
      const t = await verifiedTransfer('Race8');
      expect((await invite(t.id)).status).toBe(201);
      const first = lastToken();
      await prisma.salonOwnerTransfer.update({
        where: { id: t.id },
        data: { invitationExpiresAt: new Date(Date.now() - 1000), lastInvitedAt: new Date(Date.now() - 20 * 60_000) },
      });
      expect((await invite(t.id, { reference: 'recipient re-confirmed by phone' })).status).toBe(201);
      const second = lastToken();
      expect((await inspect(first)).status).toBe(400);
      expect((await accept(first, NEW_PASSWORD)).status).toBe(400);
      expect((await accept(second, NEW_PASSWORD)).status).toBe(200);
    });

    it('the public invitation endpoints are rate limited (real limiter)', async () => {
      const real = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EMAIL_SENDER)
        .useValue({ assertAvailable: () => undefined, sendOwnerTransferInvitation: async () => undefined })
        .compile();
      const limited = real.createNestApplication<INestApplication<App>>();
      limited.setGlobalPrefix('api/v1');
      limited.useGlobalFilters(new AllExceptionsFilter());
      await limited.init();
      try {
        const codes: number[] = [];
        for (let i = 0; i < 12; i += 1) {
          const res = await request(limited.getHttpServer())
            .post('/api/v1/auth/owner-invitations/inspect')
            .send({ token: '0'.repeat(64) });
          codes.push(res.status);
        }
        expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true);
        expect(codes.slice(10)).toEqual([429, 429]);
      } finally {
        await limited.close();
      }
    });

    it('the database itself refuses inconsistent transfer rows', async () => {
      const base = {
        salonId: ids.SpareSalon,
        fromUserId: ids.admin1,
        newEmail: `bad-${run}@example.test`,
        preparedByAdminId: ids.admin1,
      };
      // verified without authority evidence
      await expect(
        prisma.salonOwnerTransfer.create({
          data: {
            ...base,
            status: 'VERIFIED',
            openSlot: 1,
            verificationEvidence: ['GOVERNMENT_ID', 'REGISTERED_PHONE_CALLBACK'],
            verificationReference: 'x'.repeat(30),
            verifiedByAdminId: ids.admin2,
            verifiedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      // completed without a recipient
      await expect(
        prisma.salonOwnerTransfer.create({
          data: { ...base, status: 'COMPLETED', openSlot: null, completedAt: new Date() },
        }),
      ).rejects.toThrow();
      // more than three invitations
      await expect(
        prisma.salonOwnerTransfer.create({
          data: { ...base, status: 'PREPARED', openSlot: 1, invitationCount: 4 },
        }),
      ).rejects.toThrow();
    });
  },
);
