import { Controller, Get, Param, Query } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DashboardCustomersService } from './dashboard-customers.service';

// Owner-only, same reasoning as DashboardBookingsController: customer contact details and visit
// history are not given to ordinary staff by default. SalonAccessService.assertAccess inside the
// service re-checks this specific user operates *this* salonId.
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class DashboardCustomersController {
  constructor(private readonly customers: DashboardCustomersService) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}`)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customers.list(user.id, salonId, offset, limit);
  }

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId`)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.customers.getOne(user.id, salonId, customerId);
  }
}
