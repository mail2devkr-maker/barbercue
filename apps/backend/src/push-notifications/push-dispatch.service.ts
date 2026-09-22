import { Injectable, Logger } from '@nestjs/common';
import type { PushDevice } from '@prisma/client';
import {
  Language,
  NotificationCategory,
  NotificationChannel,
  pushCopyFor,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isNotificationEnabled } from '../notifications/notification-preference';
import { PushDeviceService } from './push-device.service';
import {
  ExpoPushSender,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from './expo-push-sender';

export interface PushPayload {
  // Required, not optional: every push belongs to a notification category, and the user's PUSH
  // preference for that category is checked before anything is sent (see dispatchToUser). Making it
  // mandatory means no future push can bypass the gate by simply omitting it.
  category: NotificationCategory;
  title: string;
  body: string;
  /** Ids-only, same convention as RealtimeGateway's emits — never customer PII. */
  data?: Record<string, unknown>;
  categoryId?: string;
  channelId?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

// The Android channel the mobile app creates at push registration (lib/push-notifications.ts:
// ANDROID_BOOKING_CHANNEL_ID) — HIGH importance, default sound, vibration. The arrival check is
// the one push where silence defeats its purpose, so it names the channel explicitly and requests
// the default tone rather than relying on Expo/FCM's fallback channel.
const ANDROID_BOOKING_CHANNEL_ID = 'booking-updates';

type PushKind = 'newBooking' | 'bookingRescheduled' | 'bookingCancelled' | 'arrivalCheck';

// Which preference category governs each push kind. Typed as a full Record so adding a kind without
// deciding its category is a compile error.
const PUSH_KIND_CATEGORY: Record<PushKind, NotificationCategory> = {
  newBooking: NotificationCategory.BOOKING_UPDATES,
  bookingRescheduled: NotificationCategory.BOOKING_UPDATES,
  bookingCancelled: NotificationCategory.BOOKING_UPDATES,
  arrivalCheck: NotificationCategory.ARRIVAL_ALERTS,
};

// Only for log lines — never the full token. A stable-but-non-reversible-looking prefix is enough
// to correlate log lines with a specific device during debugging without exposing the credential.
function redactToken(token: string): string {
  return `${token.slice(0, 12)}…(${token.length} chars)`;
}

@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    private readonly devices: PushDeviceService,
    private readonly expo: ExpoPushSender,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Booking-lifecycle push, localized to the recipient's own preferredLanguage.
   *
   * Root-cause fix for a Build 9 physical-device defect: `dispatchToUser`'s title/body were
   * previously built by the caller (bookings.service.ts) as hardcoded English literals, so an
   * owner with Hindi selected still received an English push regardless. This method is the one
   * place that decides push copy for a booking event, so bookings.service.ts's create() and
   * cancel() call sites can never drift apart on how they localize (the same class of bug
   * newBookingReceived/bookingCancelled's shared VoiceAnnouncements already prevents for speech).
   *
   * A missing/unset preferredLanguage — or this lookup itself failing — degrades to English via
   * pushCopyFor's own fallback, never blocks the push.
   */
  async dispatchLocalizedToUser(
    userId: string,
    kind: PushKind,
    serviceName: string | null,
    data: Record<string, unknown>,
  ): Promise<void> {
    let preferredLanguage: Language | null = null;
    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
      });
      preferredLanguage = recipient?.preferredLanguage ?? null;
    } catch (err) {
      this.logger.warn(`Could not load recipient language, defaulting to English push copy: ${errorMessage(err)}`);
    }
    const { title, body } = pushCopyFor(preferredLanguage)[kind](serviceName);
    await this.dispatchToUser(userId, {
      category: PUSH_KIND_CATEGORY[kind],
      title,
      body,
      data,
      ...(kind === 'arrivalCheck'
        ? {
            categoryId: 'booking_arrival_check',
            channelId: ANDROID_BOOKING_CHANNEL_ID,
            sound: 'default' as const,
            priority: 'high' as const,
          }
        : {}),
    });
  }

  /**
   * Reads (never writes) the user's PUSH preference. No stored row means the default, which is ON.
   * If the preference itself cannot be read the push is still sent: an unreadable preference is
   * "unknown", not "off", and these are operational alerts - the failure is logged, not silent.
   */
  private async isPushEnabled(userId: string, category: NotificationCategory): Promise<boolean> {
    try {
      return await isNotificationEnabled(this.prisma, userId, category, NotificationChannel.PUSH);
    } catch (err) {
      this.logger.warn(`Could not read push preference, sending by default: ${errorMessage(err)}`);
      return true;
    }
  }

  /**
   * Fire-and-forget from the caller's perspective (see bookings.service.ts's call site: `void
   * this.pushDispatch.dispatchToUser(...)`) — a push failure must never affect booking success,
   * so every failure mode here is caught and logged, never rethrown. No-op with zero registered
   * devices (the overwhelmingly common case until owners actually install a build with push
   * registration wired — Codex's mobile-side half of this handoff).
   */
  async dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
    // The user's PUSH preference for this category is authoritative for whether FastQue sends at
    // all. It is checked first, before even loading device tokens, so an OFF category costs
    // nothing and reaches no device. (Whether a phone then shows/sounds it is up to the OS.)
    if (!(await this.isPushEnabled(userId, payload.category))) return;

    let devices: PushDevice[];
    try {
      devices = await this.devices.devicesForUser(userId);
    } catch (err) {
      this.logger.warn(`Could not load push devices: ${errorMessage(err)}`);
      return;
    }
    if (devices.length === 0) return;

    const messages: ExpoPushMessage[] = devices.map((device) => ({
      to: device.expoPushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
      ...(payload.channelId ? { channelId: payload.channelId } : {}),
      ...(payload.sound !== undefined ? { sound: payload.sound } : {}),
      ...(payload.priority ? { priority: payload.priority } : {}),
    }));

    let tickets: ExpoPushTicket[];
    try {
      tickets = await this.expo.send(messages);
    } catch (err) {
      this.logger.warn(`Expo push dispatch failed: ${errorMessage(err)}`);
      return;
    }

    const staleTokens: string[] = [];
    tickets.forEach((ticket, index) => {
      const device = devices[index];
      if (!device) return;
      if (ticket.status === 'error') {
        this.logger.warn(
          `Push ticket error for device ${redactToken(device.expoPushToken)}: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`,
        );
        if (ticket.details?.error === 'DeviceNotRegistered') {
          staleTokens.push(device.expoPushToken);
        }
      }
    });

    if (staleTokens.length > 0) {
      await this.devices
        .removeStaleTokens(staleTokens)
        .catch((err: unknown) =>
          this.logger.warn(
            `Could not remove stale push tokens: ${errorMessage(err)}`,
          ),
        );
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}
