import { Controller, Param, Post } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ManualChairOccupancyService } from './manual-chair-occupancy.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_STAFF, Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class ManualChairOccupancyController {
  constructor(private readonly occupancy: ManualChairOccupancyService) {}

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/:chairId/${DASHBOARD_PATHS.occupyLocal}`)
  occupyLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
  ) {
    return this.occupancy.occupyLocal(user.id, salonId, chairId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/:chairId/${DASHBOARD_PATHS.freeLocal}`)
  freeLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
  ) {
    return this.occupancy.freeLocal(user.id, salonId, chairId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/${DASHBOARD_PATHS.freeAllLocal}`)
  freeAllLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.occupancy.freeAllLocal(user.id, salonId);
  }
}
