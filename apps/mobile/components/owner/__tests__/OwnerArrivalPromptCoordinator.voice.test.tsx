/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, Vibration } from 'react-native';
import { Language } from '@barbercue/shared';
import { OwnerArrivalPromptCoordinator } from '../OwnerArrivalPromptCoordinator';
import { __resetArrivalAlertsForTests } from '../../../lib/arrival-alert-sound';
import { apiFetch } from '../../../lib/api';
import { canSpeak, speakBooking } from '../../../lib/voice-announce';

// One audible episode per arrival event, and it is SPOKEN: through push + realtime + reconcile + refresh
// duplicates, speech happens exactly once, the tone never plays alongside it, and a snooze re-arm is one
// new episode. If speech is impossible the tone plays instead, so the alert is never silent.
jest.setTimeout(30_000);

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('../../../lib/push-notifications', () => ({ ANDROID_BOOKING_CHANNEL_ID: 'booking-updates' }));
jest.mock('../../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));
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
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({
    on: (event: string, handler: (payload: { salonId: string }) => void) => mockSocketHandlers.set(event, handler),
    off: (event: string) => mockSocketHandlers.delete(event),
  }),
  joinSalonRoom: jest.fn(),
  onReconnect: jest.fn(() => () => undefined),
}));
jest.mock('../../../lib/voice-announce', () => ({ canSpeak: jest.fn(), speakBooking: jest.fn() }));

const alert = (bookingId: string) => ({
  bookingId,
  salonId: 's1',
  slotStart: '2026-09-20T13:00:00.000Z',
  serviceName: 'Classic Haircut',
  customerDisplayName: 'Your Classic Haircut customer',
  graceExpired: false,
  noShowChargePreview: null,
  currency: 'INR',
});

let tree: ReturnType<typeof TestRenderer.create> | undefined;
const tones = () => (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;
const spoken = () => (speakBooking as jest.Mock).mock.calls.filter(([p]) => p.event === 'booking.arrival_check').length;
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
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
  __resetArrivalAlertsForTests();
  (canSpeak as jest.Mock).mockResolvedValue(true);
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('SPEAKS the arrival check with the service and time, and plays no tone', async () => {
  await mount([alert('b1')]);
  expect(spoken()).toBe(1);
  expect(speakBooking).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'booking.arrival_check', bookingId: 'b1', language: Language.EN, serviceName: 'Classic Haircut' }),
  );
  const { time } = (speakBooking as jest.Mock).mock.calls[0][0];
  expect(typeof time).toBe('string');
  expect(tones()).toBe(0);
});

it('exactly one spoken episode through realtime events, reconnects and the 30-second safety refresh', async () => {
  await mount([alert('b1')]);
  for (const event of ['booking.arrival_alert', 'queue.updated', 'booking.no_show']) {
    await act(async () => mockSocketHandlers.get(event)?.({ salonId: 's1' }));
    await flush();
  }
  await act(async () => {
    jest.advanceTimersByTime(30_000 * 3);
  });
  await flush();
  expect(spoken()).toBe(1);
  expect(tones()).toBe(0);
});

it('a snooze re-arm is one new spoken episode - not two', async () => {
  await mount([alert('b1')]);
  await press('Remind me in 2 minutes');
  await act(async () => {
    jest.advanceTimersByTime(121_000);
  });
  await flush();
  expect(spoken()).toBe(2);
  await act(async () => {
    jest.advanceTimersByTime(30_000 * 2);
  });
  await flush();
  expect(spoken()).toBe(2);
});

it('falls back to the tone, never silence, when this phone cannot speak', async () => {
  (canSpeak as jest.Mock).mockResolvedValue(false);
  await mount([alert('b1')]);
  expect(spoken()).toBe(0);
  expect(tones()).toBe(1);
});

it('does not speak when the owner opened the prompt themselves (push tap / Notification Center)', async () => {
  const { requestOwnerArrivalPrompt } = jest.requireActual('../../../lib/arrival-prompt');
  await mount([]);
  (apiFetch as jest.Mock).mockResolvedValue([alert('b2')]);
  await act(async () => {
    requestOwnerArrivalPrompt({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b2' });
  });
  await flush();
  expect(spoken()).toBe(0);
  expect(tones()).toBe(0);
});
