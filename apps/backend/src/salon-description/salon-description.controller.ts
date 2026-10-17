import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DASHBOARD_PATHS,
  Role,
  SALON_DESCRIPTION_SUGGESTION_LIMITS,
  salonDescriptionSuggestionSchema,
  type AuthenticatedUser,
  type SalonDescriptionSuggestionDto,
  type SalonDescriptionSuggestionInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalonDescriptionService } from './salon-description.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class SalonDescriptionController {
  constructor(private readonly descriptions: SalonDescriptionService) {}

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/description/suggestions`)
  @Throttle({
    default: {
      limit: SALON_DESCRIPTION_SUGGESTION_LIMITS.maxRequests,
      ttl: SALON_DESCRIPTION_SUGGESTION_LIMITS.throttleWindowMs,
    },
  })
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', new ParseUUIDPipe()) salonId: string,
    @Body(new ZodValidationPipe(salonDescriptionSuggestionSchema))
    input: SalonDescriptionSuggestionInput,
  ): Promise<SalonDescriptionSuggestionDto> {
    return this.descriptions.suggest(user.id, salonId, input);
  }
}
