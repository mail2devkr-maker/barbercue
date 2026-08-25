import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  Role,
  SALON_QUEUE_PATHS,
  joinQueueSchema,
  type AuthenticatedUser,
  type JoinQueueInput,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { QueueService } from './queue.service';

/**
 * Mounted at `salons/:salonId/queue` — a 3-segment shape deliberately, not a bare
 * `salons/:salonId/queue-status`, to avoid the same discovery-route collision class fixed in
 * Phase 3B (SalonsController's `GET salons/:countryCode/:citySlug/:salonSlug`, three dynamic
 * segments as of B9, sits under the same `salons` prefix).
 */
@Controller('salons/:salonId/queue')
export class SalonQueueController {
  constructor(private readonly queueService: QueueService) {}

  @Public()
  @Get(SALON_QUEUE_PATHS.status)
  getStatus(@Param('salonId') salonId: string) {
    return this.queueService.getQueueStatus(salonId);
  }

  @Roles(Role.CUSTOMER)
  @Post(SALON_QUEUE_PATHS.join)
  @Idempotent()
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: JoinQueueInput,
  ) {
    return this.queueService.joinWalkIn(user.id, salonId, body.serviceId);
  }
}
