import { Controller, Get } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardOverviewService } from './dashboard-overview.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class DashboardOverviewController {
  constructor(private readonly overview: DashboardOverviewService) {}

  @Get(DASHBOARD_PATHS.overview)
  getOverview(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.getOverview(user.id);
  }
}
