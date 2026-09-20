/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { OwnerArrivalPromptCoordinator } from '../OwnerArrivalPromptCoordinator';
import { __resetArrivalAlertsForTests } from '../../../lib/arrival-alert-sound';
import { apiFetch } from '../../../lib/api';
import {
  cancelNativeArrivalAlert,
  readNativeArrivalState,
  reconcileNativeArrivalAlerts,
  scheduleNativeArrivalSnooze,
} from '../../../lib/arrival-alert-native';

// The native Android arrival alert (full-screen / heads-up) owns the wake-up while the app is away; the
// React Native prompt owns the decision. These tests pin how the two cooperate: one alert per episode,
// backend truth first, and a missed push recovered the moment the app is opened.
jest.setTimeout(30_000);

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('../../../lib/push-notifications', () => ({ ANDROID_BOOKING_CHANNEL_ID: 'booking-updates' }));
jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../../lib/idempotency', () => ({ newIdempotencyKey: () => 'key' }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('../../../lib/salon-context', () => {
  const selectSalon = jest.fn();
  const workplaces = [{ id: 's1' }];
  return { useSalon: () => ({ selectedSalonId: 's1', workplaces, selectSalon }) };
});
jest.mock('../../../navigation/navigation-ref', () => ({ navigationRef: { isReady: () => false, navigate: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../../ui', () => ({ Button: require('../../ui/Button').Button }));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({ on: jest.fn(), off: jest.fn() }),
  joinSalonRoom: jest.fn(),
  onReconnect: jest.fn(() => () => undefined),
}));
jest.mock('../../../lib/arrival-alert-native', () => ({
  isNativeArrivalAlertAvailable: jest.fn(() => true),
  readNativeArrivalState: jest.fn(() => ({ alerted: [], snoozes: {} })),
  reconcileNativeArrivalAlerts: jest.fn(),
  scheduleNativeArrivalSnooze: jest.fn(),
  cancelNativeArrivalAlert: jest.fn(),
  dismissNativeArrivalNotification: jest.fn(),
}));

const alert = (bookingId: string) => ({
  bookingId,
  salonId: 's1',
  slotStart: '2026-09-20T11:00:00.000Z',
  serviceName: 'Beard',
  customerDisplayName: 'Your Beard customer',
  graceExpired: false,
  noShowChargePreview: null,
  currency: 'INR',
});

let tree: ReturnType<typeof TestRenderer.create> | undefined;
let appStateHandler: ((state: string) => void) | undefined;
const scheduled = () => (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;
// react-native's jest setup mocks AppState.currentState as a function; make it the plain string it is on a device.
const setAppState = (state: 'active' | 'background') => {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const press = async (title: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Node = { props: Record<string, any> };
  const button = (tree!.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
    (n) => n.props?.title === title && typeof n.props?.onPress === 'function',
  )[0];
  await act(async () => {
    button.props.onPress();
  });
};

async function mount(alerts: ReturnType<typeof alert>[]) {
  (apiFetch as jest.Mock).mockResolvedValue(alerts);
  await act(async () => {
    tree = TestRenderer.create(createElement(OwnerArrivalPromptCoordinator));
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (readNativeArrivalState as jest.Mock).mockReturnValue({ alerted: [], snoozes: {} });
  __resetArrivalAlertsForTests();
  appStateHandler = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
  setAppState('active');
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('one alert per episode', () => {
  it('stays silent when the phone already alerted natively while the app was away, but still shows the prompt', async () => {
    (readNativeArrivalState as jest.Mock).mockReturnValue({ alerted: ['b1'], snoozes: {} });
    await mount([alert('b1')]);
    expect(tree!.toJSON()).not.toBeNull();
    expect(scheduled()).toBe(0);
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('does not add a second local alert while the app is away - the native one is the alert', async () => {
    setAppState('background');
    await mount([alert('b1')]);
    expect(scheduled()).toBe(0);
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('still sounds once from the React Native path while the app is open (unchanged behaviour)', async () => {
    await mount([alert('b1')]);
    expect(scheduled()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(30_000 * 3);
    });
    await flush();
    expect(scheduled()).toBe(1);
  });
});

describe('backend truth stays the source of truth', () => {
  it('reconciles the native side with the eligible bookings after every fetch', async () => {
    await mount([alert('b1'), alert('b2')]);
    expect(reconcileNativeArrivalAlerts).toHaveBeenCalledWith('s1', ['b1', 'b2']);
  });

  it('reconciles with an empty list when nothing is eligible, so stale native alerts are cancelled', async () => {
    await mount([]);
    expect(reconcileNativeArrivalAlerts).toHaveBeenCalledWith('s1', []);
  });

  it('re-asks the backend when the app returns to the foreground, recovering a push that never arrived', async () => {
    await mount([]);
    const before = (apiFetch as jest.Mock).mock.calls.length;
    (apiFetch as jest.Mock).mockResolvedValue([alert('b9')]);
    await act(async () => {
      appStateHandler?.('active');
    });
    await flush();
    expect((apiFetch as jest.Mock).mock.calls.length).toBeGreaterThan(before);
    expect(tree!.toJSON()).not.toBeNull();
  });

  it('ignores non-active app state changes', async () => {
    await mount([]);
    const before = (apiFetch as jest.Mock).mock.calls.length;
    await act(async () => {
      appStateHandler?.('background');
    });
    await flush();
    expect((apiFetch as jest.Mock).mock.calls.length).toBe(before);
  });
});

describe('snooze', () => {
  it('hands the snooze to the phone too, so the single re-alert happens even if the JS timer is asleep', async () => {
    await mount([alert('b1')]);
    await press('Remind me in 2 minutes');
    expect(tree!.toJSON()).toBeNull();
    expect(scheduleNativeArrivalSnooze).toHaveBeenCalledTimes(1);
    expect(scheduleNativeArrivalSnooze).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b1', salonId: 's1', serviceName: 'Beard' }),
      'EN',
    );
  });

  it('does not re-alert from JS when the snooze expires while the app is away (native re-alerts once)', async () => {
    await mount([alert('b1')]);
    expect(scheduled()).toBe(1);
    await press('Remind me in 2 minutes');
    setAppState('background');
    await act(async () => {
      jest.advanceTimersByTime(121_000);
    });
    await flush();
    // The 30-second safety refresh keeps running, but neither it nor the expired JS timer makes a
    // second JS alert: the phone's own snooze alarm is the single re-alert while the app is away.
    expect(scheduled()).toBe(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  it('re-arms exactly one alert when the snooze expires with the app open', async () => {
    await mount([alert('b1')]);
    await press('Remind me in 2 minutes');
    await act(async () => {
      jest.advanceTimersByTime(121_000);
    });
    await flush();
    expect(scheduled()).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(30_000 * 2);
    });
    await flush();
    expect(scheduled()).toBe(2);
  });

  it('honours a snooze the owner chose on the native screen: the prompt stays hidden until it is due', async () => {
    (readNativeArrivalState as jest.Mock).mockReturnValue({ alerted: ['b1'], snoozes: { b1: Date.now() + 60_000 } });
    await mount([alert('b1')]);
    expect(tree!.toJSON()).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    await flush();
    expect(tree!.toJSON()).not.toBeNull();
  });
});

describe('resolving', () => {
  it('cancels the native alert once the arrival is confirmed', async () => {
    await mount([alert('b1')]);
    (apiFetch as jest.Mock).mockResolvedValue([]);
    await press('Arrived');
    await press('Confirm Arrived');
    await flush();
    expect(cancelNativeArrivalAlert).toHaveBeenCalledWith('b1');
  });

  it('cancels the native alert once No Show is confirmed', async () => {
    await mount([{ ...alert('b1'), graceExpired: true }]);
    (apiFetch as jest.Mock).mockResolvedValue([]);
    await press('Not arrived');
    await press('Confirm No Show');
    await flush();
    expect(cancelNativeArrivalAlert).toHaveBeenCalledWith('b1');
  });

  it('does NOT cancel or resolve anything when the owner only snoozes ("Not arrived" before grace)', async () => {
    await mount([alert('b1')]);
    await press('Not arrived');
    await press('Confirm Not Arrived Yet');
    expect(cancelNativeArrivalAlert).not.toHaveBeenCalled();
    const calls = (apiFetch as jest.Mock).mock.calls.map(([path]) => String(path));
    expect(calls.some((path) => /\/(arrive|no-show)$/.test(path))).toBe(false);
  });
});
