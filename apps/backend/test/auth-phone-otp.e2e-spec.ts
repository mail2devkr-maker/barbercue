import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  AUTH_PATHS,
  AuthErrorCode,
  DISCOVERY_PATHS,
  OtpPurpose,
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { OTP_SENDER } from '../src/auth/services/otp-sender';

/**
 * Real controller/service/Prisma/auth-guard HTTP coverage against a disposable local PostgreSQL.
 * The sender is replaced before AppModule initialization and keeps test codes in memory only.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL);
const maybe = LOCAL_DB ? describe : describe.skip;

maybe(
  'Customer and shop-owner phone OTP (e2e, disposable local database)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaService;
    let tokenService: TokenService;

    const run = randomUUID().replace(/-/g, '').slice(0, 7);
    const runDigits = String(parseInt(run, 16) % 10_000_000).padStart(7, '0');
    const phone = (n: number) =>
      `+919${runDigits}${String(n).padStart(2, '0')}`;
    const receivedCodes = new Map<string, string>();
    const fixtureUserIds = new Set<string>();
    const fixturePhones = new Set<string>();
    const fixtureSalonIds = new Set<string>();
    let ownerSalonId: string;
    let ownerId: string;
    let cityId: string;
    let onboardingCustomer:
      | { userId: string; accessToken: string; phone: string; code: string }
      | undefined;

    const fakeOtpSender = {
      sendOtp: jest.fn(async (destination: string, code: string) => {
        receivedCodes.set(destination, code);
      }),
    };

    const post = (path: string, bearer?: string) => {
      const req = request(app.getHttpServer()).post(`/api/v1/${path}`);
      if (bearer) req.set('Authorization', `Bearer ${bearer}`);
      return req;
    };

    async function requestCode(
      path: string,
      destination: string,
      bearer?: string,
    ) {
      fixturePhones.add(destination);
      const before = fakeOtpSender.sendOtp.mock.calls.length;
      await post(path, bearer).send({ phone: destination }).expect(201);
      expect(fakeOtpSender.sendOtp.mock.calls.length).toBe(before + 1);
      const code = receivedCodes.get(destination);
      expect(code).toMatch(/^\d{6}$/);
      return code as string;
    }

    beforeAll(async () => {
      process.env.NODE_ENV = 'test';
      process.env.OTP_TEST_SENDER_ENABLED = 'true';
      process.env.OTP_HASH_SECRET = randomUUID() + randomUUID();
      process.env.OTP_ALLOWED_COUNTRY_CALLING_CODES = '91';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(OTP_SENDER)
        .useValue(fakeOtpSender)
        .compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      prisma = app.get(PrismaService);
      tokenService = app.get(TokenService);

      const city = await prisma.city.findFirst({
        where: { slug: 'jharsuguda' },
        select: { id: true },
      });
      if (!city)
        throw new Error(
          'Disposable migration fixture is missing city jharsuguda.',
        );
      cityId = city.id;

      const owner = await prisma.user.create({
        data: {
          phone: phone(1),
          phoneVerifiedAt: new Date(),
          status: UserStatus.ACTIVE,
        },
      });
      ownerId = owner.id;
      fixtureUserIds.add(owner.id);
      fixturePhones.add(phone(1));
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `OTP E2E ${run}`,
          slug: `otp-e2e-${run}`,
          cityId,
          addressLine: 'Synthetic test address',
          status: SalonStatus.ACTIVE,
          currency: 'INR',
        },
      });
      ownerSalonId = salon.id;
      fixtureSalonIds.add(salon.id);
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
    }, 120_000);

    afterAll(async () => {
      if (app) {
        const userIds = [...fixtureUserIds];
        if (userIds.length > 0) {
          await prisma.auditLog.deleteMany({
            where: { actorUserId: { in: userIds } },
          });
          await prisma.refreshToken.deleteMany({
            where: { userId: { in: userIds } },
          });
          if (fixturePhones.size > 0) {
            await prisma.otpRequest.deleteMany({
              where: { phone: { in: [...fixturePhones] } },
            });
          }
          await prisma.userRole.deleteMany({
            where: { userId: { in: userIds } },
          });
          const salonIds = [...fixtureSalonIds];
          if (salonIds.length > 0) {
            await prisma.chair.deleteMany({
              where: { salonId: { in: salonIds } },
            });
            await prisma.operatingHours.deleteMany({
              where: { salonId: { in: salonIds } },
            });
            await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
          }
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
        await app.close();
      }
    }, 120_000);

    it('creates a customer through actual HTTP OTP, supersedes resend codes and prevents replay/duplicates', async () => {
      const destination = phone(2);
      const firstCode = await requestCode(
        `auth/${AUTH_PATHS.otpRequest}`,
        destination,
      );
      const firstChallenge = await prisma.otpRequest.findFirst({
        where: {
          phone: destination,
          purpose: OtpPurpose.LOGIN,
          verifiedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(firstChallenge).not.toBeNull();
      const currentCode = await requestCode(
        `auth/${AUTH_PATHS.otpRequest}`,
        destination,
      );
      const supersededChallenge = await prisma.otpRequest.findUnique({
        where: { id: firstChallenge!.id },
      });
      expect(supersededChallenge?.verifiedAt).toBeInstanceOf(Date);

      // A 6-digit random OTP can legitimately collide. When distinct, verify the old code is stale;
      // regardless of a collision, its persisted challenge must already be consumed.
      if (currentCode !== firstCode) {
        const stale = await post(`auth/${AUTH_PATHS.otpVerify}`).send({
          phone: destination,
          code: firstCode,
        });
        expect(stale.status).toBe(400);
        expect(stale.body.code).toBe(AuthErrorCode.OTP_INVALID);
      }

      const valid = await post(`auth/${AUTH_PATHS.otpVerify}`).send({
        phone: destination,
        code: currentCode,
      });
      expect(valid.status).toBe(201);
      expect(valid.body.user.audience).toBe(SessionAudience.CUSTOMER);
      expect(valid.body.user.roles).toEqual([Role.CUSTOMER]);
      expect(valid.body.tokens.accessToken).toEqual(expect.any(String));
      const userId = valid.body.user.id as string;
      fixtureUserIds.add(userId);
      onboardingCustomer = {
        userId,
        accessToken: valid.body.tokens.accessToken as string,
        phone: destination,
        code: currentCode,
      };

      const replay = await post(`auth/${AUTH_PATHS.otpVerify}`).send({
        phone: destination,
        code: currentCode,
      });
      expect(replay.status).toBe(400);
      expect(replay.body.code).toBe(AuthErrorCode.OTP_INVALID);

      const nextCode = await requestCode(
        `auth/${AUTH_PATHS.otpRequest}`,
        destination,
      );
      const returning = await post(`auth/${AUTH_PATHS.otpVerify}`).send({
        phone: destination,
        code: nextCode,
      });
      expect(returning.status).toBe(201);
      expect(returning.body.user.id).toBe(userId);
      expect(await prisma.user.count({ where: { phone: destination } })).toBe(
        1,
      );
      expect(
        await prisma.userRole.count({ where: { userId, role: Role.CUSTOMER } }),
      ).toBe(1);
    }, 60_000);

    it('keeps customer OTP at CUSTOMER audience and promotes new owners only through real shop registration', async () => {
      expect(onboardingCustomer).toBeDefined();
      const {
        userId,
        accessToken,
        phone: destination,
        code,
      } = onboardingCustomer!;
      const customerLogin = {
        body: {
          user: {
            id: userId,
            audience: SessionAudience.CUSTOMER,
            roles: [Role.CUSTOMER],
          },
          tokens: { accessToken },
        },
      };
      expect(customerLogin.body.user.audience).toBe(SessionAudience.CUSTOMER);
      expect(customerLogin.body.user.roles).toEqual([Role.CUSTOMER]);

      const ownerAttempt = await post(`auth/${AUTH_PATHS.ownerOtpVerify}`).send(
        { phone: destination, code },
      );
      expect(ownerAttempt.status).toBe(400);
      expect(ownerAttempt.body.code).toBe(AuthErrorCode.OTP_INVALID);

      const registered = await post(
        DISCOVERY_PATHS.salons,
        customerLogin.body.tokens.accessToken,
      )
        .set('Idempotency-Key', randomUUID())
        .send({
          name: `OTP New Owner ${run}`,
          addressLine: 'Synthetic owner onboarding address',
          countryCode: 'IN',
          citySlug: 'jharsuguda',
          postalCode: '768201',
        })
        .expect(201);
      fixtureSalonIds.add(registered.body.salon.id as string);
      expect(registered.body.user.audience).toBe(SessionAudience.STAFF);
      expect(registered.body.user.roles).toContain(Role.SALON_OWNER);
      expect(registered.body.user.id).toBe(userId);
      const role = await prisma.userRole.findFirst({
        where: { userId, role: Role.SALON_OWNER },
      });
      expect(role?.salonId).toBe(registered.body.salon.id);
    }, 60_000);

    it('does not let a recycled unverified phone claim an existing owner account', async () => {
      const destination = phone(6);
      const legacyOwner = await prisma.user.create({
        data: {
          phone: destination,
          phoneVerifiedAt: null,
          status: UserStatus.ACTIVE,
        },
      });
      fixtureUserIds.add(legacyOwner.id);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: legacyOwner.id,
          name: `OTP Legacy Owner ${run}`,
          slug: `otp-legacy-${run}`,
          cityId,
          addressLine: 'Synthetic legacy owner address',
          status: SalonStatus.ACTIVE,
          currency: 'INR',
        },
      });
      fixtureSalonIds.add(salon.id);
      await prisma.userRole.create({
        data: {
          userId: legacyOwner.id,
          role: Role.SALON_OWNER,
          salonId: salon.id,
        },
      });

      const code = await requestCode(
        `auth/${AUTH_PATHS.otpRequest}`,
        destination,
      );
      const takeover = await post(`auth/${AUTH_PATHS.otpVerify}`).send({
        phone: destination,
        code,
      });
      expect(takeover.status).toBe(400);
      expect(takeover.body.code).toBe(AuthErrorCode.OTP_INVALID);
      const after = await prisma.user.findUnique({
        where: { id: legacyOwner.id },
        select: { phoneVerifiedAt: true, refreshTokens: true },
      });
      expect(after?.phoneVerifiedAt).toBeNull();
      expect(after?.refreshTokens).toHaveLength(0);
    }, 60_000);

    it('links a customer phone only through that authenticated CUSTOMER account and revokes stale sessions', async () => {
      const customer = await prisma.user.create({
        data: {
          email: `otp-customer-${run}@example.test`,
          status: UserStatus.ACTIVE,
          roles: { create: { role: Role.CUSTOMER } },
        },
      });
      fixtureUserIds.add(customer.id);
      const prior = await tokenService.issueTokenPair(
        customer.id,
        [Role.CUSTOMER],
        SessionAudience.CUSTOMER,
        'synthetic-authenticated-customer',
      );
      const targetPhone = phone(7);
      const code = await requestCode(
        `auth/${AUTH_PATHS.customerPhoneLinkRequest}`,
        targetPhone,
        prior.accessToken,
      );
      const linked = await post(
        `auth/${AUTH_PATHS.customerPhoneLinkVerify}`,
        prior.accessToken,
      )
        .send({ phone: targetPhone, code })
        .expect(201);
      expect(linked.body.user.id).toBe(customer.id);
      expect(linked.body.user.audience).toBe(SessionAudience.CUSTOMER);
      expect(linked.body.user.roles).toEqual([Role.CUSTOMER]);
      expect(linked.body.user.phone).toBe(targetPhone);
      const persisted = await prisma.user.findUnique({
        where: { id: customer.id },
        select: { phone: true, phoneVerifiedAt: true },
      });
      expect(persisted).toMatchObject({ phone: targetPhone });
      expect(persisted?.phoneVerifiedAt).toBeInstanceOf(Date);
      const staleRefresh = await post(`auth/${AUTH_PATHS.refresh}`).send({
        refreshToken: prior.refreshToken,
      });
      expect(staleRefresh.status).toBe(401);
      const audit = await prisma.auditLog.findFirst({
        where: { actorUserId: customer.id, action: 'CUSTOMER_PHONE_LINKED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).not.toHaveProperty('phone');
    }, 60_000);

    it('signs in only a verified canonical owner, allows secure phone linking, and revokes prior refresh sessions', async () => {
      const ownerPhone = phone(1);
      const ownerCode = await requestCode(
        `auth/${AUTH_PATHS.ownerOtpRequest}`,
        ownerPhone,
      );
      const ownerLogin = await post(`auth/${AUTH_PATHS.ownerOtpVerify}`)
        .send({ phone: ownerPhone, code: ownerCode })
        .expect(201);
      expect(ownerLogin.body.user.audience).toBe(SessionAudience.STAFF);
      expect(ownerLogin.body.user.roles).toEqual([Role.SALON_OWNER]);
      expect(ownerLogin.body.tokens.accessToken).toEqual(expect.any(String));
      expect(ownerLogin.body.tokens.refreshToken).toEqual(expect.any(String));
      const oldRefreshToken = ownerLogin.body.tokens.refreshToken as string;

      expect(onboardingCustomer).toBeDefined();
      const customer = {
        body: {
          user: { audience: SessionAudience.CUSTOMER },
          tokens: { accessToken: onboardingCustomer!.accessToken },
        },
      };
      expect(customer.body.user.audience).toBe(SessionAudience.CUSTOMER);

      const forbiddenLink = await post(
        `auth/${AUTH_PATHS.ownerPhoneLinkRequest}`,
        customer.body.tokens.accessToken,
      ).send({ phone: phone(3) });
      expect(forbiddenLink.status).toBe(403);

      const targetPhone = phone(3);
      const linkCode = await requestCode(
        `auth/${AUTH_PATHS.ownerPhoneLinkRequest}`,
        targetPhone,
        ownerLogin.body.tokens.accessToken,
      );
      const linked = await post(
        `auth/${AUTH_PATHS.ownerPhoneLinkVerify}`,
        ownerLogin.body.tokens.accessToken,
      )
        .send({ phone: targetPhone, code: linkCode })
        .expect(201);
      expect(linked.body.success).toBe(true);
      expect(linked.body.user.phone).toBe(targetPhone);
      expect(linked.body.user.audience).toBe(SessionAudience.STAFF);
      expect(linked.body.user.roles).toEqual([Role.SALON_OWNER]);

      const staleRefresh = await post(`auth/${AUTH_PATHS.refresh}`).send({
        refreshToken: oldRefreshToken,
      });
      expect(staleRefresh.status).toBe(401);

      const ownerRow = await prisma.user.findUnique({
        where: { id: ownerId },
        include: { roles: true, ownedSalons: { select: { id: true } } },
      });
      expect(ownerRow?.phone).toBe(targetPhone);
      expect(ownerRow?.phoneVerifiedAt).toBeInstanceOf(Date);
      expect(ownerRow?.ownedSalons.map(({ id }) => id)).toContain(ownerSalonId);
      expect(ownerRow?.roles).toContainEqual(
        expect.objectContaining({
          role: Role.SALON_OWNER,
          salonId: ownerSalonId,
        }),
      );

      const oldPhoneResult = await post(`auth/${AUTH_PATHS.ownerOtpRequest}`)
        .send({ phone: ownerPhone })
        .expect(201);
      expect(oldPhoneResult.body).toEqual({ expiresInSeconds: 300 });
    }, 60_000);

    it('returns phone-auth capability only for the explicitly replaced synthetic sender in test mode', async () => {
      const methods = await request(app.getHttpServer())
        .get(`/api/v1/auth/${AUTH_PATHS.methods}`)
        .expect(200);
      expect(methods.body.phoneOtp).toBe(true);
      expect(methods.body.ownerPhoneOtp).toBe(true);
      expect(methods.body).not.toHaveProperty('providerKey');
    });
  },
);
