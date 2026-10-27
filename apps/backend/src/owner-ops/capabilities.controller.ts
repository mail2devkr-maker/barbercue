import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  Role,
  type AuthenticatedUser,
  type SalonCapabilitiesDto,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SalonCapabilitiesService } from './capabilities.service';

@Controller('dashboard/salons/:salonId/capabilities')
// Read-only: platform admins managing a salon (e.g. its Offers page) need the same feature list.
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class CapabilitiesController {
  constructor(private readonly capabilities: SalonCapabilitiesService) {}

  @Get()
  getCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ): Promise<SalonCapabilitiesDto> {
    return this.capabilities.getForOwner(user.id, salonId);
  }
}
