/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Linking, Switch } from 'react-native';
import * as Notifications from 'expo-notifications';
import { ALL_NOTIFICATION_CATEGORIES, uiStringsFor } from '@barbercue/shared';
import NotificationSettingsScreen from '../NotificationSettingsScreen';
import { apiFetch } from '../../../lib/api';
import {
  getArrivalAlertReadiness,
  openArrivalChannelSettings,
  openArrivalNotificationSettings,
  openFullScreenIntentSettings,
} from '../../../lib/arrival-alert-native';

jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn() }));
jest.mock('../../../lib/arrival-alert-native', () => ({
  getArrivalAlertReadiness: jest.fn(() => null),
  openArrivalNotificationSettings: jest.fn(),
  openArrivalChannelSettings: jest.fn(),
  openFullScreenIntentSettings: jest.fn(),
}));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
jest.mock('../../../lib/language-context', () => ({
  useLanguage: () => ({ language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') }),
}));
jest.mock('../../../components/ui', () => {
  const { View, Text } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Screen: View,
    Card: View,
    SectionHeader: ({ title }: { title: string }) => h(Text, null, title),
    Button: require('../../../components/ui/Button').Button,
    InlineError: ({ message }: { message: string }) => h(Text, { testID: 'inline-error' }, message),
  };
});

const t = uiStringsFor('EN');
const CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'];

// A tiny stand-in for the backend: stored rows only record what a user CHANGED, and everything
// else resolves to the default (ON) - the same contract the real NotificationsService keeps.
let stored: Map<string, boolean>;
let failNextPut = false;
const dto = () => ({
  categories: ALL_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    channels: CHANNELS.map((channel) => ({
      channel,
      enabled: category === 'ARRIVAL_ALERTS' && channel === 'PUSH' ? true : (stored.get(`${category}:${channel}`) ?? true),
      available: channel === 'IN_APP' || channel === 'PUSH',
      // The critical arrival prompt is mandatory: always ON and marked required by the server.
      ...(category === 'ARRIVAL_ALERTS' && channel === 'PUSH' ? { required: true } : {}),
    })),
  })),
});

let tree: ReturnType<typeof TestRenderer.create> | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = { props: Record<string, any> };
const switches = () => (tree!.root as unknown as { findAllByType: (t: unknown) => Node[] }).findAllByType(Switch);
const switchFor = (category: string, channel: string) =>
  switches().find((s) => s.props.testID === `switch-${category}:${channel}`)!;
const screenText = () => JSON.stringify(tree!.toJSON());
const putCalls = () =>
  (apiFetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(init.body));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

async function mount() {
  await act(async () => {
    tree = TestRenderer.create(createElement(NotificationSettingsScreen));
  });
  await flush();
  await flush();
}
async function unmount() {
  await act(async () => tree!.unmount());
  tree = undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getArrivalAlertReadiness as jest.Mock).mockReturnValue(null);
  stored = new Map();
  failNextPut = false;
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (apiFetch as jest.Mock).mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'PUT') {
      if (failNextPut) {
        failNextPut = false;
        throw new Error('offline');
      }
      const { category, channel, enabled } = JSON.parse(init.body!);
      stored.set(`${category}:${channel}`, enabled);
    }
    return dto();
  });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});
afterEach(async () => {
  if (tree) await unmount();
  jest.restoreAllMocks();
});

it('shows every category ON for a user who never configured anything (default ON)', async () => {
  await mount();
  // push + in-app each, except the mandatory arrival push which has no switch
  expect(switches()).toHaveLength(ALL_NOTIFICATION_CATEGORIES.length * 2 - 1);
  for (const s of switches()) expect(s.props.value).toBe(true);
});

it('lists the four operational categories and keeps Offers as a separate section', async () => {
  await mount();
  const text = screenText();
  for (const title of [
    t.notificationCategoryBookingTitle,
    t.notificationCategoryQueueTitle,
    t.notificationCategoryArrivalTitle,
    t.notificationCategoryRemindersTitle,
    t.notificationCategoryPromoTitle,
  ]) {
    expect(text).toContain(title);
  }
  expect(text).toContain(t.notificationSettingsOperationalHeading);
  expect(text).toContain(t.notificationSettingsPromoHeading);
  expect(text.indexOf(t.notificationSettingsPromoHeading)).toBeGreaterThan(text.indexOf(t.notificationCategoryRemindersTitle));
});

it('turning a push toggle OFF saves exactly that category+channel to the server', async () => {
  await mount();
  await act(async () => switchFor('BOOKING_UPDATES', 'PUSH').props.onValueChange(false));
  await flush();
  expect(putCalls()).toEqual([{ category: 'BOOKING_UPDATES', channel: 'PUSH', enabled: false }]);
  expect(switchFor('BOOKING_UPDATES', 'PUSH').props.value).toBe(false);
  // nothing else moved
  expect(switches().filter((s) => s.props.value === false)).toHaveLength(1);
});

it('PERSISTS and RELOADS: an OFF choice is still OFF after leaving and reopening the screen', async () => {
  await mount();
  await act(async () => switchFor('QUEUE_UPDATES', 'IN_APP').props.onValueChange(false));
  await flush();
  await unmount();

  await mount(); // a fresh mount re-reads from the server
  expect(switchFor('QUEUE_UPDATES', 'IN_APP').props.value).toBe(false);
  expect(switchFor('QUEUE_UPDATES', 'PUSH').props.value).toBe(true);
  expect(switchFor('BOOKING_UPDATES', 'IN_APP').props.value).toBe(true);
});

it('turning it back ON persists and reloads ON', async () => {
  await mount();
  await act(async () => switchFor('REMINDERS', 'PUSH').props.onValueChange(false));
  await flush();
  await act(async () => switchFor('REMINDERS', 'PUSH').props.onValueChange(true));
  await flush();
  await unmount();
  await mount();
  expect(switchFor('REMINDERS', 'PUSH').props.value).toBe(true);
  expect(putCalls()).toEqual([
    { category: 'REMINDERS', channel: 'PUSH', enabled: false },
    { category: 'REMINDERS', channel: 'PUSH', enabled: true },
  ]);
});

it('promotional is independent: toggling offers off leaves every operational toggle ON, and vice versa', async () => {
  await mount();
  await act(async () => switchFor('PROMOTIONAL', 'PUSH').props.onValueChange(false));
  await flush();
  expect(putCalls()[0]).toEqual({ category: 'PROMOTIONAL', channel: 'PUSH', enabled: false });
  const off = switches().filter((s) => s.props.value === false).map((s) => s.props.testID);
  expect(off).toEqual(['switch-PROMOTIONAL:PUSH']);

  await act(async () => switchFor('BOOKING_UPDATES', 'PUSH').props.onValueChange(false));
  await flush();
  expect(switchFor('PROMOTIONAL', 'IN_APP').props.value).toBe(true);
});

it('reverts the toggle and says so when the save fails - it never shows a state the server did not store', async () => {
  await mount();
  failNextPut = true;
  await act(async () => switchFor('ARRIVAL_ALERTS', 'IN_APP').props.onValueChange(false));
  await flush();
  expect(switchFor('ARRIVAL_ALERTS', 'IN_APP').props.value).toBe(true);
  expect(screenText()).toContain(t.notificationSettingsSaveFailed);
  expect(stored.size).toBe(0);
  await unmount();
  await mount();
  expect(switchFor('ARRIVAL_ALERTS', 'IN_APP').props.value).toBe(true);
});

it('always states that the phone\'s own notification permission, mute and Do Not Disturb still apply', async () => {
  await mount();
  expect(screenText()).toContain(t.notificationSettingsOsNote);
  expect(screenText()).not.toContain(t.notificationSettingsOsDenied);
});

it('tells the user when the OS has notifications turned off, and offers the phone settings - without changing any preference', async () => {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  await mount();
  expect(screenText()).toContain(t.notificationSettingsOsDenied);
  const open = (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
    (n) => n.props?.title === t.notificationSettingsOpenOs && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => open.props.onPress());
  expect(Linking.openSettings).toHaveBeenCalled();
  expect(putCalls()).toHaveLength(0);
  for (const s of switches()) expect(s.props.value).toBe(true); // the OS state never flips a preference
});

it('explains that the arrival confirmation screen is required and that settings only control additional alerts', async () => {
  await mount();
  expect(screenText()).toContain(
    'Arrival confirmation screens are required for shop operations and always appear when FastQue needs an arrival decision. Notification settings control additional alerts, not the required arrival screen.',
  );
});

describe('the mandatory arrival prompt cannot be turned off', () => {
  it('shows the arrival push as "Required" with no switch, so there is nothing to disable', async () => {
    await mount();
    expect(switches().find((s) => s.props.testID === 'switch-ARRIVAL_ALERTS:PUSH')).toBeUndefined();
    expect(screenText()).toContain(t.notificationRequiredBadge);
    expect(putCalls()).toHaveLength(0);
  });

  it('still lets the owner choose the supplemental Notification Center entry (in-app) for arrival alerts', async () => {
    await mount();
    await act(async () => switchFor('ARRIVAL_ALERTS', 'IN_APP').props.onValueChange(false));
    await flush();
    expect(putCalls()).toEqual([{ category: 'ARRIVAL_ALERTS', channel: 'IN_APP', enabled: false }]);
  });
});

describe('arrival screen readiness (native Android)', () => {
  const press = async (title: string) => {
    const button = (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
      (n) => n.props?.title === title && typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => button.props.onPress());
  };

  it('shows no readiness card on a build without the native arrival alert (iOS / older binary)', async () => {
    await mount();
    expect(screenText()).not.toContain(t.arrivalReadinessTitle);
  });

  it('says the phone is ready when notifications and full-screen access are granted', async () => {
    (getArrivalAlertReadiness as jest.Mock).mockReturnValue({
      notificationsEnabled: true,
      fullScreenIntentAllowed: true,
      fullScreenIntentNeedsUserGrant: true,
    });
    await mount();
    expect(screenText()).toContain(t.arrivalReadinessTitle);
    expect(screenText()).toContain(t.arrivalReadinessReady);
  });

  it('guides the owner to grant full-screen access (Android 14+) and opens exactly that setting', async () => {
    (getArrivalAlertReadiness as jest.Mock).mockReturnValue({
      notificationsEnabled: true,
      fullScreenIntentAllowed: false,
      fullScreenIntentNeedsUserGrant: true,
    });
    await mount();
    expect(screenText()).toContain(t.arrivalFullScreenAccessTitle);
    expect(screenText()).not.toContain(t.arrivalReadinessReady);
    await press(t.arrivalFullScreenAccessAction);
    expect(openFullScreenIntentSettings).toHaveBeenCalledTimes(1);
    expect(putCalls()).toHaveLength(0);
  });

  it('warns when the phone has silenced the arrival alert channel and opens exactly that channel\'s settings', async () => {
    (getArrivalAlertReadiness as jest.Mock).mockReturnValue({
      notificationsEnabled: true,
      fullScreenIntentAllowed: true,
      arrivalChannelMuted: true,
      fullScreenIntentNeedsUserGrant: true,
    });
    await mount();
    expect(screenText()).toContain(t.arrivalChannelMutedTitle);
    expect(screenText()).not.toContain(t.arrivalReadinessReady); // "ready" is never claimed while the alert is silent
    await press(t.arrivalChannelMutedAction);
    expect(openArrivalChannelSettings).toHaveBeenCalledTimes(1);
  });

  it('warns when notifications are turned off for FastQue and opens the notification settings', async () => {
    (getArrivalAlertReadiness as jest.Mock).mockReturnValue({
      notificationsEnabled: false,
      fullScreenIntentAllowed: false,
      fullScreenIntentNeedsUserGrant: true,
    });
    await mount();
    expect(screenText()).toContain(t.arrivalNotificationsOffTitle);
    await press(t.arrivalNotificationsOffAction);
    expect(openArrivalNotificationSettings).toHaveBeenCalledTimes(1);
  });
});

it('shows a retry when the settings cannot be loaded', async () => {
  (apiFetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(screenText()).toContain(t.notificationSettingsLoadFailed);
  expect(switches()).toHaveLength(0);
  const retry = (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
    (n) => n.props?.title === t.notificationSettingsRetry && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => retry.props.onPress());
  await flush();
  expect(switches()).toHaveLength(ALL_NOTIFICATION_CATEGORIES.length * 2 - 1);
});
