import { Controller, Get, Param, Query, UsePipes } from '@nestjs/common';
import {
  DISCOVERY_PATHS,
  salonSearchQuerySchema,
  type SalonSearchQueryInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalonsService } from './salons.service';

// Public, unauthenticated, SEO-facing per API.md's Discovery section.
@Controller(DISCOVERY_PATHS.salons)
export class SalonsController {
  constructor(private readonly salonsService: SalonsService) {}

  @Public()
  @Get()
  @UsePipes(new ZodValidationPipe(salonSearchQuerySchema))
  search(@Query() query: SalonSearchQueryInput) {
    return this.salonsService.search(query);
  }

  @Public()
  @Get(':citySlug/:salonSlug')
  getProfile(
    @Param('citySlug') citySlug: string,
    @Param('salonSlug') salonSlug: string,
  ) {
    return this.salonsService.getProfile(citySlug, salonSlug);
  }
}
