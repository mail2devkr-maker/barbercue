import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  QUEUE_ENTRIES_PATH,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QueueService } from './queue.service';

@Controller(QUEUE_ENTRIES_PATH)
@Roles(Role.CUSTOMER)
export class QueueEntriesController {
  constructor(private readonly queueService: QueueService) {}

  @Get('mine/active')
  getMyActiveEntry(@CurrentUser() user: AuthenticatedUser) {
    return this.queueService.getActiveForCustomer(user.id);
  }

  // Customer self-report is advisory; only shop staff may mark arrivedAt authoritative.
  @Post(':id/arrival-response')
  reportArrival(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { arrived?: unknown },
  ) {
    if (typeof body?.arrived !== 'boolean') {
      throw new BadRequestException('Arrival response must be true or false.');
    }
    return this.queueService.respondArrival(id, body.arrived, { customerId: user.id });
  }

  // Customers may leave a standalone Live Queue while WAITING or CALLED (including
  // assigned-but-not-started). Appointment check-ins use the booking cancellation flow.
  @Post(':id/cancel')
  cancelMyEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.queueService.cancelByCustomer(user.id, id);
  }
}
