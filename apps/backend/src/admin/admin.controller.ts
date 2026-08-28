import { Controller, Get } from '@nestjs/common';
import { ADMIN_PATHS, Role } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminMonitoringService } from './admin-monitoring.service';

/** Read-only platform operations. Authentication is global; authorization is admin-role only. */
@Controller(ADMIN_PATHS.admin)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly monitoring: AdminMonitoringService) {}

  @Get(ADMIN_PATHS.overview)
  overview() {
    return this.monitoring.getOverview();
  }
}
