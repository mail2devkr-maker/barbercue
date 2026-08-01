import { Controller, Get } from '@nestjs/common';
import type { HealthCheckResponse } from '@barbercue/shared';

@Controller('health')
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
