import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import {
  ADMIN_PATHS,
  OWNER_INVITATION_PATHS,
  Role,
  SessionAudience,
} from '@barbercue/shared';
import {
  AdminSalonOwnerAccessController,
  OwnerInvitationAcceptanceController,
} from '../src/admin/admin-salon-owner-access.controller';
import { AdminSalonOwnerAccessService } from '../src/admin/admin-salon-owner-access.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { TokenService } from '../src/auth/services/token.service';
import { PasswordService } from '../src/auth/services/password.service';
import { CryptoService } from '../src/auth/services/crypto.service';
import { TotpService } from '../src/auth/services/totp.service';
import { EMAIL_SENDER } from '../src/auth/services/email-sender';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { SalonAccessService } from '../src/common/salon-access/salon-access.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

// This suite intentionally requires a disposable PostgreSQL database. The CI workflow sets the
// flag and DATABASE_URL; ordinary local Jest runs show it as skipped rather than touching a DB.
const databaseDescribe =
  process.env.OWNER_ACCESS_DB_E2E === '1' ? describe : describe.skip;
const PREFIX = 'admin/shops/owner-access';

@Controller('_owner-access-check')
class OwnerMembershipProbeController {
  constructor(private readonly access: SalonAccessService) {}

  @Get(':salonId')
  @Roles(Role.SALON_OWNER)
  async probe(
    @CurrentUser() user: { id: string },
    @Param('salonId') salonId: string,
  ) {
    await this.access.assertOwnerAccess(user.id, salonId);
    return { allowed: true };
  }
}

databaseDescribe(
  'Shop owner email mapping against disposable PostgreSQL (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tokens: TokenService;
    let totp: TotpService;
    let adminId: string;
    let formerId: string;
    let targetId: string;
    let outsiderId: string;
    let cityId: string;
    let primaryId: string;
    let secondId: string;
    let inviteUrl: string | null = null;
    let deliveryFails = false;
    const seed = `owner-access-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // Synthetic 160-bit test secret; never a production credential.
    const api = () => request(app.getHttpServer());
    const auth = (id: string, roles: Role[], audience: SessionAudience) =>
      `Bearer ${tokens.signAccessToken(id, roles, audience)}`;
    const adminAuth = () =>
      auth(adminId, [Role.PLATFORM_ADMIN], SessionAudience.ADMIN);
    const mutation = async (
      expectedOwnerUserId: string,
      email: string,
      transferConfirmed = true,
    ) => ({
      expectedOwnerUserId,
      email,
      transferConfirmed,
      reason: 'Synthetic owner access certification',
      totpCode: await totp.generateToken(secret),
    });

    beforeAll(async () => {
      process.env.JWT_ACCESS_SECRET = 'owner-access-disposable-e2e-signing-key';
      process.env.TOTP_ENCRYPTION_KEY =
        'owner-access-disposable-e2e-encryption-key';
      process.env.NODE_ENV = 'test';
      process.env.WEB_BASE_URL = 'http://localhost:3001';
      const moduleRef = await Test.createTestingModule({
        imports: [
          JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
          ThrottlerModule.forRoot([
            { name: 'default', ttl: 60_000, limit: 100 },
          ]),
        ],
        controllers: [
          AdminSalonOwnerAccessController,
          OwnerInvitationAcceptanceController,
          OwnerMembershipProbeController,
        ],
        providers: [
          PrismaService,
          JwtStrategy,
          TokenService,
          PasswordService,
          CryptoService,
          TotpService,
          AdminSalonOwnerAccessService,
          SalonAccessService,
          {
            provide: EMAIL_SENDER,
            useValue: {
              assertAvailable: () => {
                if (deliveryFails) throw new Error('Synthetic delivery outage');
              },
              sendSalonOwnerInvitation: async (_email: string, url: string) => {
                if (deliveryFails) throw new Error('Synthetic delivery outage');
                inviteUrl = url;
                return 'SENT';
              },
            },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
          { provide: APP_GUARD, useClass: ThrottlerGuard },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalFilters(new AllExceptionsFilter());
      prisma = moduleRef.get(PrismaService);
      tokens = moduleRef.get(TokenService);
      totp = moduleRef.get(TotpService);
      await prisma.$connect();
      await app.init();

      const crypto = moduleRef.get(CryptoService);
      const admin = await prisma.user.create({
        data: {
          email: `admin-${seed}@test.invalid`,
          emailVerifiedAt: new Date(),
          twoFactorEnabled: true,
          totpSecret: crypto.encrypt(secret),
        },
      });
      const former = await prisma.user.create({
        data: {
          email: `former-${seed}@test.invalid`,
          emailVerifiedAt: new Date(),
        },
      });
      const target = await prisma.user.create({
        data: {
          email: `target-${seed}@test.invalid`,
          emailVerifiedAt: new Date(),
        },
      });
      const outsider = await prisma.user.create({
        data: {
          email: `outsider-${seed}@test.invalid`,
          emailVerifiedAt: new Date(),
        },
      });
      adminId = admin.id;
      formerId = former.id;
      targetId = target.id;
      outsiderId = outsider.id;
      await prisma.userRole.create({
        data: { userId: adminId, role: Role.PLATFORM_ADMIN, salonId: null },
      });
      const city = await prisma.city.create({
        data: {
          name: 'Synthetic City',
          slug: seed,
          state: 'Synthetic State',
          country: 'India',
          countryCode: 'IN',
        },
      });
      cityId = city.id;
      const primary = await prisma.salon.create({
        data: {
          name: 'Synthetic Owner Access One',
          slug: `${seed}-one`,
          publicId: `TEST-${seed}-1`,
          ownerUserId: formerId,
          cityId,
          addressLine: 'Synthetic Street',
        },
      });
      const second = await prisma.salon.create({
        data: {
          name: 'Synthetic Owner Access Two',
          slug: `${seed}-two`,
          publicId: `TEST-${seed}-2`,
          ownerUserId: formerId,
          cityId,
          addressLine: 'Synthetic Street',
        },
      });
      primaryId = primary.id;
      secondId = second.id;
      await prisma.userRole.createMany({
        data: [
          { userId: formerId, role: Role.SALON_OWNER, salonId: primaryId },
          { userId: formerId, role: Role.SALON_OWNER, salonId: secondId },
        ],
      });
      await prisma.refreshToken.create({
        data: {
          userId: formerId,
          tokenHash: `synthetic-${seed}`,
          audience: SessionAudience.STAFF,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    });

    afterAll(async () => {
      if (prisma) {
        const ids = [primaryId, secondId].filter(Boolean);
        if (ids.length) {
          await prisma.auditLog.deleteMany({
            where: { entityType: 'Salon', entityId: { in: ids } },
          });
          await prisma.salonOwnerInvitation.deleteMany({
            where: { salonId: { in: ids } },
          });
          await prisma.userRole.deleteMany({ where: { salonId: { in: ids } } });
          await prisma.salon.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.refreshToken.deleteMany({
          where: { tokenHash: `synthetic-${seed}` },
        });
        await prisma.userRole.deleteMany({
          where: {
            userId: {
              in: [adminId, formerId, targetId, outsiderId].filter(Boolean),
            },
          },
        });
        await prisma.user.deleteMany({ where: { email: { contains: seed } } });
        if (cityId) await prisma.city.delete({ where: { id: cityId } });
      }
      if (app) await app.close();
    });

    it('keeps searches admin-only and returns the exact shop and current owner', async () => {
      await api().get(`/api/v1/${PREFIX}?query=${seed}`).expect(401);
      await api()
        .get(`/api/v1/${PREFIX}?query=${seed}`)
        .set(
          'Authorization',
          auth(outsiderId, [Role.CUSTOMER], SessionAudience.CUSTOMER),
        )
        .expect(403);
      await api()
        .get(`/api/v1/${PREFIX}?query=${seed}`)
        .set(
          'Authorization',
          auth(adminId, [Role.PLATFORM_ADMIN], SessionAudience.STAFF),
        )
        .expect(403);
      const response = await api()
        .get(`/api/v1/${PREFIX}?query=${seed}`)
        .set('Authorization', adminAuth())
        .expect(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual(
        expect.objectContaining({
          owner: expect.objectContaining({ id: formerId, hasOwnerRole: true }),
        }),
      );
    });

    it('requires a current authenticator code, an explicit transfer and a current owner snapshot', async () => {
      const input = await mutation(formerId, `target-${seed}@test.invalid`);
      const wrongCode = input.totpCode === '000000' ? '111111' : '000000';
      await api()
        .post(`/api/v1/${PREFIX}/${primaryId}/assign`)
        .set('Authorization', adminAuth())
        .send({ ...input, totpCode: wrongCode })
        .expect(401);
      await api()
        .post(`/api/v1/${PREFIX}/${primaryId}/assign`)
        .set('Authorization', adminAuth())
        .send({ ...input, transferConfirmed: false })
        .expect(409);
      await api()
        .post(`/api/v1/${PREFIX}/${primaryId}/assign`)
        .set('Authorization', adminAuth())
        .send({ ...input, expectedOwnerUserId: outsiderId })
        .expect(409);
      expect(
        (await prisma.salon.findUniqueOrThrow({ where: { id: primaryId } }))
          .ownerUserId,
      ).toBe(formerId);
    });

    it('atomically transfers one shop, revokes stale STAFF sessions, and preserves other shops', async () => {
      const oldSession = auth(
        formerId,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
      await api()
        .get(`/api/v1/_owner-access-check/${primaryId}`)
        .set('Authorization', oldSession)
        .expect(200);
      const input = await mutation(formerId, `target-${seed}@test.invalid`);
      const response = await api()
        .post(`/api/v1/${PREFIX}/${primaryId}/assign`)
        .set('Authorization', adminAuth())
        .send(input)
        .expect(201);
      expect(response.body.outcome).toBe('MAPPED');
      expect(
        (await prisma.salon.findUniqueOrThrow({ where: { id: primaryId } }))
          .ownerUserId,
      ).toBe(targetId);
      expect(
        await prisma.userRole.count({
          where: {
            salonId: primaryId,
            role: Role.SALON_OWNER,
            userId: targetId,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.userRole.count({
          where: {
            salonId: primaryId,
            role: Role.SALON_OWNER,
            userId: formerId,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.userRole.count({
          where: {
            salonId: secondId,
            role: Role.SALON_OWNER,
            userId: formerId,
          },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.refreshToken.findFirstOrThrow({
            where: { tokenHash: `synthetic-${seed}` },
          })
        ).revokedAt,
      ).not.toBeNull();
      await api()
        .get(`/api/v1/_owner-access-check/${primaryId}`)
        .set('Authorization', oldSession)
        .expect(403);
      await api()
        .get(`/api/v1/_owner-access-check/${secondId}`)
        .set('Authorization', oldSession)
        .expect(200);
      await api()
        .get(`/api/v1/_owner-access-check/${primaryId}`)
        .set(
          'Authorization',
          auth(targetId, [Role.SALON_OWNER], SessionAudience.STAFF),
        )
        .expect(200);
      expect(
        await prisma.auditLog.count({
          where: {
            entityType: 'Salon',
            entityId: primaryId,
            action: 'SALON_OWNER_TRANSFERRED',
          },
        }),
      ).toBe(1);
      const repeated = await api()
        .post(`/api/v1/${PREFIX}/${primaryId}/assign`)
        .set('Authorization', adminAuth())
        .send({
          ...input,
          expectedOwnerUserId: targetId,
          transferConfirmed: false,
        })
        .expect(201);
      expect(repeated.body.outcome).toBe('ALREADY_MAPPED');
    });

    it('sends a hashed single-use invitation and grants no access before acceptance', async () => {
      const input = await mutation(formerId, `new-${seed}@test.invalid`);
      const response = await api()
        .post(`/api/v1/${PREFIX}/${secondId}/invitations`)
        .set('Authorization', adminAuth())
        .send(input)
        .expect(201);
      expect(response.body.outcome).toBe('INVITATION_SENT');
      expect(
        (await prisma.salon.findUniqueOrThrow({ where: { id: secondId } }))
          .ownerUserId,
      ).toBe(formerId);
      const pending = await prisma.salonOwnerInvitation.findFirstOrThrow({
        where: { salonId: secondId, status: 'PENDING' },
      });
      const token = new URLSearchParams(new URL(inviteUrl!).hash.slice(1)).get(
        'token',
      )!;
      expect(pending.tokenHash).not.toBe(token);
      expect(pending.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      const result = await api()
        .post(
          `/api/v1/${OWNER_INVITATION_PATHS.root}/${OWNER_INVITATION_PATHS.accept}`,
        )
        .send({
          token,
          password: 'SyntheticPassword123!',
          confirmPassword: 'SyntheticPassword123!',
        })
        .expect(201);
      expect(result.body.salonId).toBe(secondId);
      const newOwner = await prisma.user.findUniqueOrThrow({
        where: { email: `new-${seed}@test.invalid` },
      });
      expect(newOwner.emailVerifiedAt).not.toBeNull();
      expect(
        await new PasswordService().compare(
          'SyntheticPassword123!',
          newOwner.passwordHash!,
        ),
      ).toBe(true);
      expect(
        (await prisma.salon.findUniqueOrThrow({ where: { id: secondId } }))
          .ownerUserId,
      ).toBe(newOwner.id);
      await api()
        .post(
          `/api/v1/${OWNER_INVITATION_PATHS.root}/${OWNER_INVITATION_PATHS.accept}`,
        )
        .send({
          token,
          password: 'SyntheticPassword123!',
          confirmPassword: 'SyntheticPassword123!',
        })
        .expect(400);
    });

    it('keeps invitation audit history visible to administrators', async () => {
      const response = await api()
        .get(`/api/v1/${PREFIX}/${secondId}/audit`)
        .set('Authorization', adminAuth())
        .expect(200);
      expect(
        response.body.items.some(
          (item: { action: string }) =>
            item.action === 'SALON_OWNER_TRANSFERRED',
        ),
      ).toBe(true);
      await api()
        .get(`/api/v1/${PREFIX}/${secondId}/audit`)
        .set(
          'Authorization',
          auth(outsiderId, [Role.CUSTOMER], SessionAudience.CUSTOMER),
        )
        .expect(403);
    });
  },
);
