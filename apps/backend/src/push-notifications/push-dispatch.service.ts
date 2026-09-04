import { Injectable, Logger } from '@nestjs/common';
import type { PushDevice } from '@prisma/client';
import { Language, pushCopyFor } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushDeviceService } from './push-device.service';
import {
  ExpoPushSender,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from './expo-push-sender';

export interface PushPayload {
  title: string;
  body: string;
  /** Ids-only, same convention as RealtimeGateway's emits — never customer PII. */
  data?: Record<string, unknown>;
}

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
    kind: 'newBooking' | 'bookingCancelled',
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
    await this.dispatchToUser(userId, { title, body, data });
  }

  /**
   * Fire-and-forget from the caller's perspective (see bookings.service.ts's call site: `void
   * this.pushDispatch.dispatchToUser(...)`) — a push failure must never affect booking success,
   * so every failure mode here is caught and logged, never rethrown. No-op with zero registered
   * devices (the overwhelmingly common case until owners actually install a build with push
   * registration wired — Codex's mobile-side half of this handoff).
   */
  async dispatchToUser(userId: string, payload: PushPayload): Promise<void> {
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
