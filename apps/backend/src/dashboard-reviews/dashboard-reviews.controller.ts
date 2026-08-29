import { Body, Controller, Get, Param, Put, Query, UsePipes } from '@nestjs/common';
import {
  DASHBOARD_PATHS,
  Role,
  respondToReviewSchema,
  type AuthenticatedUser,
  type RespondToReviewInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DashboardReviewsService } from './dashboard-reviews.service';

// Owner-only — see DashboardReviewsService's own doc comment (customerPhone/customerEmail on
// every list item, same PII-sensitivity reasoning as DashboardBookingsController).
@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class DashboardReviewsController {
  constructor(private readonly reviews: DashboardReviewsService) {}

  @Get(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.reviews}`)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviews.list(user.id, salonId, cursor, limit);
  }

  @Put(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.reviews}/:reviewId/${DASHBOARD_PATHS.response}`)
  @UsePipes(new ZodValidationPipe(respondToReviewSchema))
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: RespondToReviewInput,
  ) {
    return this.reviews.respond(user.id, salonId, reviewId, body.ownerResponse);
  }
}
