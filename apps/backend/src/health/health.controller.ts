import { Controller, Get } from '@nestjs/common';
import { HEALTH_PATH, type HealthCheckResponse } from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';

@Controller(HEALTH_PATH)
export class HealthController {
  // Must stay reachable with no auth — this became a real regression risk the moment
  // Phase 2 registered JwtAuthGuard globally (default-deny). Covered by an e2e test below.
  @Public()
  @Get()
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      service: '@barbercue/backend',
      timestamp: new Date().toISOString(),
    };
  }
}
