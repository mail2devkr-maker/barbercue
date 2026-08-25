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

  // MUST stay above @Get(':citySlug') — Nest matches in declaration order, and a param route
  // declared first would swallow the literal 'all' segment. Public like the rest of this
  // controller: a list of city names is not sensitive, and the shop-registration form that
  // consumes it should not need an authenticated round-trip to populate a dropdown.
  @Public()
  @Get(DISCOVERY_PATHS.allCities)
  listAllCities() {
    return this.citiesService.listAllCities();
  }

  @Public()
  @Get(':citySlug')
  getCity(@Param('citySlug') citySlug: string) {
    return this.citiesService.getCity(citySlug);
  }

  @Public()
  @Get(':citySlug/localities')
  listLocalities(@Param('citySlug') citySlug: string) {
    return this.citiesService.listLocalities(citySlug);
  }

  @Public()
  @Get(':citySlug/localities/:localitySlug')
  getLocality(
    @Param('citySlug') citySlug: string,
    @Param('localitySlug') localitySlug: string,
  ) {
    return this.citiesService.getLocality(citySlug, localitySlug);
  }
}
