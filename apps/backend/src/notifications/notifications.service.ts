import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationChannel,
  NotificationStatus,
  type NotificationDto,
  type NotificationType,
  type PaginatedResult,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Notification Center (Phase 11) — reuses the existing Notification model (channel/type/payload/
 * status already existed for outbound SMS/PUSH/EMAIL delivery attempts) rather than building a
 * parallel system, per the mission's explicit instruction. Every IN_APP row is created already
 * SENT (there is nothing to fail to deliver) and starts unread (readAt: null).
 *
 * Injected directly into whichever service actually knows a notification-worthy event just
 * happened (BookingsService, QueueService, ...) rather than listening for realtime socket events —
 * a notification must exist even for a user who wasn't connected when the event fired.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(
    userId: string,
    type: NotificationType,
    payload?: Record<string, unknown>,
    deepLink?: string,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        channel: NotificationChannel.IN_APP,
        type,
        payload: payload as Prisma.InputJsonValue | undefined,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        deepLink: deepLink ?? null,
      },
    });
  }

  async listMine(
    userId: string,
    cursor: string | undefined,
    limit = DEFAULT_PAGE_SIZE,
  ): Promise<PaginatedResult<NotificationDto>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, channel: NotificationChannel.IN_APP },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map((r) => this.toDto(r)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
    });
  }

  /** Scoped by userId in the WHERE, not just the id — a no-op (not an error) if the notification
   * doesn't belong to this user or doesn't exist, so this can never be used to probe other users'
   * notification ids. */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, channel: NotificationChannel.IN_APP },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
      data: { readAt: new Date() },
    });
  }

  private toDto(row: {
    id: string;
    type: string;
    payload: Prisma.JsonValue;
    deepLink: string | null;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: row.id,
      type: row.type as NotificationType,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      deepLink: row.deepLink,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
