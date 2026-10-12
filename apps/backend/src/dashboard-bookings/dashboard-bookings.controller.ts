import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardBookingsService } from './dashboard-bookings.service';
import { VisitHistoryService } from '../visit-history/visit-history.service';

// Owner-only for ordinary staff — deliberately narrower than DashboardQueueController's
// @Roles(SALON_STAFF, SALON_OWNER): booking history exposes customer contact details, so ordinary
// staff don't get it by default. SalonAccessService.assertOwnerOrAdminAccess inside the service
// still re-checks that this specific user actually operates *this* salonId (never just "is an
// owner of some salon somewhere") — same two-layer pattern as DashboardQueueController.
// PLATFORM_ADMIN is additionally allowed at the route level (Part 2 delegated shop management);
// read-only here, so no AuditLog write is needed for the admin path.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class DashboardBookingsController {
  constructor(
    private readonly bookingsService: DashboardBookingsService,
    private readonly visitHistory: VisitHistoryService,
  ) {}

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

  // Static history route must precede `:id` below so Express never interprets "history" as a
  // booking identifier. It is an owner-only, salon-scoped union over the source tables.
  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.bookings}/history`)
  listVisitHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('filter') filter?: string,
    @Query('source') source?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.visitHistory.listOwner(
      user.id,
      salonId,
      filter,
      source,
      cursor,
      limit,
      from,
      to,
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
