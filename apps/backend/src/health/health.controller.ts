import { Controller, Get } from '@nestjs/common';
import { HEALTH_PATH, type HealthCheckResponse } from '@barbercue/shared';

@Controller(HEALTH_PATH)
export class HealthController {
  @Get()
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      service: '@barbercue/backend',
      timestamp: new Date().toISOString(),
    };
  }
}
