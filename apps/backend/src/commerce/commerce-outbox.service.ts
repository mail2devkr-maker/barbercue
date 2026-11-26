import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  SHOP_ORDER_STATUS_LABEL,
  type NotificationType,
} from '@barbercue/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { commercePublic, type Tx } from './commerce-support';
import {
  armCommerceOutbox,
  commerceOutboxArmed,
  commerceOutboxSeq,
  disarmCommerceOutbox,
} from './commerce-outbox-signal';

const MAX_ATTEMPTS = 6;

/**
 * Reliable in-app notifications. Rows are written inside the order's own transaction and delivered
 * afterwards, so a notification problem can never roll back or duplicate an order; dedupeKey makes
 * each event notify once. Email, SMS and WhatsApp have no configured provider here, so nothing is
 * ever reported as sent through them.
 */
@Injectable()
export class CommerceOutboxService {
  private readonly log = new Logger(CommerceOutboxService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async add(
    tx: Tx | PrismaService,
    row: {
      dedupeKey: string;
      userId: string | null;
      type: NotificationType;
      payload?: Prisma.InputJsonObject;
      deepLink?: string;
    },
  ): Promise<void> {
    if (!row.userId) return; // guests follow their private order link
    await tx.commerceOutbox.createMany({
      data: [{ ...row, userId: row.userId }],
      skipDuplicates: true,
    });
    armCommerceOutbox();
  }

  /**
   * Every 20 s, but only while armed: an idle site makes no query at all, so the database compute
   * can sleep. Off entirely in admin-only set-up mode.
   */
  @Interval(20_000)
  async sweep(): Promise<void> {
    if (!commerceOutboxArmed()) return;
    await this.deliver();
  }

  async deliver(): Promise<number> {
    if (!commercePublic() || this.running) return 0;
    this.running = true;
    const seqAtStart = commerceOutboxSeq();
    try {
      const recentEvents = await this.collectSalonOrderEvents();
      const due = await this.prisma.commerceOutbox.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      let sent = 0;
      for (const row of due) {
        // Lease before sending so two instances cannot deliver the same row at once.
        const claimed = await this.prisma.commerceOutbox.updateMany({
          where: { id: row.id, status: 'PENDING', attempts: row.attempts },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
          },
        });
        if (!claimed.count) continue;
        try {
          await this.prisma.$transaction(async (tx) => {
            const done = await tx.commerceOutbox.updateMany({
              where: { id: row.id, status: 'PENDING' },
              data: { status: 'SENT', lastError: null },
            });
            if (done.count)
              await this.notifications.notifyInTransaction(
                tx,
                row.userId,
                row.type as NotificationType,
                (row.payload as Record<string, unknown> | null) ?? undefined,
                row.deepLink ?? undefined,
              );
          });
          sent += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.prisma.commerceOutbox.update({
            where: { id: row.id },
            data: {
              lastError: message.slice(0, 300),
              ...(row.attempts + 1 >= MAX_ATTEMPTS ? { status: 'FAILED' } : {}),
            },
          });
        }
      }
      // Stay armed while a row waits for a retry or a recent salon order event may still need
      // collecting; otherwise stop querying until new work arms the sweep again.
      const pending = await this.prisma.commerceOutbox.count({
        where: { status: 'PENDING' },
      });
      if (pending === 0 && recentEvents === 0) disarmCommerceOutbox(seqAtStart);
      return sent;
    } catch (error) {
      this.log.warn(
        `Commerce notifications paused: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Salon marketplace orders never notified anyone. Rather than change that service, its own status
   * history is read: the salon owner hears about new and cancelled orders, the customer about the rest.
   */
  private async collectSalonOrderEvents(): Promise<number> {
    const events = await this.prisma.shopOrderEvent.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      include: {
        order: {
          select: {
            orderNumber: true,
            customerUserId: true,
            salonId: true,
            salon: { select: { name: true, ownerUserId: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    const known = new Set(
      (
        await this.prisma.commerceOutbox.findMany({
          where: {
            dedupeKey: {
              in: events.flatMap((e) => [`shop:${e.id}:c`, `shop:${e.id}:s`]),
            },
          },
          select: { dedupeKey: true },
        })
      ).map((k) => k.dedupeKey),
    );
    let added = 0;
    for (const e of events) {
      const payload = {
        orderNumber: e.order.orderNumber,
        salonName: e.order.salon.name,
        status: SHOP_ORDER_STATUS_LABEL[e.toStatus],
      };
      const byCustomer = e.actorKind === 'CUSTOMER' || e.actorKind === 'GUEST';
      if (!byCustomer && !known.has(`shop:${e.id}:c`)) {
        added += 1;
        await this.add(this.prisma, {
          dedupeKey: `shop:${e.id}:c`,
          userId: e.order.customerUserId,
          type: 'shop.order.updated',
          payload,
          deepLink: `shop/orders/${e.order.orderNumber}`,
        });
      }
      if (
        (byCustomer || e.toStatus === 'EXPIRED') &&
        !known.has(`shop:${e.id}:s`)
      ) {
        added += 1;
        await this.add(this.prisma, {
          dedupeKey: `shop:${e.id}:s`,
          userId: e.order.salon.ownerUserId,
          type: 'shop.order.updated',
          payload,
          deepLink: `dashboard/salons/${e.order.salonId}/sell`,
        });
      }
    }
    return added;
  }
}
