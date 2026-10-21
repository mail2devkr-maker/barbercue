import { Global, Module } from '@nestjs/common';
import { MaintenanceStatusController } from './maintenance-status.controller';
import { MaintenanceModeService } from './maintenance-mode.service';

@Global()
@Module({
  controllers: [MaintenanceStatusController],
  providers: [MaintenanceModeService],
  exports: [MaintenanceModeService],
})
export class MaintenanceModule {}
