import {
  dismissExpiredPresentedNotifications,
  expiredPushBehavior,
  isPushExpired,
  pushExpiresAt,
} from '../push-expiry';

describe('push expiry on the phone (live-visit add-on mission)', () => {
  const now = Date.parse('2026-11-17T10:00:00.000Z');

  it('reads data.expiresAt only when it is a real ISO instant', () => {
    expect(pushExpiresAt({ expiresAt: '2026-11-17T10:30:00.000Z' })).toBe(Date.parse('2026-11-17T10:30:00.000Z'));
    expect(pushExpiresAt({ expiresAt: 'soon' })).toBeNull();
    expect(pushExpiresAt({ expiresAt: 123 })).toBeNull();
    expect(pushExpiresAt({})).toBeNull();
    expect(pushExpiresAt(null)).toBeNull();
    expect(pushExpiresAt(undefined)).toBeNull();
  });

  it('treats a notice as expired at or after its moment, never before', () => {
    expect(isPushExpired({ expiresAt: '2026-11-17T09:59:59.000Z' }, now)).toBe(true);
    expect(isPushExpired({ expiresAt: '2026-11-17T10:00:00.000Z' }, now)).toBe(true);
    expect(isPushExpired({ expiresAt: '2026-11-17T10:00:01.000Z' }, now)).toBe(false);
  });

  it('never treats a notice without an expiry as expired (older servers, non time-bound notices)', () => {
    expect(isPushExpired({ type: 'booking.created' }, now)).toBe(false);
    expect(isPushExpired(undefined, now)).toBe(false);
  });

  it('an expired notice that arrives while the app is open is completely silent', () => {
    expect(expiredPushBehavior()).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });

  it('removes only expired notices from the notification tray', async () => {
    const dismissNotificationAsync = jest.fn().mockResolvedValue(undefined);
    const removed = await dismissExpiredPresentedNotifications(
      {
        getPresentedNotificationsAsync: async () => [
          { request: { identifier: 'old', content: { data: { expiresAt: '2026-11-17T09:00:00.000Z' } } } },
          { request: { identifier: 'live', content: { data: { expiresAt: '2026-11-17T11:00:00.000Z' } } } },
          { request: { identifier: 'plain', content: { data: { type: 'booking.created' } } } },
        ],
        dismissNotificationAsync,
      },
      now,
    );
    expect(removed).toBe(1);
    expect(dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(dismissNotificationAsync).toHaveBeenCalledWith('old');
  });

  it('never throws when the native notification module misbehaves', async () => {
    await expect(
      dismissExpiredPresentedNotifications(
        {
          getPresentedNotificationsAsync: async () => {
            throw new Error('native');
          },
          dismissNotificationAsync: jest.fn(),
        },
        now,
      ),
    ).resolves.toBe(0);
    const failing = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await expect(
      dismissExpiredPresentedNotifications(
        {
          getPresentedNotificationsAsync: async () => [
            { request: { identifier: 'a', content: { data: { expiresAt: '2026-11-17T09:00:00.000Z' } } } },
            { request: { identifier: 'b', content: { data: { expiresAt: '2026-11-17T09:00:00.000Z' } } } },
          ],
          dismissNotificationAsync: failing,
        },
        now,
      ),
    ).resolves.toBe(1);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
