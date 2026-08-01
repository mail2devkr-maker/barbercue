import { Module } from '@nestjs/common';
import { CitiesController } from './cities.controller';
import { SalonsController } from './salons.controller';
import { CitiesService } from './cities.service';
import { SalonsService } from './salons.service';

@Module({
  controllers: [CitiesController, SalonsController],
  providers: [CitiesService, SalonsService],
})
export class SalonsModule {}
