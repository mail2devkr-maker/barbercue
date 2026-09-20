/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { Language } from '@barbercue/shared';
import { PushNotificationCoordinator } from '../PushNotificationCoordinator';
import { speakBooking } from '../../lib/voice-announce';
import { requestOwnerArrivalPrompt } from '../../lib/arrival-prompt';
import { apiFetch } from '../../lib/api';
import { __resetBookingVoiceDedupeForTests } from '../../lib/booking-voice-dedupe';
import { __resetArrivalAlertsForTests } from '../../lib/arrival-alert-sound';

// Locks the spoken-announcement behaviour that 1.0.3 shipped for owner booking events (new booking,
// reschedule, cancellation) and pins how the arrival check fits beside it: the arrival announcement is
// spoken by the arrival prompt's own once-per-episode gate, never by this listener too, so a single event
// can never be spoken twice.
jest.setTimeout(30_000);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', user: { roles: ['SALON_OWNER'] } }),
}));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('../../lib/voice-announce', () => ({ speakBooking: jest.fn(), canSpeak: jest.fn(async () => true) }));
jest.mock('../../lib/push-notifications', () => ({
  ARRIVAL_ACTION_ARRIVED: 'arrived',
  ARRIVAL_ACTION_NOT_ARRIVED: 'not-arrived',
  ANDROID_BOOKING_CHANNEL_ID: 'booking-updates',
  isPushEligibleUser: jest.fn(() => false),
  registerPushDeviceForUser: jest.fn(),
  reregisterRefreshedPushToken: jest.fn(),
}));
jest.mock('../../lib/push-navigation', () => ({
  parseOwnerBookingPushData: jest.requireActual('../../lib/push-navigation').parseOwnerBookingPushData,
  requestOwnerBookingPushNavigation: jest.fn(),
}));
jest.mock('../../lib/arrival-prompt', () => ({
  ...jest.requireActual('../../lib/arrival-prompt'),
  requestOwnerArrivalPrompt: jest.fn(),
}));
jest.mock('../../lib/arrival-alert-native', () => ({ dismissNativeArrivalNotification: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Notifications = require('expo-notifications') as { addNotificationReceivedListener: jest.Mock };

let tree: ReturnType<typeof TestRenderer.create> | undefined;
let received: ((notification: { request: { content: { data: unknown } } }) => void) | undefined;

const push = (data: Record<string, unknown>) => ({ request: { content: { data } } });
const detail = { slotStart: '2026-09-21T13:00:00.000Z', salonTimezone: 'Asia/Kolkata', serviceName: 'Haircut', salonName: 'Cert Salon', assignedStaffName: null, preferredStaffName: 'Ravi' };

async function mount() {
  Notifications.addNotificationReceivedListener.mockImplementation((listener: typeof received) => {
    received = listener;
    return { remove: jest.fn() };
  });
  await act(async () => {
    tree = TestRenderer.create(createElement(PushNotificationCoordinator));
  });
}
async function deliver(data: Record<string, unknown>) {
  await act(async () => {
    received?.(push(data));
  });
  await act(async () => {
    jest.advanceTimersByTime(1300); // the coordinator waits 1.2 s before speaking
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  __resetBookingVoiceDedupeForTests();
  __resetArrivalAlertsForTests();
  (apiFetch as jest.Mock).mockResolvedValue(detail);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = undefined;
  jest.useRealTimers();
});

describe('owner booking announcements (the 1.0.3 spoken behaviour, unchanged)', () => {
  it('speaks a NEW BOOKING with service, barber, salon and time', async () => {
    await mount();
    await deliver({ type: 'booking.created', salonId: 's1', bookingId: 'b1' });
    expect(speakBooking).toHaveBeenCalledTimes(1);
    expect(speakBooking).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking.created', bookingId: 'b1', language: Language.EN, serviceName: 'Haircut', barberName: 'Ravi', salonName: 'Cert Salon' }),
    );
  });

  it('speaks a RESCHEDULE and a CANCELLATION', async () => {
    await mount();
    await deliver({ type: 'booking.rescheduled', salonId: 's1', bookingId: 'b2' });
    await deliver({ type: 'booking.cancelled', salonId: 's1', bookingId: 'b3' });
    expect((speakBooking as jest.Mock).mock.calls.map(([params]) => params.event)).toEqual(['booking.rescheduled', 'booking.cancelled']);
  });

  it('never speaks the same event twice (duplicate push delivery)', async () => {
    await mount();
    await deliver({ type: 'booking.created', salonId: 's1', bookingId: 'b1' });
    await deliver({ type: 'booking.created', salonId: 's1', bookingId: 'b1' });
    expect(speakBooking).toHaveBeenCalledTimes(1);
  });

  it('still speaks (with no invented details) when the booking detail cannot be loaded', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await mount();
    await deliver({ type: 'booking.created', salonId: 's1', bookingId: 'b4' });
    expect(speakBooking).toHaveBeenCalledWith(expect.objectContaining({ event: 'booking.created', serviceName: null, barberName: null }));
  });
});

describe('the arrival check beside them: one spoken episode, owned by the arrival prompt', () => {
  it('a foreground arrival push opens the prompt but is NOT spoken here (the prompt speaks it once, per episode)', async () => {
    await mount();
    await deliver({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b9' });
    expect(requestOwnerArrivalPrompt).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'b9' }));
    expect(speakBooking).not.toHaveBeenCalled();
  });

  it('a non-owner never triggers any owner announcement', async () => {
    jest.resetModules();
    await mount();
    await deliver({ type: 'booking.arrival_check', salonId: 's1', bookingId: 'b9' });
    expect(speakBooking).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'booking.arrival_check' }));
  });
});
