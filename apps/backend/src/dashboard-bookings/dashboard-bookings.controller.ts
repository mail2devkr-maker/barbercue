import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardBookingsService } from './dashboard-bookings.service';

// Owner-only — deliberately narrower than DashboardQueueController's
// @Roles(SALON_STAFF, SALON_OWNER): booking history exposes customer contact details, so ordinary
// staff don't get it by default. SalonAccessService.assertAccess inside the service still
// re-checks that this specific user actually operates *this* salonId (never just "is an owner of
// some salon somewhere") — same two-layer pattern as DashboardQueueController.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class DashboardBookingsController {
  constructor(private readonly bookingsService: DashboardBookingsService) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.bookings}`)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('filter') filter?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('date') date?: string,
  ) {
    return this.bookingsService.list(
      user.id,
      salonId,
      filter,
      cursor,
      limit,
      from,
      to,
      date,
    );
  }

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.bookings}/:id`)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('id') id: string,
  ) {
    return this.bookingsService.getOne(user.id, salonId, id);
  }
}
