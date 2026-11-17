/**
 * Live-visit add-on mission (17 Nov 2026) — owner rule: "after crossing the service time, all
 * notifications should auto expire; never show an expired notification on customer and owner devices".
 *
 * The server stamps every time-bound push with `data.expiresAt` (ISO 8601) and also asks Apple/Google to
 * drop it at that instant if the phone could not be reached. This module is the phone's own guard for
 * the rest: a push that still arrives late is not shown, not spoken and not acted on, and expired
 * notices already sitting in the notification tray are removed when the app comes to the foreground.
 * Pushes without `expiresAt` (older servers, non time-bound notices) are never treated as expired.
 */
export function pushExpiresAt(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as { expiresAt?: unknown }).expiresAt;
  if (typeof raw !== 'string') return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

export function isPushExpired(data: unknown, now: number = Date.now()): boolean {
  const at = pushExpiresAt(data);
  return at !== null && at <= now;
}

/** What the OS should do with an expired push that arrives while the app is open: nothing. */
export function expiredPushBehavior() {
  return {
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  };
}

interface PresentedNotification {
  request: { identifier: string; content: { data?: unknown } };
}

/**
 * Removes expired notices from the notification tray. Best effort: a native hiccup never throws.
 * Dependencies are injected so this stays testable without the native module.
 */
export async function dismissExpiredPresentedNotifications(
  api: {
    getPresentedNotificationsAsync: () => Promise<PresentedNotification[]>;
    dismissNotificationAsync: (identifier: string) => Promise<void>;
  },
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  try {
    const presented = await api.getPresentedNotificationsAsync();
    for (const n of presented) {
      if (!isPushExpired(n.request.content.data, now)) continue;
      try {
        await api.dismissNotificationAsync(n.request.identifier);
        removed += 1;
      } catch {
        // One stubborn notice must not stop the others from being removed.
      }
    }
  } catch {
    // Reading the tray is best effort.
  }
  return removed;
}
