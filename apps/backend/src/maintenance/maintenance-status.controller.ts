import { Controller, Get, Header } from '@nestjs/common';
import { MAINTENANCE_PATHS } from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { MaintenanceModeService } from './maintenance-mode.service';

@Controller(MAINTENANCE_PATHS.maintenance)
export class MaintenanceStatusController {
  constructor(private readonly maintenanceMode: MaintenanceModeService) {}

  @Public()
  @Get(MAINTENANCE_PATHS.status)
  @Header('Cache-Control', 'no-store')
  status() {
    return this.maintenanceMode.getStatus();
  }
}
