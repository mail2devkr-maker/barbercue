/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import { OwnerArrivalPromptCoordinator } from '../OwnerArrivalPromptCoordinator';
import { __resetArrivalAlertsForTests } from '../../../lib/arrival-alert-sound';
import { requestOwnerArrivalPrompt } from '../../../lib/arrival-prompt';
import { apiFetch } from '../../../lib/api';
import { onReconnect } from '../../../lib/realtime';

// The first render pulls in the real theme/Button, which is slow to cold-load when the machine is
// busy (e.g. the whole monorepo test run in parallel); the default 5s is not enough there.
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

const mockSocketHandlers = new Map<string, (payload: { salonId: string }) => void>();
let mockReconnectCallback: (() => void) | null = null;
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({
    on: (event: string, handler: (payload: { salonId: string }) => void) => mockSocketHandlers.set(event, handler),
    off: (event: string) => mockSocketHandlers.delete(event),
  }),
  joinSalonRoom: jest.fn(),
  onReconnect: jest.fn((cb: () => void) => {
    mockReconnectCallback = cb;
    return () => undefined;
  }),
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
const scheduled = () => (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;
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
  mockSocketHandlers.clear();
  mockReconnectCallback = null;
  __resetArrivalAlertsForTests();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('sounds and vibrates exactly once when the prompt appears from backend truth', async () => {
  await mount([alert('b1')]);
  expect(scheduled()).toBe(1);
  expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  const content = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
  expect(content.content.title).toBe('Appointment arrival check');
  expect(content.content.body).toContain('Beard');
});

it('does not repeat the sound on realtime refreshes, socket reconnects or the 30-second safety refresh', async () => {
  await mount([alert('b1')]);
  for (const event of ['booking.arrival_alert', 'queue.updated', 'booking.no_show']) {
    await act(async () => mockSocketHandlers.get(event)?.({ salonId: 's1' }));
    await flush();
  }
  await act(async () => mockReconnectCallback?.());
  await flush();
  await act(async () => {
    jest.advanceTimersByTime(30_000 * 3);
  });
  await flush();
  expect(onReconnect).toHaveBeenCalled();
  expect(scheduled()).toBe(1);
  expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
});

it('sounds again when a snoozed reminder becomes eligible again', async () => {
  await mount([alert('b1')]);
  expect(scheduled()).toBe(1);
  await press('Remind me in 2 minutes');
  expect(tree!.toJSON()).toBeNull(); // snoozed: prompt hidden, no sound while snoozed
  await act(async () => {
    jest.advanceTimersByTime(119_000);
  });
  await flush();
  expect(scheduled()).toBe(1);
  await act(async () => {
    jest.advanceTimersByTime(2_000);
  });
  await flush();
  expect(scheduled()).toBe(2);
  expect(tree!.toJSON()).not.toBeNull(); // the prompt is back
});

it('stays silent when the owner opens the prompt themselves (push tap / Notification Center)', async () => {
  await mount([]);
  (apiFetch as jest.Mock).mockResolvedValue([alert('b2')]);
  await act(async () => {
    requestOwnerArrivalPrompt({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b2' });
  });
  await flush();
  expect(tree!.toJSON()).not.toBeNull();
  expect(scheduled()).toBe(0);
  // ...and the periodic refresh must not then sound for it either.
  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await flush();
  expect(scheduled()).toBe(0);
});

it('does not sound when there is nothing to attend to', async () => {
  await mount([]);
  expect(scheduled()).toBe(0);
  expect(tree!.toJSON()).toBeNull();
});
