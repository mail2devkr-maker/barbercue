import { Controller, Get, Param, Query } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

// Owner-only — same reasoning as dashboard-bookings/dashboard-customers: operational analytics is
// not given to ordinary staff by default.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class DashboardAnalyticsController {
  constructor(private readonly analytics: DashboardAnalyticsService) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.analytics}`)
  getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.getAnalytics(user.id, salonId, range, from, to);
  }
}
