import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { HealthCheckResponse } from '@barbercue/shared';
import { HealthModule } from './../src/health/health.module';

// Deliberately imports only HealthModule, not the full AppModule — AppModule wires PrismaModule,
// which connects to a real PostgreSQL instance on init. Foundation-phase e2e coverage should not
// require a live database; full-AppModule e2e tests are added once a real DB is available in CI
// (see TESTING.md).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health (GET)', () => {
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
