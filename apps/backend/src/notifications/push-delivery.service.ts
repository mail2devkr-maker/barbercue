import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  NotificationChannel,
  NotificationStatus,
  type NotificationType,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { buildPushContent } from './push-content';
import { PUSH_SENDER, type PushMessage, type PushSender } from './push-sender';

const CLAIM_STALE_MS = 5 * 60_000;
const RECEIPT_DELAY_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const DELIVERY_BATCH_SIZE = 100;

@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  get configured(): boolean {
    return this.sender.configured;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepPending(): Promise<void> {
    await this.dispatchPending();
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepReceipts(): Promise<void> {
    await this.checkReceipts();
  }

  async dispatchPending(notificationIds?: string[]): Promise<number> {
    if (!this.sender.configured) return 0;
    const now = new Date();
    const stale = new Date(now.getTime() - CLAIM_STALE_MS);
    const candidates = await this.prisma.notification.findMany({
      where: {
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.PENDING,
        ...(notificationIds ? { id: { in: notificationIds } } : {}),
        OR: [
          { nextDeliveryAttemptAt: null },
          { nextDeliveryAttemptAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { deliveryClaimedAt: null },
              { deliveryClaimedAt: { lt: stale } },
            ],
          },
        ],
      },
      select: { id: true },
      take: DELIVERY_BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    const rows: Array<{
      id: string;
      type: string;
      payload: unknown;
      pushDeviceId: string | null;
      pushDevice: { pushToken: string; enabled: boolean } | null;
    }> = [];
    for (const candidate of candidates) {
      const claim = await this.prisma.notification.updateMany({
        where: {
          id: candidate.id,
          status: NotificationStatus.PENDING,
          OR: [
            { deliveryClaimedAt: null },
            { deliveryClaimedAt: { lt: stale } },
          ],
        },
        data: { deliveryClaimedAt: now, deliveryAttempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;
      const row = await this.prisma.notification.findUnique({
        where: { id: candidate.id },
        include: { pushDevice: { select: { pushToken: true, enabled: true } } },
      });
      if (row) rows.push(row);
    }

    const skipped = rows.filter((row) => !row.pushDevice?.enabled);
    await Promise.all(
      skipped.map((row) =>
        this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: NotificationStatus.FAILED,
            failureCode: 'DEVICE_DISABLED',
            failedAt: now,
            deliveryClaimedAt: null,
          },
        }),
      ),
    );

    const messages: PushMessage[] = rows.flatMap((row) => {
      if (!row.pushDevice?.enabled) return [];
      return [
        {
          notificationId: row.id,
          token: row.pushDevice.pushToken,
          ...buildPushContent(row.type as NotificationType, row.payload),
        },
      ];
    });
    if (messages.length === 0) return 0;

    const results = await this.sender.sendBatch(messages);
    await Promise.all(
      results.map(async (result) => {
        const row = rows.find(
          (candidate) => candidate.id === result.notificationId,
        );
        if (!row) return;
        if (result.ok && result.providerMessageId) {
          await this.prisma.notification.update({
            where: { id: row.id },
            data: {
              status: NotificationStatus.SENT,
              sentAt: new Date(),
              providerMessageId: result.providerMessageId,
              deliveryClaimedAt: null,
              nextDeliveryAttemptAt: null,
              failureCode: null,
            },
          });
          return;
        }
        if (result.invalidToken && row.pushDeviceId) {
          await this.prisma.pushDevice.updateMany({
            where: { id: row.pushDeviceId },
            data: { enabled: false },
          });
        }
        const current = await this.prisma.notification.findUnique({
          where: { id: row.id },
          select: { deliveryAttempts: true },
        });
        if (
          result.transient &&
          (current?.deliveryAttempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS
        ) {
          const delayMinutes =
            2 ** Math.max(0, (current?.deliveryAttempts ?? 1) - 1);
          await this.prisma.notification.update({
            where: { id: row.id },
            data: {
              deliveryClaimedAt: null,
              nextDeliveryAttemptAt: new Date(
                Date.now() + delayMinutes * 60_000,
              ),
              failureCode: result.errorCode ?? 'TEMPORARY_PROVIDER_FAILURE',
            },
          });
          return;
        }
        await this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: NotificationStatus.FAILED,
            failureCode: result.errorCode ?? 'PUSH_DELIVERY_FAILED',
            failedAt: new Date(),
            deliveryClaimedAt: null,
          },
        });
      }),
    );
    return results.filter((result) => result.ok).length;
  }

  async checkReceipts(): Promise<number> {
    if (!this.sender.configured) return 0;
    const rows = await this.prisma.notification.findMany({
      where: {
        channel: NotificationChannel.PUSH,
        status: NotificationStatus.SENT,
        providerMessageId: { not: null },
        providerReceiptCheckedAt: null,
        sentAt: { lte: new Date(Date.now() - RECEIPT_DELAY_MS) },
      },
      select: { id: true, pushDeviceId: true, providerMessageId: true },
      take: DELIVERY_BATCH_SIZE,
    });
    const ids = rows.flatMap((row) =>
      row.providerMessageId ? [row.providerMessageId] : [],
    );
    const receipts = await this.sender.getReceipts(ids);
    for (const receipt of receipts) {
      const row = rows.find(
        (candidate) =>
          candidate.providerMessageId === receipt.providerMessageId,
      );
      if (!row || receipt.transient) continue;
      if (receipt.invalidToken && row.pushDeviceId) {
        await this.prisma.pushDevice.updateMany({
          where: { id: row.pushDeviceId },
          data: { enabled: false },
        });
      }
      await this.prisma.notification.update({
        where: { id: row.id },
        data: receipt.ok
          ? { providerReceiptCheckedAt: new Date() }
          : {
              status: NotificationStatus.FAILED,
              providerReceiptCheckedAt: new Date(),
              failureCode: receipt.errorCode ?? 'EXPO_RECEIPT_ERROR',
              failedAt: new Date(),
            },
      });
    }
    const failed = receipts.filter(
      (receipt) => !receipt.ok && !receipt.transient,
    ).length;
    if (failed)
      this.logger.warn(
        `${failed} Expo push receipt(s) reported permanent delivery failure.`,
      );
    return receipts.filter((receipt) => receipt.ok).length;
  }
}
