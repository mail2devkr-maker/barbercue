import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  type NotificationType,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { PushDispatchService } from '../push-notifications/push-dispatch.service';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';

/** Seconds to wait before attempt N+1 after attempt N failed transiently (index = attempts so far - 1). */
export const PUSH_RETRY_BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600] as const;
export const PUSH_MAX_ATTEMPTS = PUSH_RETRY_BACKOFF_SECONDS.length;
/** A claimed-but-unfinished attempt is retried no sooner than this (crash safety, multi-instance safety). */
const ATTEMPT_LEASE_SECONDS = 120;

export interface DeliverToUserInput {
  /** Stable identity of the event, e.g. `booking.cancelled_by_shop:<bookingId>`. */
  dedupeKey: string;
  userId: string;
  type: NotificationType;
  inAppPayload: Record<string, unknown>;
  deepLink: string;
  push: {
    title: string;
    body: string;
    /** Ids-only (never PII), same convention as every other push in the codebase. */
    data: Record<string, unknown>;
    category: NotificationCategory;
  };
}

export interface DeliveryOutcome {
  inApp: NotificationDeliveryStatus;
  push: NotificationDeliveryStatus | 'NO_DEVICE';
}

interface StoredPushPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * The delivery ledger for notifications whose delivery must be idempotent and observable.
 *
 *  - IDEMPOTENT: one `NotificationDelivery` row per (event, channel) with a UNIQUE `dedupeKey`, so a
 *    retried request, a double-click or two app instances can never produce a second notification.
 *  - HONEST: the row records what really happened. SENT means Expo accepted the push for at least
 *    one device; "no registered device" and "recipient turned push off" are SKIPPED (with the
 *    reason), never reported as sent. No SMS/e-mail is attempted or claimed — those providers are
 *    not wired in this product.
 *  - RETRIED: a transient provider failure is retried with exponential backoff up to
 *    PUSH_MAX_ATTEMPTS, then marked GAVE_UP. The business action that triggered the notification
 *    (e.g. the cancellation) has already committed and is never rolled back by a delivery problem.
 */
@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly push: PushDispatchService,
    @Optional() private readonly deadlineScheduler?: DbDeadlineSchedulerService,
  ) {}

  onModuleInit(): void {
    this.deadlineScheduler?.register({
      name: 'notification-delivery-retry',
      domain: 'booking',
      nextDueAt: () => this.findNextDueAt(),
      runDue: async () => {
        const handled = await this.sweepRetries();
        if (handled > 0)
          this.logger.log(
            `Retried ${handled} push notification delivery attempt(s).`,
          );
      },
    });
  }

  async deliverToUser(input: DeliverToUserInput): Promise<DeliveryOutcome> {
    const inApp = await this.deliverInApp(input);
    const push = await this.deliverPush(input);
    return { inApp, push };
  }

  // ---------- IN_APP ----------

  private async deliverInApp(
    input: DeliverToUserInput,
  ): Promise<NotificationDeliveryStatus> {
    const dedupeKey = `${input.dedupeKey}:IN_APP`;
    const existing = await this.prisma.notificationDelivery.findUnique({
      where: { dedupeKey },
    });
    if (existing) return existing.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.notificationDelivery.create({
          data: {
            dedupeKey,
            userId: input.userId,
            type: input.type,
            channel: NotificationChannel.IN_APP,
            status: NotificationDeliveryStatus.PENDING,
            attempts: 1,
            deepLink: input.deepLink,
          },
        });
        // The notification row and its ledger row commit together: either both exist or neither.
        const created = await this.notifications.notifyInTransaction(
          tx,
          input.userId,
          input.type,
          input.inAppPayload,
          input.deepLink,
        );
        const status = created
          ? NotificationDeliveryStatus.SENT
          : NotificationDeliveryStatus.SKIPPED;
        await tx.notificationDelivery.update({
          where: { dedupeKey },
          data: {
            status,
            sentAt: created ? new Date() : null,
            lastError: created ? null : 'IN_APP_DISABLED_BY_RECIPIENT',
          },
        });
        return status;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Lost a race with a concurrent identical request: report the winner's outcome.
        const winner = await this.prisma.notificationDelivery.findUnique({
          where: { dedupeKey },
        });
        return winner?.status ?? NotificationDeliveryStatus.SENT;
      }
      this.logger.warn(
        `In-app delivery failed for ${dedupeKey}: ${errorMessage(err)}`,
      );
      return NotificationDeliveryStatus.FAILED;
    }
  }

  // ---------- PUSH ----------

  private async deliverPush(
    input: DeliverToUserInput,
  ): Promise<NotificationDeliveryStatus | 'NO_DEVICE'> {
    const dedupeKey = `${input.dedupeKey}:PUSH`;
    const existing = await this.prisma.notificationDelivery.findUnique({
      where: { dedupeKey },
    });
    if (existing)
      return this.toPushOutcome(existing.status, existing.lastError);

    const stored: StoredPushPayload = {
      title: input.push.title,
      body: input.push.body,
      data: input.push.data,
    };
    try {
      await this.prisma.notificationDelivery.create({
        data: {
          dedupeKey,
          userId: input.userId,
          type: input.type,
          channel: NotificationChannel.PUSH,
          status: NotificationDeliveryStatus.PENDING,
          attempts: 0,
          payload: stored as unknown as Prisma.InputJsonValue,
          deepLink: input.deepLink,
          // Lease: if this process dies before recording the outcome, the sweep picks it up later.
          nextAttemptAt: new Date(Date.now() + ATTEMPT_LEASE_SECONDS * 1000),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.prisma.notificationDelivery.findUnique({
          where: { dedupeKey },
        });
        return winner
          ? this.toPushOutcome(winner.status, winner.lastError)
          : NotificationDeliveryStatus.PENDING;
      }
      this.logger.warn(
        `Could not record push delivery ${dedupeKey}: ${errorMessage(err)}`,
      );
      return NotificationDeliveryStatus.FAILED;
    }

    if (!(await this.push.isPushAllowed(input.userId, input.push.category))) {
      await this.finish(
        dedupeKey,
        NotificationDeliveryStatus.SKIPPED,
        'PUSH_DISABLED_BY_RECIPIENT',
        0,
      );
      return NotificationDeliveryStatus.SKIPPED;
    }
    return this.attemptPush(dedupeKey, input.userId, stored, 0);
  }

  /** One provider attempt; records the outcome on the ledger row and returns it. */
  private async attemptPush(
    dedupeKey: string,
    userId: string,
    payload: StoredPushPayload,
    attemptsBefore: number,
  ): Promise<NotificationDeliveryStatus | 'NO_DEVICE'> {
    const attempts = attemptsBefore + 1;
    const result = await this.push.sendToUser(userId, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
      channelId: 'booking-updates',
      priority: 'high',
      // Live Queue arrival checks require audible OS notification when user permissions permit.
      ...(payload.data.type === 'queue.arrival_check' ? { sound: 'default' as const } : {}),
    });

    if (result.noDevices) {
      await this.finish(
        dedupeKey,
        NotificationDeliveryStatus.SKIPPED,
        'NO_DEVICE',
        attempts,
      );
      return 'NO_DEVICE';
    }
    if (result.delivered > 0) {
      await this.finish(
        dedupeKey,
        NotificationDeliveryStatus.SENT,
        null,
        attempts,
      );
      return NotificationDeliveryStatus.SENT;
    }
    if (!result.transientFailure) {
      // The provider answered and rejected every ticket (e.g. unregistered devices): retrying the
      // same payload cannot succeed.
      await this.finish(
        dedupeKey,
        NotificationDeliveryStatus.GAVE_UP,
        result.error ?? 'REJECTED',
        attempts,
      );
      return NotificationDeliveryStatus.GAVE_UP;
    }
    if (attempts >= PUSH_MAX_ATTEMPTS) {
      await this.finish(
        dedupeKey,
        NotificationDeliveryStatus.GAVE_UP,
        result.error ?? 'TRANSIENT_FAILURE',
        attempts,
      );
      return NotificationDeliveryStatus.GAVE_UP;
    }
    const delaySeconds = PUSH_RETRY_BACKOFF_SECONDS[attempts - 1];
    await this.prisma.notificationDelivery.update({
      where: { dedupeKey },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        attempts,
        lastError: truncate(result.error ?? 'TRANSIENT_FAILURE'),
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
      },
    });
    return NotificationDeliveryStatus.FAILED;
  }

  private async finish(
    dedupeKey: string,
    status: NotificationDeliveryStatus,
    lastError: string | null,
    attempts: number,
  ): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { dedupeKey },
      data: {
        status,
        attempts,
        lastError: lastError ? truncate(lastError) : null,
        nextAttemptAt: null,
        sentAt: status === NotificationDeliveryStatus.SENT ? new Date() : null,
      },
    });
  }

  private toPushOutcome(
    status: NotificationDeliveryStatus,
    lastError: string | null,
  ): NotificationDeliveryStatus | 'NO_DEVICE' {
    return status === NotificationDeliveryStatus.SKIPPED &&
      lastError === 'NO_DEVICE'
      ? 'NO_DEVICE'
      : status;
  }

  // ---------- Retry sweep ----------

  async findNextDueAt(): Promise<Date | null> {
    const next = await this.prisma.notificationDelivery.findFirst({
      where: {
        channel: NotificationChannel.PUSH,
        status: {
          in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.FAILED,
          ],
        },
        attempts: { lt: PUSH_MAX_ATTEMPTS },
        nextAttemptAt: { not: null },
      },
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true },
    });
    return next?.nextAttemptAt ?? null;
  }

  /** Retries due push deliveries. Returns how many attempts were made. */
  async sweepRetries(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.PUSH,
        status: {
          in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.FAILED,
          ],
        },
        attempts: { lt: PUSH_MAX_ATTEMPTS },
        nextAttemptAt: { lte: now },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });

    let handled = 0;
    for (const row of due) {
      // Claim the attempt by moving nextAttemptAt forward; a concurrent instance that read the
      // same row fails this conditional update and skips it.
      const claim = await this.prisma.notificationDelivery.updateMany({
        where: {
          id: row.id,
          status: {
            in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.FAILED,
            ],
          },
          nextAttemptAt: row.nextAttemptAt,
        },
        data: {
          nextAttemptAt: new Date(now.getTime() + ATTEMPT_LEASE_SECONDS * 1000),
        },
      });
      if (claim.count === 0) continue;

      const payload = row.payload as unknown as StoredPushPayload | null;
      if (!payload) {
        await this.finish(
          row.dedupeKey,
          NotificationDeliveryStatus.GAVE_UP,
          'MISSING_PAYLOAD',
          row.attempts,
        );
        continue;
      }
      await this.attemptPush(row.dedupeKey, row.userId, payload, row.attempts);
      handled += 1;
    }
    return handled;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

function truncate(value: string): string {
  return value.length > 290 ? `${value.slice(0, 290)}…` : value;
}
