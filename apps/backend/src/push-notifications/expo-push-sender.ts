import { Injectable } from '@nestjs/common';

/**
 * Thin wrapper around Expo's push API (https://exp.host/--/api/v2/push/send) — plain HTTP, no
 * `expo-server-sdk` dependency needed for this minimal use (one HTTP call, no push-receipt
 * polling). No API key/credential is required for basic delivery: Expo authenticates a push
 * purely by the token itself, which is why this half of the pipeline needed no external
 * credential to build (see Issue #13 Mission L reconciliation).
 */
export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Both historical Expo token prefixes are valid; accepting a token this loosely shaped and
// letting Expo's own API be the real authority avoids this service silently dropping a
// legitimately-formatted token Expo would have accepted.
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

export function isPlausibleExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_PATTERN.test(token);
}

export interface ExpoPushMessage {
  to: string;
  // Omitted for a DATA-ONLY message (see PushPayload.dataOnly): with no title/body Expo sends no FCM
  // `notification` block, so Android hands the message to the app's own messaging service even when the
  // app is backgrounded, locked or killed. With a title/body, Android's FCM SDK shows the notification
  // itself and never calls the app - which is exactly why it cannot wake a locked screen.
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  /** Seconds FCM may keep the message while the device is offline. */
  ttl?: number;
  categoryId?: string;
  // Android delivery hints. `channelId` must name a channel the app has already created (the app
  // creates 'booking-updates' at push registration); `sound` requests the default alert tone and
  // `priority` asks FCM for heads-up delivery. All subject to the user's OS notification, volume
  // and Do-Not-Disturb settings — FastQue cannot and does not override those.
  channelId?: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class ExpoPushSender {
  /**
   * Sends a batch in one request (Expo's own recommended shape) and returns one ticket per
   * message, in the same order. Never throws on a per-message delivery failure — Expo reports
   * those as `status: 'error'` tickets, not HTTP errors — only on the request itself failing
   * (network error, malformed response), which the caller treats as "nothing delivered this
   * round" rather than crashing the booking flow that triggered it.
   */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) return [];
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      throw new Error(`Expo push API responded ${response.status}`);
    }
    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    return payload.data ?? [];
  }
}
