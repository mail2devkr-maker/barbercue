/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Linking, Platform } from 'react-native';
import { PushNotificationCoordinator } from '../PushNotificationCoordinator';
import { requestOwnerArrivalPrompt } from '../../lib/arrival-prompt';
import { dismissNativeArrivalNotification } from '../../lib/arrival-alert-native';
import { hasArrivalAlerted, __resetArrivalAlertsForTests } from '../../lib/arrival-alert-sound';

// The native arrival alert (full-screen / heads-up) hands the owner to the app with a
// fastque://arrival-check link. These tests pin that the link only ever OPENS the existing prompt.
jest.setTimeout(30_000);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  AndroidNotificationPriority: { HIGH: 'high' },
}));

let mockAuth: { status: string; user: { roles: string[] } | null } = { status: 'authenticated', user: { roles: ['SALON_OWNER'] } };
jest.mock('../../lib/auth-context', () => ({ useAuth: () => mockAuth }));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('../../lib/voice-announce', () => ({ speakBooking: jest.fn() }));
jest.mock('../../lib/booking-voice-dedupe', () => ({ claimBookingVoiceEvent: jest.fn(() => true) }));
jest.mock('../../lib/push-notifications', () => ({
  ARRIVAL_ACTION_ARRIVED: 'arrived',
  ARRIVAL_ACTION_NOT_ARRIVED: 'not-arrived',
  ANDROID_BOOKING_CHANNEL_ID: 'booking-updates',
  isPushEligibleUser: jest.fn(() => false),
  registerPushDeviceForUser: jest.fn(),
  reregisterRefreshedPushToken: jest.fn(),
}));
jest.mock('../../lib/push-navigation', () => ({
  parseOwnerBookingPushData: jest.fn(() => null),
  requestOwnerBookingPushNavigation: jest.fn(),
}));
jest.mock('../../lib/arrival-prompt', () => ({
  ...jest.requireActual('../../lib/arrival-prompt'),
  requestOwnerArrivalPrompt: jest.fn(),
}));
jest.mock('../../lib/arrival-alert-native', () => ({
  dismissNativeArrivalNotification: jest.fn(),
}));

const LINK = 'fastque://arrival-check?salonId=salon-1&bookingId=b-1';
let tree: ReturnType<typeof TestRenderer.create> | undefined;
let urlHandler: ((event: { url: string }) => void) | undefined;
let initialUrl: string | null = null;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(createElement(PushNotificationCoordinator));
  });
  await flush();
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetArrivalAlertsForTests();
  mockAuth = { status: 'authenticated', user: { roles: ['SALON_OWNER'] } };
  initialUrl = null;
  urlHandler = undefined;
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(async () => initialUrl);
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((_type: string, handler: (event: { url: string }) => void) => {
    urlHandler = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof Linking.addEventListener);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

it('opens the existing arrival prompt when the app is opened from the native alert (cold start)', async () => {
  initialUrl = `${LINK}&action=open`;
  await mount();
  expect(requestOwnerArrivalPrompt).toHaveBeenCalledWith({
    type: 'booking.arrival_check',
    salonId: 'salon-1',
    bookingId: 'b-1',
    initialAction: null,
  });
  // The phone already alerted, so opening the prompt is silent and the tray notification is cleared.
  expect(hasArrivalAlerted('b-1')).toBe(true);
  expect(dismissNativeArrivalNotification).toHaveBeenCalledWith('b-1');
});

it('maps the Arrived / Not arrived buttons onto the existing two-step confirmation - never onto a booking change', async () => {
  await mount();
  await act(async () => urlHandler?.({ url: `${LINK}&action=arrived` }));
  await act(async () => urlHandler?.({ url: `${LINK}&action=not-arrived` }));
  expect(requestOwnerArrivalPrompt).toHaveBeenNthCalledWith(1, expect.objectContaining({ initialAction: 'arrived' }));
  expect(requestOwnerArrivalPrompt).toHaveBeenNthCalledWith(2, expect.objectContaining({ initialAction: 'not-arrived' }));
  const { apiFetch } = jest.requireMock('../../lib/api') as { apiFetch: jest.Mock };
  expect(apiFetch).not.toHaveBeenCalled(); // opening a link never calls the backend, let alone resolves a booking
});

it('ignores links that are not exactly the arrival-check shape', async () => {
  await mount();
  for (const url of [
    'fastque://somewhere-else?salonId=a&bookingId=b',
    'https://evil.example/arrival-check?salonId=a&bookingId=b',
    'fastque://arrival-check?salonId=..%2F..&bookingId=b',
    'fastque://arrival-check?bookingId=b',
  ]) {
    await act(async () => urlHandler?.({ url }));
  }
  expect(requestOwnerArrivalPrompt).not.toHaveBeenCalled();
  expect(dismissNativeArrivalNotification).not.toHaveBeenCalled();
});

it('defers the link until the owner is signed in, then opens the prompt once', async () => {
  mockAuth = { status: 'unauthenticated', user: null };
  initialUrl = `${LINK}&action=arrived`;
  await mount();
  expect(requestOwnerArrivalPrompt).not.toHaveBeenCalled();

  mockAuth = { status: 'authenticated', user: { roles: ['SALON_OWNER'] } };
  (jest.requireMock('../../lib/push-notifications') as { isPushEligibleUser: jest.Mock }).isPushEligibleUser.mockReturnValue(true);
  await act(async () => {
    tree!.update(createElement(PushNotificationCoordinator));
  });
  await flush();
  expect(requestOwnerArrivalPrompt).toHaveBeenCalledTimes(1);
  expect(requestOwnerArrivalPrompt).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b-1', initialAction: 'arrived' }));
});

it('never opens an arrival prompt for a non-owner', async () => {
  mockAuth = { status: 'authenticated', user: { roles: ['CUSTOMER'] } };
  initialUrl = LINK;
  await mount();
  await act(async () => urlHandler?.({ url: LINK }));
  expect(requestOwnerArrivalPrompt).not.toHaveBeenCalled();
});
