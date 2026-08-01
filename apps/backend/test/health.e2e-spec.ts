import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { HealthCheckResponse } from '@barbercue/shared';
import { HealthModule } from './../src/health/health.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-for-health-e2e-spec';

// Deliberately imports only HealthModule, not the full AppModule — AppModule wires PrismaModule,
// which connects to a real PostgreSQL instance on init. Foundation-phase e2e coverage should not
// require a live database; full-AppModule e2e tests are added once a real DB is available in CI
// (see TESTING.md).
//
// The global JwtAuthGuard/RolesGuard ARE wired here deliberately, even though PrismaService is
// mocked — this is what caught a real Phase 2 regression where /health silently started
// requiring authentication the moment JwtAuthGuard became a global default-deny guard, because
// HealthController had no @Public() decorator. Testing against only HealthModule in isolation
// (no guards) would never have caught that.
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const testModule: TestingModule = await Test.createTestingModule({
      imports: [
        HealthModule,
        JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
      ],
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn() } },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = testModule.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health (GET) is reachable with no Authorization header', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthCheckResponse;
        expect(body.status).toBe('ok');
        expect(body.service).toBe('@barbercue/backend');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
