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
