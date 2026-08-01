import { Controller, Param, Post } from '@nestjs/common';
import { BOOKING_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { QueueService } from './queue.service';

/**
 * A separate controller (not a new method on bookings.controller.ts) specifically to avoid a
 * circular module dependency: BookingsModule exports AvailabilityService for QueueModule to
 * reuse, so QueueModule importing BookingsModule is one-directional. NestJS doesn't care which
 * module "owns" a URL prefix — this just adds one more route under the existing `bookings` path.
 */
@Controller(BOOKING_PATHS.bookings)
@Roles(Role.CUSTOMER)
export class BookingCheckInController {
  constructor(private readonly queueService: QueueService) {}

  @Post(`:id/${BOOKING_PATHS.checkIn}`)
  @Idempotent()
  checkIn(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queueService.checkIn(user.id, id);
  }
}
