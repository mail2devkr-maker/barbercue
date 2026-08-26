import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { COUNTRY_PATHS } from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { CountriesService } from './countries.service';

// Public, unauthenticated, SEO-facing discovery API -- same posture as CitiesController.
// Additive: a new resource/controller rather than folding into CitiesService, since Country and
// Region are a distinct concept from the existing City/Locality routes below it.
@Controller(COUNTRY_PATHS.countries)
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Public()
  @Get()
  listCountries() {
    return this.countriesService.listCountries();
  }

  // ParseUUIDPipe rejects a malformed :countryId with a clean 400 before it ever reaches Prisma
  // -- never lets a database cast error leak to the client.
  @Public()
  @Get(`:countryId/${COUNTRY_PATHS.regions}`)
  listRegions(@Param('countryId', new ParseUUIDPipe()) countryId: string) {
    return this.countriesService.listRegions(countryId);
  }
}
