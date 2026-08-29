import { Body, Controller, Get, Param, Patch, Post, UsePipes } from '@nestjs/common';
import {
  REVIEW_PATHS,
  createReviewSchema,
  updateReviewSchema,
  type AuthenticatedUser,
  type CreateReviewInput,
  type UpdateReviewInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

// No @Roles() restriction — every authenticated user with a completed booking may review it,
// scoped entirely by CurrentUser().id inside the service, same convention as NotificationsController.
@Controller(REVIEW_PATHS.reviews)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createReviewSchema))
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateReviewInput) {
    return this.reviews.create(user.id, body);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateReviewSchema))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateReviewInput,
  ) {
    return this.reviews.update(user.id, id, body);
  }

  @Get(`${REVIEW_PATHS.booking}/:bookingId`)
  getForBooking(@CurrentUser() user: AuthenticatedUser, @Param('bookingId') bookingId: string) {
    return this.reviews.getForBooking(user.id, bookingId);
  }
}
