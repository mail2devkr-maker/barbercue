import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationCategory, QueueEntryStatus } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { QueueService } from './queue.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** Customers and shop receive the same T-10 *estimated* service-arrival prompt. */
export const LIVE_QUEUE_ARRIVAL_LEAD_MINUTES = 10;
const MAX_SHOPS_PER_SWEEP = 120;
const MAX_REMINDERS_PER_SWEEP = 240;

@Injectable()
export class QueueArrivalReminderService {
  private readonly logger = new Logger(QueueArrivalReminderService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly delivery: NotificationDeliveryService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Interval(30_000)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sendDueReminders();
    } catch (err) {
      this.logger.error('Live Queue arrival reminder sweep failed', err instanceof Error ? err.stack : undefined);
    } finally {
      this.sweeping = false;
    }
  }

  async sendDueReminders(): Promise<number> {
    // The previous estimatedWaitMinutes is a snapshot and does not decrease by itself.
    // Recompute active salons first so a long-running service can actually cross the T-10 boundary.
    const salons = await this.prisma.queueEntry.findMany({
      where: {
        status: QueueEntryStatus.WAITING,
        arrivedAt: null,
        arrivalPromptSentAt: null,
      },
      select: { salonId: true },
      distinct: ['salonId'],
      take: MAX_SHOPS_PER_SWEEP,
    });
    for (const { salonId } of salons) {
      try {
        await this.queue.recomputeEtas(salonId);
      } catch (err) {
        this.logger.warn(`Unable to refresh live queue estimate for salon ${salonId}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    const due = await this.prisma.queueEntry.findMany({
      where: {
        status: QueueEntryStatus.WAITING,
        arrivedAt: null,
        arrivalPromptSentAt: null,
        estimatedWaitMinutes: { gte: 0, lte: LIVE_QUEUE_ARRIVAL_LEAD_MINUTES },
      },
      select: {
        id: true,
        salonId: true,
        customerId: true,
        tokenNumber: true,
        salon: { select: { ownerUserId: true } },
      },
      take: MAX_REMINDERS_PER_SWEEP,
      orderBy: { joinedAt: 'asc' },
    });
    let sent = 0;
    for (const row of due) {
      const now = new Date();
      const claimed = await this.prisma.queueEntry.updateMany({
        where: {
          id: row.id,
          status: QueueEntryStatus.WAITING,
          arrivedAt: null,
          arrivalPromptSentAt: null,
          estimatedWaitMinutes: { gte: 0, lte: LIVE_QUEUE_ARRIVAL_LEAD_MINUTES },
        },
        data: { arrivalPromptSentAt: now },
      });
      if (claimed.count !== 1) continue;
      const recipients = [
        { id: row.salon.ownerUserId, kind: 'owner' },
        ...(row.customerId ? [{ id: row.customerId, kind: 'customer' }] : []),
      ];
      // Stable recipient-specific dedupe keys. Delivery ledger persists in-app and push
      // attempts, and retries transient push failures independently of the queue claim.
      let failure = false;
      for (const recipient of recipients) {
        try {
          const outcome = await this.delivery.deliverToUser({
            dedupeKey: `queue-arrival:${row.id}:${recipient.kind}`,
            userId: recipient.id,
            type: 'queue.arrival_check',
            inAppPayload: {
              salonId: row.salonId,
              queueEntryId: row.id,
              tokenNumber: row.tokenNumber,
              role: recipient.kind,
            },
            deepLink: recipient.kind === 'owner'
              ? `dashboard/salons/${row.salonId}/queue`
              : 'queue',
            push: {
              category: NotificationCategory.QUEUE_UPDATES,
              title: 'FastQue · Arrival confirmation',
              body: recipient.kind === 'owner'
                ? `Customer token #${row.tokenNumber} is approximately 10 minutes away. Confirm arrival at your shop.`
                : `Your service is approximately 10 minutes away. Have you arrived at the shop?`,
              data: {
                type: 'queue.arrival_check',
                salonId: row.salonId,
                queueEntryId: row.id,
              },
            },
          });
          if (outcome.inApp === 'FAILED' || outcome.push === 'FAILED') failure = true;
        } catch (err) {
          failure = true;
          this.logger.warn(`Live Queue arrival dispatch failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
      // If the ledger could not record the event, release the claim so the next sweep
      // can retry; already-delivered recipients cannot duplicate due to ledger keys.
      if (failure) {
        await this.prisma.queueEntry.updateMany({
          where: { id: row.id, arrivalPromptSentAt: now },
          data: { arrivalPromptSentAt: null },
        });
        continue;
      }
      this.realtime.emitQueueUpdated(row.salonId);
      sent++;
    }
    return sent;
  }
}
