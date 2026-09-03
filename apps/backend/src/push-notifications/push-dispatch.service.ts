import { Injectable, Logger } from '@nestjs/common';
import type { PushDevice } from '@prisma/client';
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
  ) {}

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
