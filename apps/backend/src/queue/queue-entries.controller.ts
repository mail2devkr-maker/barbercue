import { Controller, Get } from '@nestjs/common';
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
}
