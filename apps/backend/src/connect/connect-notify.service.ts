import { Injectable, Logger } from '@nestjs/common';
import type { ConnectConversation } from '@prisma/client';
import { NotificationCategory, type NotificationType } from '@barbercue/shared';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ConnectAccessService } from './connect-access.service';
import { ConnectConfigService } from './connect-config';

export const customerLink = (convId: string) => `/account/messages?c=${convId}`;
export const salonLink = (conv: Pick<ConnectConversation, 'id' | 'salonId'>) =>
  conv.salonId
    ? `/dashboard/salons/${conv.salonId}/connect?c=${conv.id}`
    : `/home-pro/messages?c=${conv.id}`;

/**
 * Connect's use of the central notification system (spec section 16). Realtime pulses are ids
 * only. Durable notices go through NotificationDeliveryService with a dedupe key per conversation,
 * recipient and time bucket, so a burst of messages produces one notice, never one per message.
 * Push bodies carry no message text unless the recipient turned previews on.
 */
@Injectable()
export class ConnectNotifyService {
  private readonly logger = new Logger(ConnectNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
    private readonly realtime: RealtimeGateway,
    private readonly access: ConnectAccessService,
    private readonly config: ConnectConfigService,
  ) {}

  /** Everyone on the other side of `fromSide` (or both sides when null). */
  async recipients(
    conv: ConnectConversation,
    fromSide: 'CUSTOMER' | 'SALON' | null,
  ): Promise<{ userId: string; side: 'CUSTOMER' | 'SALON' }[]> {
    const out: { userId: string; side: 'CUSTOMER' | 'SALON' }[] = [];
    if (fromSide !== 'CUSTOMER')
      out.push({ userId: conv.customerId, side: 'CUSTOMER' });
    if (fromSide !== 'SALON') {
      const staff = await this.access.tenantUserIds(
        conv,
        conv.assignedToUserId,
      );
      for (const userId of staff)
        if (userId !== conv.customerId) out.push({ userId, side: 'SALON' });
    }
    return out;
  }

  pulse(
    userIds: string[],
    event: string,
    payload: Record<string, unknown>,
  ): void {
    for (const id of new Set(userIds)) {
      try {
        this.realtime.emitToUser(id, event, payload);
      } catch {
        /* a socket problem never affects the request */
      }
    }
  }

  /** New message: pulse everyone (including other staff, for collision awareness), notify the other side. */
  async message(
    conv: ConnectConversation,
    msg: { seq: number; body: string | null; senderUserId: string | null },
    fromSide: 'CUSTOMER' | 'SALON' | null,
    opts: { urgent?: boolean } = {},
  ): Promise<void> {
    const all = await this.recipients(conv, null);
    this.pulse(
      all.map((r) => r.userId),
      'connect.message',
      { conversationId: conv.id, seq: msg.seq },
    );
    const targets = (await this.recipients(conv, fromSide)).filter(
      (r) => r.userId !== msg.senderUserId,
    );
    if (!targets.length) return;
    const cfg = await this.config.get();
    const bucket = Math.floor(
      Date.now() /
        (Math.max(1, cfg.notifications.unreadThrottleMinutes) * 60_000),
    );
    const parts = await this.prisma.connectParticipant.findMany({
      where: {
        conversationId: conv.id,
        userId: { in: targets.map((t) => t.userId) },
      },
      select: { userId: true, muted: true, lastReadSeq: true },
    });
    const prefs = await this.prisma.connectUserPrefs.findMany({
      where: { userId: { in: targets.map((t) => t.userId) } },
      select: { userId: true, notificationPreviews: true },
    });
    const title = await this.title(conv);
    for (const t of targets) {
      const p = parts.find((x) => x.userId === t.userId);
      if (p?.muted && !opts.urgent) continue;
      const preview =
        prefs.find((x) => x.userId === t.userId)?.notificationPreviews &&
        msg.body
          ? msg.body.slice(0, 90)
          : null;
      const type: NotificationType =
        opts.urgent && t.side === 'SALON'
          ? 'connect.urgent'
          : 'connect.message';
      await this.deliver({
        dedupeKey: `${type}:${conv.id}:${t.userId}:${opts.urgent ? `u${msg.seq}` : bucket}`,
        userId: t.userId,
        type,
        title: t.side === 'CUSTOMER' ? title.forCustomer : title.forSalon,
        body:
          preview ??
          (opts.urgent
            ? 'A customer conversation needs attention.'
            : 'You have a new message about a booking.'),
        deepLink:
          t.side === 'CUSTOMER' ? customerLink(conv.id) : salonLink(conv),
        conversationId: conv.id,
      });
    }
  }

  /** A card changed (action, quotation, ticket). */
  async update(
    conv: ConnectConversation,
    to: 'CUSTOMER' | 'SALON' | 'BOTH',
    key: string,
    body: string,
  ): Promise<void> {
    const all = await this.recipients(conv, null);
    this.pulse(
      all.map((r) => r.userId),
      'connect.updated',
      { conversationId: conv.id },
    );
    const title = await this.title(conv);
    for (const r of all) {
      if (to !== 'BOTH' && r.side !== to) continue;
      await this.deliver({
        dedupeKey: `connect.update:${conv.id}:${key}:${r.userId}`,
        userId: r.userId,
        type: 'connect.update',
        title: r.side === 'CUSTOMER' ? title.forCustomer : title.forSalon,
        body,
        deepLink:
          r.side === 'CUSTOMER' ? customerLink(conv.id) : salonLink(conv),
        conversationId: conv.id,
      });
    }
  }

  private async title(
    conv: ConnectConversation,
  ): Promise<{ forCustomer: string; forSalon: string }> {
    let name = 'Your salon';
    if (conv.salonId)
      name =
        (
          await this.prisma.salon.findUnique({
            where: { id: conv.salonId },
            select: { name: true },
          })
        )?.name ?? name;
    else if (conv.homeProviderId)
      name =
        (
          await this.prisma.homeProvider.findUnique({
            where: { id: conv.homeProviderId },
            select: { displayName: true },
          })
        )?.displayName ?? name;
    return { forCustomer: name, forSalon: 'FastQue Connect' };
  }

  private async deliver(n: {
    dedupeKey: string;
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    deepLink: string;
    conversationId: string;
  }) {
    try {
      await this.delivery.deliverToUser({
        dedupeKey: n.dedupeKey,
        userId: n.userId,
        type: n.type,
        inAppPayload: {
          title: n.title,
          body: n.body,
          conversationId: n.conversationId,
        },
        deepLink: n.deepLink,
        push: {
          title: n.title,
          body: n.body,
          data: {
            type: n.type,
            conversationId: n.conversationId,
            deepLink: n.deepLink,
          },
          category: NotificationCategory.BOOKING_UPDATES,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Connect notification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
