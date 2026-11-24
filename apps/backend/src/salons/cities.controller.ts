import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DISCOVERY_PATHS,
  citySearchQuerySchema,
  type CitySearchQueryInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AppException } from '../common/exceptions/app.exception';
import { CitiesService } from './cities.service';
import { PincodeService } from './pincode.service';

// Public, unauthenticated, SEO-facing per API.md's Discovery section.
@Controller(DISCOVERY_PATHS.cities)
export class CitiesController {
  constructor(
    private readonly citiesService: CitiesService,
    private readonly pincodes: PincodeService,
  ) {}

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

  // Single literal segment, same arity as `all` above — never confused with the two-segment
  // :countryCode/:citySlug (B9) routes below regardless of declaration order.
  @Public()
  @Get(DISCOVERY_PATHS.citySearch)
  @UsePipes(new ZodValidationPipe(citySearchQuerySchema))
  searchCities(@Query() query: CitySearchQueryInput) {
    return this.citiesService.searchCities(query);
  }

  /** Typing aid for Indian addresses: PIN -> district, state, areas and the matching city. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('pincode/:pin')
  async pincode(@Param('pin') pin: string) {
    const found = await this.pincodes.lookup(pin);
    if (!found)
      throw new AppException(
        'PINCODE_NOT_FOUND',
        'We could not find that PIN code. Enter the city yourself.',
        HttpStatus.NOT_FOUND,
      );
    return found;
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
