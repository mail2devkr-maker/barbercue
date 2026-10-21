import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { MaintenanceModeGuard } from './maintenance-mode.guard';
import { MaintenanceModeService } from './maintenance-mode.service';
import { MaintenanceStatusController } from './maintenance-status.controller';

@Controller('maintenance-probe')
class MaintenanceWriteProbeController {
  @Post('write')
  write() {
    return { accepted: true };
  }
}

describe('Maintenance mode HTTP integration', () => {
  let app: INestApplication<App>;
  const originalMode = process.env.FASTQUE_MAINTENANCE_MODE;
  const originalMessage = process.env.FASTQUE_MAINTENANCE_MESSAGE;

  beforeAll(async () => {
    process.env.FASTQUE_MAINTENANCE_MODE = 'true';
    process.env.FASTQUE_MAINTENANCE_MESSAGE = 'Scheduled QA window.';
    const moduleRef = await Test.createTestingModule({
      controllers: [
        MaintenanceStatusController,
        MaintenanceWriteProbeController,
      ],
      providers: [
        MaintenanceModeService,
        { provide: APP_GUARD, useClass: MaintenanceModeGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (originalMode === undefined) delete process.env.FASTQUE_MAINTENANCE_MODE;
    else process.env.FASTQUE_MAINTENANCE_MODE = originalMode;
    if (originalMessage === undefined)
      delete process.env.FASTQUE_MAINTENANCE_MESSAGE;
    else process.env.FASTQUE_MAINTENANCE_MESSAGE = originalMessage;
  });

  it('serves a cache-safe public status contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/maintenance/status')
      .expect(200);

    expect(response.body).toEqual({
      enabled: true,
      message: 'Scheduled QA window.',
    });
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('blocks HTTP mutations with the stable maintenance error before the handler runs', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/maintenance-probe/write')
      .expect(503);

    expect(response.body.error).toMatchObject({
      code: 'MAINTENANCE_MODE',
      message: 'Scheduled QA window.',
    });
  });
});
