import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { NOTIFICATION_PATHS, type AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

// No @Roles() restriction — every authenticated user (customer, owner, staff, admin) reads their
// own notifications. Scoping is entirely by userId from @CurrentUser(), never by role.
@Controller(NOTIFICATION_PATHS.notifications)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get(NOTIFICATION_PATHS.mine)
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
  ) {
    return this.notifications.listMine(user.id, cursor);
  }

  @Get(`${NOTIFICATION_PATHS.mine}/${NOTIFICATION_PATHS.unreadCount}`)
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post(`:id/${NOTIFICATION_PATHS.read}`)
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @Post(`${NOTIFICATION_PATHS.mine}/${NOTIFICATION_PATHS.readAll}`)
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: AuthenticatedUser) {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }
}
