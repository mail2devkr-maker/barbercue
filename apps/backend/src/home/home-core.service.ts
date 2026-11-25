import { createHash, randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HOME_DEFAULT_SETTINGS,
  NotificationCategory,
  homeSettingsSchema,
  type HomeSettings,
  type NotificationType,
} from '@barbercue/shared';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { PrismaService } from '../prisma/prisma.service';

export type Db = PrismaService | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;
export const TX = { timeout: 20_000, maxWait: 10_000 } as const;

export const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const newBookingCode = () =>
  `FQH-${randomBytes(5).toString('hex').toUpperCase()}`;
export const addMin = (d: Date, m: number) =>
  new Date(d.getTime() + m * 60_000);
export const minutesBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 60_000);

/** Settings, audit, history and notifications shared by every FastQue Home service. */
@Injectable()
export class HomeCoreService {
  private readonly logger = new Logger(HomeCoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async settings(db: Db = this.prisma): Promise<HomeSettings> {
    const row = await db.homeSetting.findUnique({ where: { key: 'ops' } });
    const parsed = homeSettingsSchema.partial().safeParse(row?.value ?? {});
    return { ...HOME_DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
  }

  async saveSettings(userId: string, patch: Partial<HomeSettings>) {
    const next = { ...(await this.settings()), ...patch };
    await this.prisma.$transaction(async (tx) => {
      await tx.homeSetting.upsert({
        where: { key: 'ops' },
        create: { key: 'ops', value: next, updatedByUserId: userId },
        update: { value: next, updatedByUserId: userId },
      });
      await this.audit(tx, {
        actorUserId: userId,
        actorParty: 'ADMIN',
        action: 'SETTINGS_CHANGED',
        entityType: 'SETTING',
        entityId: 'ops',
        metadata: { patch },
      });
    });
    return next;
  }

  audit(
    db: Db,
    input: {
      actorUserId?: string | null;
      actorParty: string;
      action: string;
      entityType: string;
      entityId: string;
      note?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    return db.homeAudit.create({
      data: {
        ...input,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  event(
    db: Db,
    bookingId: string,
    input: {
      kind: string;
      from?: string | null;
      to?: string | null;
      actorUserId?: string | null;
      party: string;
      note?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) {
    return db.homeBookingEvent.create({
      data: {
        bookingId,
        kind: input.kind,
        fromStatus: input.from ?? null,
        toStatus: input.to ?? null,
        actorUserId: input.actorUserId ?? null,
        actorParty: input.party,
        note: input.note ?? null,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Deduplicated by event key through the existing delivery ledger (in-app + push, with retries).
   * Called after the business transaction commits and never fails it. No SMS/email/WhatsApp is sent.
   */
  async notify(
    userId: string | null | undefined,
    type: NotificationType,
    key: string,
    title: string,
    body: string,
    deepLink: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.delivery.deliverToUser({
        dedupeKey: `${type}:${key}:${userId}`,
        userId,
        type,
        inAppPayload: { title, body, ...payload },
        deepLink,
        push: {
          title,
          body,
          data: { type, deepLink },
          category: NotificationCategory.BOOKING_UPDATES,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Home notification ${type} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }
}
