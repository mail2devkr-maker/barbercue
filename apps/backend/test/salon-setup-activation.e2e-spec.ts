import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role, SalonStatus } from '@barbercue/shared';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { SalonSetupController } from '../src/salon-setup/salon-setup.controller';
import { SalonServicesService } from '../src/salon-setup/salon-services.service';
import { SalonChairsService } from '../src/salon-setup/salon-chairs.service';
import { SalonStaffService } from '../src/salon-setup/salon-staff.service';
import { SalonActivationService } from '../src/salon-setup/salon-activation.service';
import { SalonOperatingHoursService } from '../src/salon-setup/salon-operating-hours.service';
import { SalonPhotosService } from '../src/salon-setup/salon-photos.service';
import { SalonAccessService } from '../src/common/salon-access/salon-access.service';

process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-for-salon-setup-activation-e2e-spec';

const SALON_ID = 'a1111111-1111-4111-8111-111111111111';
const OWNER_ID = 'owner-1';
const INTRUDER_ID = 'intruder-1';

/**
 * Reproduces and guards against a production bug: PATCH dashboard/salons/:salonId/status
 * (the "Open my shop" button) rejected every request — including a fully valid one — with
 * VALIDATION_ERROR / "Request validation failed".
 *
 * Root cause: the handler bound its ZodValidationPipe at the METHOD level
 * (`@UsePipes(new ZodValidationPipe(updateSalonStatusSchema))`), not per-parameter
 * (`@Body(new ZodValidationPipe(...))`). Nest's RouterExecutionContext treats every "pipeable"
 * parameter the same way — @Param(), and custom decorators created via createParamDecorator
 * (like @CurrentUser()) included, not just @Body() — so a method-level pipe runs against ALL of
 * them. updateSalonStatusSchema (`{ status: 'ACTIVE' | 'SUSPENDED' }`) then ran against the raw
 * salonId string AND the AuthenticatedUser object too, and both fail that shape, throwing
 * VALIDATION_ERROR before SalonActivationService ever ran — regardless of whether the body itself
 * was valid. This is the only route in the codebase combining a method-level @UsePipes() with
 * both @Param() and a custom decorator, which is why the bug was isolated to this one endpoint.
 *
 * Uses the real SalonSetupController, SalonActivationService and SalonAccessService end to end
 * (only PrismaService is mocked, same pattern as rbac.e2e-spec.ts) so this proves the whole
 * request → guards → pipe → controller → service → access-check → response path, not just the
 * pipe in isolation.
 */
describe('Salon setup activation — PATCH dashboard/salons/:salonId/status (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let prisma: {
    user: { findUnique: jest.Mock };
    userRole: { findFirst: jest.Mock };
    salon: { findUnique: jest.Mock; update: jest.Mock };
    service: { count: jest.Mock };
    chair: { count: jest.Mock };
    salonStaff: { count: jest.Mock };
  };

  beforeAll(async () => {
    prisma = {
      user: {
        // Must honor whichever id the token's `sub` carries — JwtStrategy.validate derives the
        // authenticated user's id from this lookup's result, not from the token directly, so a
        // mock that ignores `where.id` would silently authenticate every token as the same user.
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve({ id, status: 'ACTIVE' }),
        ),
      },
      userRole: {
        // Membership check that SalonAccessService.assertAccess runs — owner-1 has a
        // SALON_OWNER row for SALON_ID; nobody else does.
        findFirst: jest.fn(({ where }: { where: { userId: string; salonId: string } }) =>
          Promise.resolve(
            where.userId === OWNER_ID && where.salonId === SALON_ID
              ? { id: 'role-1', userId: OWNER_ID, salonId: SALON_ID, role: Role.SALON_OWNER }
              : null,
          ),
        ),
      },
      salon: {
        findUnique: jest.fn().mockResolvedValue({ id: SALON_ID, status: SalonStatus.PENDING }),
        update: jest.fn(({ data }: { data: { status: string } }) =>
          Promise.resolve({ id: SALON_ID, status: data.status }),
        ),
      },
      // Fully set-up shop by default — one active service, chair and barber.
      service: { count: jest.fn().mockResolvedValue(1) },
      chair: { count: jest.fn().mockResolvedValue(1) },
      salonStaff: { count: jest.fn().mockResolvedValue(1) },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_ACCESS_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [SalonSetupController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        SalonAccessService,
        SalonActivationService,
        // Unrelated sibling services on the same controller — never invoked by these routes, so
        // a bare stub is enough to satisfy the controller's constructor.
        { provide: SalonServicesService, useValue: {} },
        { provide: SalonChairsService, useValue: {} },
        { provide: SalonStaffService, useValue: {} },
        { provide: SalonOperatingHoursService, useValue: {} },
        { provide: SalonPhotosService, useValue: {} },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Clears call history (not mock implementations) so each test's `.not.toHaveBeenCalled()` /
  // `.toHaveBeenCalledWith()` assertions reflect only that test's own request, not the cumulative
  // history of every request run before it in this file.
  beforeEach(() => {
    prisma.user.findUnique.mockClear();
    prisma.userRole.findFirst.mockClear();
    prisma.salon.findUnique.mockClear();
    prisma.salon.update.mockClear();
    prisma.service.count.mockClear();
    prisma.chair.count.mockClear();
    prisma.salonStaff.count.mockClear();
  });

  function tokenFor(sub: string, roles: Role[]): string {
    return jwt.sign({ sub, roles });
  }

  function patchStatus(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/dashboard/salons/${SALON_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('reaches activation logic and activates a ready PENDING salon — the exact "Open my shop" path', async () => {
    const res = await patchStatus(tokenFor(OWNER_ID, [Role.SALON_OWNER]), {
      status: SalonStatus.ACTIVE,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: SALON_ID, status: SalonStatus.ACTIVE });
    expect(prisma.salon.update).toHaveBeenCalledWith({
      where: { id: SALON_ID },
      data: { status: SalonStatus.ACTIVE },
    });
  });

  it('returns SALON_SETUP_INCOMPLETE with readiness details for a genuinely incomplete PENDING salon', async () => {
    prisma.chair.count.mockResolvedValueOnce(0);

    const res = await patchStatus(tokenFor(OWNER_ID, [Role.SALON_OWNER]), {
      status: SalonStatus.ACTIVE,
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'SALON_SETUP_INCOMPLETE',
        details: { hasActiveService: true, hasActiveChair: false, hasActiveStaff: true },
      },
    });
    expect(prisma.salon.update).not.toHaveBeenCalled();
  });

  it('still returns VALIDATION_ERROR for a genuinely invalid body, and only for the body', async () => {
    const res = await patchStatus(tokenFor(OWNER_ID, [Role.SALON_OWNER]), {
      status: 'NOT_A_REAL_STATUS',
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(prisma.salon.update).not.toHaveBeenCalled();
  });

  it('keeps owner-of-this-salon access protection intact', async () => {
    const res = await patchStatus(tokenFor(INTRUDER_ID, [Role.SALON_OWNER]), {
      status: SalonStatus.ACTIVE,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'SALON_ACCESS_DENIED' } });
    expect(prisma.salon.update).not.toHaveBeenCalled();
  });

  it('keeps the SALON_OWNER role gate intact', async () => {
    const res = await patchStatus(tokenFor(OWNER_ID, [Role.CUSTOMER]), {
      status: SalonStatus.ACTIVE,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN_ROLE' } });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/dashboard/salons/${SALON_ID}/status`)
      .send({ status: SalonStatus.ACTIVE });

    expect(res.status).toBe(401);
  });
});
