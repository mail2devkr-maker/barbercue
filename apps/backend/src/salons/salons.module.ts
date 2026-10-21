import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CustomerAssistantSearchController } from './customer-assistant-search.controller';
import { CustomerAssistantSearchService } from './customer-assistant-search.service';
import { CitiesController } from './cities.controller';
import { CountriesController } from './countries.controller';
import { SalonsController } from './salons.controller';
import { CitiesService } from './cities.service';
import { CountriesService } from './countries.service';
import { SalonsService } from './salons.service';

// AuthModule provides TokenService — SalonsService.registerSalon uses it to mint a fresh
// STAFF-audience session the instant a customer becomes a shop owner (see that method's own doc
// comment for why the caller's existing token can never just be patched with the new role).
@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [
    CitiesController,
    CountriesController,
    SalonsController,
    CustomerAssistantSearchController,
  ],
  providers: [
    CitiesService,
    CountriesService,
    SalonsService,
    CustomerAssistantSearchService,
  ],
})
export class SalonsModule {}
