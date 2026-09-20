import { NotificationCategory, NotificationChannel } from '../enums';
import {
  ALL_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_DEFAULT_ENABLED,
  OPERATIONAL_NOTIFICATION_CATEGORIES,
  SETTINGS_NOTIFICATION_CHANNELS,
  isNotificationPreferenceRequired,
  isOperationalNotificationCategory,
  resolveNotificationPreference,
} from '../notification-preferences';
import { setNotificationPreferenceSchema } from '../schemas';
import { uiStringsFor } from '../i18n';
import { Language } from '../enums';

describe('notification preference defaults', () => {
  it('every category has an explicit default, and every operational category defaults ON', () => {
    for (const category of Object.values(NotificationCategory)) {
      expect(typeof NOTIFICATION_CATEGORY_DEFAULT_ENABLED[category]).toBe('boolean');
    }
    for (const category of OPERATIONAL_NOTIFICATION_CATEGORIES) {
      expect(NOTIFICATION_CATEGORY_DEFAULT_ENABLED[category]).toBe(true);
    }
  });

  it('the four operational categories and the separate promotional one are all covered, promotional last', () => {
    expect([...OPERATIONAL_NOTIFICATION_CATEGORIES]).toEqual([
      'BOOKING_UPDATES',
      'QUEUE_UPDATES',
      'ARRIVAL_ALERTS',
      'REMINDERS',
    ]);
    expect(ALL_NOTIFICATION_CATEGORIES[ALL_NOTIFICATION_CATEGORIES.length - 1]).toBe('PROMOTIONAL');
    expect(isOperationalNotificationCategory(NotificationCategory.PROMOTIONAL)).toBe(false);
    expect(isOperationalNotificationCategory(NotificationCategory.ARRIVAL_ALERTS)).toBe(true);
  });

  it('users can control push and the in-app list', () => {
    expect([...SETTINGS_NOTIFICATION_CHANNELS]).toEqual([NotificationChannel.PUSH, NotificationChannel.IN_APP]);
  });
});

describe('resolveNotificationPreference', () => {
  it('no stored value (never configured) resolves to the default - ON', () => {
    for (const category of ALL_NOTIFICATION_CATEGORIES) {
      expect(resolveNotificationPreference(undefined, category)).toBe(true);
      expect(resolveNotificationPreference(null, category)).toBe(true);
    }
  });

  it('an explicit OFF is honoured, and an explicit ON is honoured', () => {
    expect(resolveNotificationPreference(false, NotificationCategory.ARRIVAL_ALERTS)).toBe(false);
    expect(resolveNotificationPreference(true, NotificationCategory.ARRIVAL_ALERTS)).toBe(true);
  });
});

describe('setNotificationPreferenceSchema', () => {
  it.each(ALL_NOTIFICATION_CATEGORIES)('accepts %s on PUSH and IN_APP', (category) => {
    for (const channel of SETTINGS_NOTIFICATION_CHANNELS) {
      expect(setNotificationPreferenceSchema.safeParse({ category, channel, enabled: false }).success).toBe(true);
    }
  });

  it('rejects an unknown category', () => {
    expect(
      setNotificationPreferenceSchema.safeParse({ category: 'NOPE', channel: 'PUSH', enabled: true }).success,
    ).toBe(false);
  });
});

describe('settings copy', () => {
  it.each([Language.EN, Language.HI])('has every notification-settings string in %s', (language) => {
    const t = uiStringsFor(language) as unknown as Record<string, string>;
    for (const key of [
      'notificationSettingsTitle',
      'notificationSettingsOsNote',
      'notificationCategoryBookingTitle',
      'notificationCategoryQueueTitle',
      'notificationCategoryArrivalTitle',
      'notificationCategoryRemindersTitle',
      'notificationCategoryPromoTitle',
      'notificationChannelPush',
      'notificationChannelInApp',
      'notificationSettingsSaveFailed',
    ]) {
      expect(t[key]).toBeTruthy();
    }
  });

  it('Hindi is really Hindi, not the English fallback', () => {
    expect(uiStringsFor(Language.HI).notificationSettingsTitle).not.toBe(uiStringsFor(Language.EN).notificationSettingsTitle);
  });
});

describe('the critical arrival prompt is a required preference', () => {
  it('only ARRIVAL_ALERTS on PUSH is required', () => {
    const required: string[] = [];
    for (const category of ALL_NOTIFICATION_CATEGORIES) {
      for (const channel of Object.values(NotificationChannel)) {
        if (isNotificationPreferenceRequired(category, channel)) required.push(`${category}:${channel}`);
      }
    }
    expect(required).toEqual(['ARRIVAL_ALERTS:PUSH']);
  });

  it('a required preference resolves ON whatever is stored - even a stale OFF row', () => {
    expect(
      resolveNotificationPreference(false, NotificationCategory.ARRIVAL_ALERTS, NotificationChannel.PUSH),
    ).toBe(true);
    expect(
      resolveNotificationPreference(undefined, NotificationCategory.ARRIVAL_ALERTS, NotificationChannel.PUSH),
    ).toBe(true);
  });

  it('the supplemental arrival in-app entry and every other pair still honour an explicit OFF', () => {
    expect(
      resolveNotificationPreference(false, NotificationCategory.ARRIVAL_ALERTS, NotificationChannel.IN_APP),
    ).toBe(false);
    expect(
      resolveNotificationPreference(false, NotificationCategory.BOOKING_UPDATES, NotificationChannel.PUSH),
    ).toBe(false);
    // Callers that do not pass a channel keep the old behaviour.
    expect(resolveNotificationPreference(false, NotificationCategory.ARRIVAL_ALERTS)).toBe(false);
  });
});

describe('arrival readiness / required-screen copy', () => {
  it.each([Language.EN, Language.HI])('has every mandatory-arrival string in %s', (language) => {
    const t = uiStringsFor(language) as unknown as Record<string, string>;
    for (const key of [
      'notificationSettingsArrivalNote',
      'notificationRequiredBadge',
      'arrivalReadinessTitle',
      'arrivalReadinessReady',
      'arrivalFullScreenAccessTitle',
      'arrivalFullScreenAccessBody',
      'arrivalFullScreenAccessAction',
      'arrivalNotificationsOffTitle',
      'arrivalNotificationsOffBody',
      'arrivalNotificationsOffAction',
    ]) {
      expect(t[key]).toBeTruthy();
    }
  });

  it('the required-screen note says the screen cannot be turned off and that settings only control extra alerts', () => {
    expect(uiStringsFor(Language.EN).notificationSettingsArrivalNote).toBe(
      'Arrival confirmation screens are required for shop operations and always appear when FastQue needs an arrival decision. Notification settings control additional alerts, not the required arrival screen.',
    );
  });
});
