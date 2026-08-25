import { Controller, Get, Param } from '@nestjs/common';
import { DISCOVERY_PATHS } from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { CitiesService } from './cities.service';

// Public, unauthenticated, SEO-facing per API.md's Discovery section.
@Controller(DISCOVERY_PATHS.cities)
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Public()
  @Get()
  listCities() {
    return this.citiesService.listCities();
  }

  // Single literal segment vs. the two-segment :countryCode/:citySlug routes below — different
  // arity means Express/Nest can never confuse the two regardless of declaration order (unlike
  // the old single-segment :citySlug shape this replaced, `all` no longer needs to be declared
  // "above" anything to avoid being swallowed).
  @Public()
  @Get(DISCOVERY_PATHS.allCities)
  listAllCities() {
    return this.citiesService.listAllCities();
  }

  // B9: country-scoped city URLs (/{countryCode}/{citySlug}/...). countryCode is case-insensitive
  // at this boundary — CitiesService.findCityByCountryAndSlugOrThrow uppercases it before the
  // lookup — so public URLs can use the friendlier lowercase convention (/in/bengaluru) while
  // City.countryCode stays stored as the ISO-3166-1 alpha-2 uppercase form.
  @Public()
  @Get(':countryCode/:citySlug')
  getCity(
    @Param('countryCode') countryCode: string,
    @Param('citySlug') citySlug: string,
  ) {
    return this.citiesService.getCity(countryCode, citySlug);
  }

  @Public()
  @Get(':countryCode/:citySlug/localities')
  listLocalities(
    @Param('countryCode') countryCode: string,
    @Param('citySlug') citySlug: string,
  ) {
    return this.citiesService.listLocalities(countryCode, citySlug);
  }

  @Public()
  @Get(':countryCode/:citySlug/localities/:localitySlug')
  getLocality(
    @Param('countryCode') countryCode: string,
    @Param('citySlug') citySlug: string,
    @Param('localitySlug') localitySlug: string,
  ) {
    return this.citiesService.getLocality(countryCode, citySlug, localitySlug);
  }
}
