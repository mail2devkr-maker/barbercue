import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Role } from '@barbercue/shared';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { Public } from '../src/auth/decorators/public.decorator';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-for-rbac-e2e-spec';

// A throwaway controller that exercises the real JwtAuthGuard/RolesGuard exactly as they run in
// production (see AppModule), against real signed JWTs over real HTTP — without needing a live
// database. PrismaService (used only by JwtStrategy to re-check account status) is mocked here
// specifically so this test can run without Postgres; that is the ONLY thing mocked. The actual
// AuthController/AuthService flows (OTP, login, refresh) are covered separately — those touch
// the database for real and are marked UNVERIFIED – REQUIRES DATABASE in the Phase 2 report,
// since no live Postgres exists in this environment.
@Controller('__test')
class TestProtectedController {
  @Public()
  @Get('public')
  publicRoute() {
    return { ok: true };
  }

  @Get('protected')
  protectedRoute(@CurrentUser() user: { id: string; roles: Role[] }) {
    return { ok: true, user };
  }

  @Roles(Role.PLATFORM_ADMIN)
  @Get('admin-only')
  adminOnlyRoute() {
    return { ok: true };
  }

  @Roles(Role.SALON_STAFF, Role.SALON_OWNER)
  @Get('staff-or-owner-only')
  staffOrOwnerRoute() {
    return { ok: true };
  }
}

describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  const activeUsers = new Set(['customer-1', 'staff-1', 'owner-1', 'admin-1']);

  beforeAll(async () => {
    const prismaMock = {
      user: {
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve(
            activeUsers.has(id) ? { id, status: 'ACTIVE' } : null,
          ),
        ),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: process.env.JWT_ACCESS_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [TestProtectedController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prismaMock },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Matches main.ts's production wiring so response shapes in this test reflect reality.
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function tokenFor(sub: string, roles: Role[]): string {
    return jwt.sign({ sub, roles });
  }

  it('allows an unauthenticated request to a @Public() route', async () => {
    await request(app.getHttpServer())
      .get('/__test/public')
      .expect(200, { ok: true });
  });

  it('rejects a protected route with no Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .get('/__test/protected')
      .expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects a protected route with a garbage token', async () => {
    await request(app.getHttpServer())
      .get('/__test/protected')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('allows a protected route with a valid token for any role', async () => {
    const res = await request(app.getHttpServer())
      .get('/__test/protected')
      .set('Authorization', `Bearer ${tokenFor('customer-1', [Role.CUSTOMER])}`)
      .expect(200);
    expect((res.body as { user: { roles: Role[] } }).user.roles).toEqual([
      Role.CUSTOMER,
    ]);
  });

  it('rejects a token belonging to a user the DB no longer considers active', async () => {
    await request(app.getHttpServer())
      .get('/__test/protected')
      .set(
        'Authorization',
        `Bearer ${tokenFor('suspended-user', [Role.CUSTOMER])}`,
      )
      .expect(401);
  });

  it('rejects a CUSTOMER on an admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/__test/admin-only')
      .set('Authorization', `Bearer ${tokenFor('customer-1', [Role.CUSTOMER])}`)
      .expect(403);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN_ROLE',
    );
  });

  it('allows a PLATFORM_ADMIN on an admin-only route', async () => {
    await request(app.getHttpServer())
      .get('/__test/admin-only')
      .set(
        'Authorization',
        `Bearer ${tokenFor('admin-1', [Role.PLATFORM_ADMIN])}`,
      )
      .expect(200, { ok: true });
  });

  it('allows SALON_STAFF and SALON_OWNER, but not each other-excluded roles, on a multi-role route', async () => {
    await request(app.getHttpServer())
      .get('/__test/staff-or-owner-only')
      .set('Authorization', `Bearer ${tokenFor('staff-1', [Role.SALON_STAFF])}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/__test/staff-or-owner-only')
      .set('Authorization', `Bearer ${tokenFor('owner-1', [Role.SALON_OWNER])}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/__test/staff-or-owner-only')
      .set(
        'Authorization',
        `Bearer ${tokenFor('admin-1', [Role.PLATFORM_ADMIN])}`,
      )
      .expect(403);
  });
});
