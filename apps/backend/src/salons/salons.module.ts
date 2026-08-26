import { Module } from '@nestjs/common';
import { CitiesController } from './cities.controller';
import { CountriesController } from './countries.controller';
import { SalonsController } from './salons.controller';
import { CitiesService } from './cities.service';
import { CountriesService } from './countries.service';
import { SalonsService } from './salons.service';

@Module({
  controllers: [CitiesController, CountriesController, SalonsController],
  providers: [CitiesService, CountriesService, SalonsService],
})
export class SalonsModule {}
